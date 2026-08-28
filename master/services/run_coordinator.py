"""Run coordinator – simulation status aggregation and history persistence.

Manages the lifecycle of a simulation run: aggregates per-model results
across nodes, incrementally persists to history, and handles run transitions.
"""

import time


class RunCoordinator:
    """Tracks distributed simulation state and persists results to history."""

    # Seconds between incremental history saves while running.
    HISTORY_SAVE_INTERVAL = 10

    def __init__(self, history_store, poller, sim_runner):
        self._history_store = history_store
        self._poller = poller
        self._sim_runner = sim_runner

        # Mutable state
        self._last_saved_status: str = "idle"
        self._has_been_running: bool = False
        self._saved_model_keys: set = set()
        self._last_history_save_time: float = 0.0

    @property
    def has_been_running(self) -> bool:
        return self._has_been_running

    @has_been_running.setter
    def has_been_running(self, value: bool):
        self._has_been_running = value

    def clear(self):
        """Reset tracking state (called on /clear-results)."""
        self._last_saved_status = "idle"
        self._has_been_running = False
        self._saved_model_keys = set()
        self._last_history_save_time = 0.0
        self._history_store.finalize_current()

    # ------------------------------------------------------------------
    # Status aggregation
    # ------------------------------------------------------------------
    def get_aggregated_status(self) -> dict:
        """Poll snapshot, aggregate per-model results, persist to history.

        Returns the full status response dict ready for jsonify().
        """
        snapshot = self._poller.get_snapshot()
        nodes_data = snapshot.get("nodes", {})

        if not nodes_data:
            nodes_data = {"master(local)": self._sim_runner.get_status()}

        statuses = []
        nodes_info = []
        all_model_results: dict[str, list[dict]] = {}

        for name, info in nodes_data.items():
            node_status = info.get("status", "idle")
            statuses.append(node_status)

            if name.startswith("master"):
                addr = "master"
            else:
                addr = name.replace("worker(", "").rstrip(")")

            nodes_info.append({
                "addr": addr,
                "name": name,
                "status": node_status,
                "progress": info.get("progress"),
                "models_completed": info.get("models_completed", 0),
                "models_total": info.get("models_total", 0),
            })

            model_results = info.get("model_results", {})
            for model_name, model_data in model_results.items():
                if model_name not in all_model_results:
                    all_model_results[model_name] = []
                all_model_results[model_name].append(model_data)

        # Determine overall status
        if all(s == "completed" for s in statuses) and statuses:
            overall_status = "completed"
        elif any(s == "error" for s in statuses):
            overall_status = "partial_error"
        elif any(s == "running" for s in statuses):
            overall_status = "running"
        else:
            overall_status = "idle"

        # Aggregate per-model across nodes
        aggregated_models = self._aggregate_models(all_model_results)

        response = {
            "overall_status": overall_status,
            "nodes": nodes_info,
            "model_results": aggregated_models,
        }

        # Persist results incrementally
        self._persist_incremental(overall_status, aggregated_models)

        return response

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------
    def _aggregate_models(self, all_model_results: dict) -> dict:
        """Aggregate per-model results from multiple nodes."""
        aggregated_models = {}

        for model_name, node_data_list in all_model_results.items():
            agg_latest = {
                "spin_count": 0, "total_won": 0, "base_won": 0,
                "base_spent": 0, "eb_won": 0, "eb_spent": 0, "total_spent": 0,
                "node_count": len(node_data_list),
            }

            for nd in node_data_list:
                latest = nd.get("latest", {}) if isinstance(nd, dict) and "latest" in nd else nd
                for field in ("spin_count", "total_won", "base_won", "base_spent", "eb_won", "eb_spent", "total_spent"):
                    agg_latest[field] += latest.get(field, 0)

            agg_latest["total_rtp"] = agg_latest["total_won"] / agg_latest["total_spent"] if agg_latest["total_spent"] > 0 else 0
            agg_latest["base_rtp"] = agg_latest["base_won"] / agg_latest["base_spent"] if agg_latest["base_spent"] > 0 else 0
            agg_latest["eb_rtp"] = agg_latest["eb_won"] / agg_latest["eb_spent"] if agg_latest["eb_spent"] > 0 else 0

            # Build cumulative history
            history_list = self._build_cumulative_history(node_data_list, agg_latest)

            aggregated_models[model_name] = {
                "latest": agg_latest,
                "history": history_list,
            }

        return aggregated_models

    def _build_cumulative_history(self, node_data_list: list, agg_latest: dict) -> list:
        """Replay history events across nodes to build a merged timeline."""
        all_events = []
        node_latest_at = []

        for ni, nd in enumerate(node_data_list):
            history = nd.get("history", []) if isinstance(nd, dict) and "history" in nd else []
            node_latest_at.append({})
            for snap in history:
                sc = snap.get("spin_count", 0)
                all_events.append((sc, ni, snap))

        all_events.sort(key=lambda x: (x[0], x[1]))

        history_list = []
        seen_totals: set = set()

        for sc, ni, snap in all_events:
            node_latest_at[ni] = snap
            agg = {
                "spin_count": 0, "total_won": 0, "base_won": 0,
                "base_spent": 0, "eb_won": 0, "eb_spent": 0, "total_spent": 0,
            }
            for nl in node_latest_at:
                for field in ("spin_count", "total_won", "base_won", "base_spent", "eb_won", "eb_spent", "total_spent"):
                    agg[field] += nl.get(field, 0)

            total_sc = agg["spin_count"]
            if total_sc in seen_totals:
                if history_list and history_list[-1]["spin_count"] == total_sc:
                    history_list[-1] = agg
                continue
            seen_totals.add(total_sc)
            agg["total_rtp"] = agg["total_won"] / agg["total_spent"] if agg["total_spent"] > 0 else 0
            agg["base_rtp"] = agg["base_won"] / agg["base_spent"] if agg["base_spent"] > 0 else 0
            agg["eb_rtp"] = agg["eb_won"] / agg["eb_spent"] if agg["eb_spent"] > 0 else 0
            history_list.append(agg)

        # Append latest if newer than last history entry
        if history_list:
            last_hist_sc = history_list[-1].get("spin_count", 0)
            latest_sc = agg_latest.get("spin_count", 0)
            if latest_sc > last_hist_sc:
                history_list.append({
                    "spin_count": latest_sc,
                    "total_won": agg_latest["total_won"],
                    "base_won": agg_latest["base_won"],
                    "base_spent": agg_latest["base_spent"],
                    "eb_won": agg_latest["eb_won"],
                    "eb_spent": agg_latest["eb_spent"],
                    "total_spent": agg_latest["total_spent"],
                    "total_rtp": agg_latest["total_rtp"],
                    "base_rtp": agg_latest["base_rtp"],
                    "eb_rtp": agg_latest["eb_rtp"],
                })

        return history_list

    def _persist_incremental(self, overall_status: str, aggregated_models: dict):
        """Persist results incrementally so History reflects latest progress."""
        if overall_status == "running":
            self._has_been_running = True

        if aggregated_models and self._has_been_running:
            current_keys = set(aggregated_models.keys())
            new_keys = current_keys - self._saved_model_keys
            now = time.time()
            due_for_refresh = (now - self._last_history_save_time >= self.HISTORY_SAVE_INTERVAL)

            if new_keys or due_for_refresh:
                try:
                    self._history_store.save_current(aggregated_models)
                    self._saved_model_keys = current_keys.copy()
                    self._last_history_save_time = now
                except Exception:
                    pass

        # On transition to stopped/completed/idle: final snapshot + reset
        if overall_status in ("completed", "stopped", "idle") and self._last_saved_status == "running":
            if aggregated_models:
                try:
                    self._history_store.save_current(aggregated_models)
                except Exception:
                    pass
            self._has_been_running = False
            self._saved_model_keys = set()
            self._last_history_save_time = 0.0
            self._history_store.finalize_current()

        self._last_saved_status = overall_status
