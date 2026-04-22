"""Background progress poller for distributed simulation cluster.

Periodically polls all Worker /status endpoints and collects the Master's
local simulator status, assembling a unified progress snapshot.
"""

import threading
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
    """

    def __init__(
        self,
        interval: float = 2.0,
        master_status_fn: Optional[Callable[[], dict]] = None,
        progress_store: Optional[ProgressStore] = None,
        request_timeout: float = 5.0,
    ):
        self._interval = interval
        self._master_status_fn = master_status_fn
        self._progress_store = progress_store
        self._request_timeout = request_timeout

        self._snapshot: dict = {}
        self._snapshot_lock = threading.Lock()

        self._stop_event = threading.Event()
        self._wake_event = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._nodes: list[str] = []

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
        if self._thread is not None and self._thread.is_alive():
            return

        self._nodes = list(nodes)
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
        """Clear the cached progress snapshot."""
        with self._snapshot_lock:
            self._snapshot = {}

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

        # Worker statuses
        for addr in self._nodes:
            nodes_data[f"worker({addr})"] = self._fetch_worker_status(addr)

        return {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "nodes": nodes_data,
        }

    def _fetch_worker_status(self, addr: str) -> dict:
        """GET /status from a single worker, returning error on failure."""
        try:
            resp = requests.get(
                f"http://{addr}/status",
                timeout=self._request_timeout,
            )
            resp.raise_for_status()
            return resp.json()
        except Exception as exc:
            return {"status": "error", "error": str(exc)}
