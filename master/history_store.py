"""Persistent history store for simulation results.

Saves each model's final results and history snapshots to JSON files
in a local data directory, indexed by timestamp.
"""

import json
import os
from datetime import datetime, timezone


class HistoryStore:
    """Persists simulation results to local JSON files for later replay."""

    def __init__(self, data_dir: str = "./data"):
        self._data_dir = data_dir
        os.makedirs(data_dir, exist_ok=True)

    def save_run(self, model_results: dict) -> str:
        """Save a complete run's aggregated model results.

        Args:
            model_results: {model_name: {"latest": {...}, "history": [...]}}

        Returns:
            The filename of the saved record.
        """
        ts = datetime.now(timezone.utc)
        filename = ts.strftime("%Y%m%d_%H%M%S") + ".json"
        filepath = os.path.join(self._data_dir, filename)

        record = {
            "timestamp": ts.isoformat(),
            "models": model_results,
        }

        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(record, f, ensure_ascii=False, indent=2)

        return filename

    def list_runs(self) -> list[dict]:
        """List all saved runs with metadata.

        Returns:
            List of {"filename": str, "timestamp": str}
        """
        runs = []
        if not os.path.isdir(self._data_dir):
            return runs
        for fname in sorted(os.listdir(self._data_dir), reverse=True):
            if not fname.endswith(".json"):
                continue
            fpath = os.path.join(self._data_dir, fname)
            try:
                with open(fpath, "r", encoding="utf-8") as f:
                    data = json.load(f)
                runs.append({
                    "filename": fname,
                    "timestamp": data.get("timestamp", ""),
                    "model_count": len(data.get("models", {})),
                    "models": list(data.get("models", {}).keys()),
                })
            except (json.JSONDecodeError, OSError):
                continue
        return runs

    def load_run(self, filename: str) -> dict | None:
        """Load a specific run's data.

        Returns:
            The full record dict, or None if not found.
        """
        fpath = os.path.join(self._data_dir, filename)
        if not os.path.isfile(fpath):
            return None
        with open(fpath, "r", encoding="utf-8") as f:
            return json.load(f)

    def query(self, model_name: str = "", start_date: str = "", end_date: str = "") -> list[dict]:
        """Query runs by model name and/or date range.

        Args:
            model_name: Filter by model name (substring match).
            start_date: Filter runs on or after this date (YYYY-MM-DD).
            end_date: Filter runs on or before this date (YYYY-MM-DD).

        Returns:
            List of matching run records.
        """
        results = []
        for run_meta in self.list_runs():
            # Date filter
            ts = run_meta.get("timestamp", "")[:10]  # YYYY-MM-DD
            if start_date and ts < start_date:
                continue
            if end_date and ts > end_date:
                continue

            # Model name filter
            if model_name:
                if not any(model_name.lower() in m.lower() for m in run_meta.get("models", [])):
                    continue

            # Load full data
            data = self.load_run(run_meta["filename"])
            if data:
                results.append(data)

        return results
