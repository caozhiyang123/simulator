"""Background progress poller for distributed simulation cluster.

Periodically polls all Worker /status endpoints and collects the Master's
local simulator status, assembling a unified progress snapshot.
"""

import threading
from collections import deque
from datetime import datetime, timezone
from typing import Callable, Optional

import requests

from progress_store import ProgressStore


class ProgressPoller:
    """Polls worker nodes and master local status on a background thread.

    Parameters
    ----------
    interval:
        Default polling interval in seconds.
    master_status_fn:
        Optional callable returning the master's local status dict.
    progress_store:
        Optional :class:`ProgressStore` used to persist every snapshot.
    request_timeout:
        HTTP timeout (seconds) for each worker ``GET /status`` call.
    max_consecutive_failures:
        Number of consecutive poll failures (timeout/connection error) that
        must occur before a worker's last-known status is actually replaced
        with "error". This prevents a single slow/transient poll (e.g. a
        real LAN worker whose CPU is saturated running a heavy simulation)
        from being misread as the simulation having stopped -- the worker
        keeps reporting its LAST KNOWN status (e.g. "running") until enough
        consecutive failures accumulate to conclude it is genuinely
        unreachable.
    session:
        Optional :class:`requests.Session` to use for worker ``/status``
        calls. Pass the same session used elsewhere for master<->worker
        traffic (e.g. one with ``trust_env=False``) so LAN workers are not
        routed through a misconfigured system/environment HTTP(S) proxy,
        which would otherwise surface as spurious poll failures -- and,
        after ``max_consecutive_failures`` accumulate, a genuinely running
        worker being misreported as stopped. Defaults to a plain
        ``requests`` module-level session (trusts environment proxy) if
        not provided, for backward compatibility.
    enable_poll_log:
        Whether to record every worker ``/status`` request/response into
        the in-memory poll log surfaced via :meth:`get_poll_log` (and, on
        the Master side, the Operation Log UI). This log is unbounded in
        *lifetime* even though each individual deque is capped at 500
        entries -- during very long-running simulations (hundreds of
        millions of spins, many hours of 2s-interval polling) keeping
        this feature always-on adds continuous allocation/GC pressure
        that has been observed to eventually crash the Master process.
        Defaults to ``False`` (disabled) so the memory-sensitive path is
        opt-in; enable via ``"enable_poller_log": true`` in config.json
        only while actively diagnosing a polling issue.
    """

    def __init__(
        self,
        interval: float = 2.0,
        master_status_fn: Optional[Callable[[], dict]] = None,
        progress_store: Optional[ProgressStore] = None,
        request_timeout: float = 5.0,
        max_consecutive_failures: int = 3,
        session: Optional[requests.Session] = None,
        enable_poll_log: bool = False,
    ):
        self._interval = interval
        self._master_status_fn = master_status_fn
        self._progress_store = progress_store
        self._request_timeout = request_timeout
        self._max_consecutive_failures = max_consecutive_failures
        self._session = session if session is not None else requests
        self._enable_poll_log = enable_poll_log

        self._snapshot: dict = {}
        self._snapshot_lock = threading.Lock()

        self._stop_event = threading.Event()
        self._wake_event = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._nodes: list[str] = []
        self._nodes_lock = threading.Lock()

        # Per-worker: last successfully-fetched status dict, and count of
        # consecutive poll failures since that last success.
        self._last_known_status: dict[str, dict] = {}
        self._consecutive_failures: dict[str, int] = {}

        # Rolling log of every worker /status request + response/error, so
        # the master's Operation Log can surface exactly what each poll
        # cycle sent/received (useful for diagnosing running->stopped
        # misreports without needing to reproduce the issue with extra
        # instrumentation each time).
        self._poll_log: deque = deque(maxlen=500)
        self._poll_log_lock = threading.Lock()
        self._poll_log_next_id = 1

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def start(self, nodes: list[str]) -> None:
        """Start the background polling thread.

        Parameters
        ----------
        nodes:
            List of worker addresses in ``"ip:port"`` format.
        """
        incoming = list(dict.fromkeys(nodes))
        if self._thread is not None and self._thread.is_alive():
            with self._nodes_lock:
                self._nodes = list(dict.fromkeys(self._nodes + incoming))
            self._wake_event.set()
            return

        with self._nodes_lock:
            self._nodes = incoming
        self._stop_event.clear()
        self._wake_event.clear()

        self._thread = threading.Thread(target=self._poll_loop, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        """Stop the polling thread."""
        self._stop_event.set()
        self._wake_event.set()  # interrupt any ongoing sleep
        if self._thread is not None:
            self._thread.join(timeout=10)
            self._thread = None

    def set_interval(self, interval: float) -> None:
        """Change the polling interval; takes effect on the next cycle."""
        self._interval = interval
        self._wake_event.set()  # wake the sleeper so it picks up the new value

    def get_snapshot(self) -> dict:
        """Return the most recent progress snapshot."""
        with self._snapshot_lock:
            return dict(self._snapshot)

    def clear_snapshot(self) -> None:
        """Clear the cached progress snapshot and per-node failure tracking."""
        with self._snapshot_lock:
            self._snapshot = {}
        self._last_known_status.clear()
        self._consecutive_failures.clear()

    def get_poll_log(self, since: int = 0) -> dict:
        """Return poll-request log entries with id > since.

        Each entry records one worker ``GET /status`` attempt: address,
        the URL requested, the outcome ("ok"/"stale"/"error"), the raw
        response payload (or error text), and a timestamp. Used to expose
        exactly what Master sent/received to the Operation Log UI, so a
        misreported running->stopped transition can be diagnosed from the
        actual polling traffic rather than guesswork.

        Returns an empty result (with ``"enabled": False``) when the poll
        log is disabled via config, so callers/UI can distinguish "nothing
        polled yet" from "logging turned off".
        """
        if not self._enable_poll_log:
            return {"entries": [], "total": 0, "enabled": False}
        with self._poll_log_lock:
            entries = [e for e in self._poll_log if e["id"] > since]
            total = self._poll_log_next_id - 1
        return {"entries": entries, "total": total, "enabled": True}

    def set_poll_log_enabled(self, enabled: bool) -> None:
        """Enable/disable poll-request logging at runtime.

        Disabling also drops any buffered entries immediately to free
        memory right away rather than waiting for them to age out.
        """
        self._enable_poll_log = enabled
        if not enabled:
            with self._poll_log_lock:
                self._poll_log.clear()

    def _record_poll(self, addr: str, url: str, outcome: str, detail) -> None:
        # Skip allocating/storing anything when disabled -- this is the
        # memory-sensitive path during very long simulations, so avoid any
        # unnecessary work when the feature is off.
        if not self._enable_poll_log:
            return
        with self._poll_log_lock:
            entry = {
                "id": self._poll_log_next_id,
                "time": datetime.now(timezone.utc).isoformat(),
                "addr": addr,
                "url": url,
                "outcome": outcome,
                "detail": detail,
            }
            self._poll_log_next_id += 1
            self._poll_log.append(entry)

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _poll_loop(self) -> None:
        """Main loop executed on the daemon thread."""
        while not self._stop_event.is_set():
            snapshot = self._collect()

            with self._snapshot_lock:
                self._snapshot = snapshot

            if self._progress_store is not None:
                try:
                    self._progress_store.save(snapshot)
                except Exception:
                    pass  # best-effort persistence

            # Sleep for the configured interval, but wake early on
            # stop() or set_interval().
            self._wake_event.wait(timeout=self._interval)
            self._wake_event.clear()

    def _collect(self) -> dict:
        """Build a full snapshot from master + all workers."""
        nodes_data: dict[str, dict] = {}

        # Master local status
        if self._master_status_fn is not None:
            try:
                master_status = self._master_status_fn()
            except Exception:
                master_status = {
                    "status": "error",
                    "error": "master status callback failed",
                }
        else:
            master_status = {"status": "idle"}

        nodes_data["master(local)"] = master_status

        # Worker statuses.  Copy under lock so later start() calls can safely
        # merge newly selected workers while this poll cycle is running.
        with self._nodes_lock:
            worker_nodes = list(self._nodes)
        for addr in worker_nodes:
            nodes_data[f"worker({addr})"] = self._fetch_worker_status(addr)

        return {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "nodes": nodes_data,
        }

    def _fetch_worker_status(self, addr: str) -> dict:
        """GET /status from a single worker.

        On success, remembers the status and resets the failure counter.
        On failure, does NOT immediately report "error" -- a slow/loaded
        worker (e.g. one whose CPU is saturated running a heavy simulation)
        can transiently miss the request_timeout window without actually
        having stopped. The worker's last known status is returned as-is
        until max_consecutive_failures is reached, at which point it is
        treated as genuinely unreachable and reported as "error".
        """
        url = f"http://{addr}/status"
        try:
            resp = self._session.get(url, timeout=self._request_timeout)
            resp.raise_for_status()
            result = resp.json()
            self._last_known_status[addr] = result
            self._consecutive_failures[addr] = 0
            self._record_poll(addr, url, "ok", result)
            return result
        except Exception as exc:
            failures = self._consecutive_failures.get(addr, 0) + 1
            self._consecutive_failures[addr] = failures
            last_known = self._last_known_status.get(addr)
            max_fail = self._max_consecutive_failures
            if last_known is not None and failures < max_fail:
                # Return the last known status unchanged (a transient poll
                # miss must not overwrite a genuinely running simulation),
                # but surface the poll trouble for visibility/debugging.
                stale = dict(last_known)
                stale["_poll_warning"] = (
                    f"Poll failed ({failures}/{max_fail}): {exc}"
                )
                self._record_poll(
                    addr, url, "stale",
                    f"{exc} (using last known status, {failures}/{max_fail})",
                )
                return stale
            self._record_poll(addr, url, "error", str(exc))
            return {"status": "error", "error": str(exc)}
