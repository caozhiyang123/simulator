"""Worker HTTP client – all master→worker communication goes through here.

This service encapsulates the requests.Session used for master-to-worker
(and master-to-launcher) HTTP calls, including retry logic and proxy helpers.
"""

import time
from typing import Any

import requests as http_requests


class WorkerClient:
    """Thin HTTP client for communicating with worker nodes."""

    MAX_RETRIES = 3
    RETRY_INTERVAL = 5  # seconds

    def __init__(self, session: http_requests.Session):
        self._session = session

    # ------------------------------------------------------------------
    # Core helpers
    # ------------------------------------------------------------------
    @staticmethod
    def is_remote(addr: str) -> bool:
        """True if addr refers to a remote worker node (not master/local)."""
        return bool(addr) and addr != "master"

    def get(self, addr: str, path: str, *, params=None, timeout: int = 5) -> http_requests.Response:
        """Send GET to a worker."""
        return self._session.get(f"http://{addr}{path}", params=params, timeout=timeout)

    def post(self, addr: str, path: str, *, json=None, timeout: int = 10, stream: bool = False) -> http_requests.Response:
        """Send POST to a worker."""
        return self._session.post(
            f"http://{addr}{path}", json=json, timeout=timeout, stream=stream
        )

    # ------------------------------------------------------------------
    # Higher-level operations
    # ------------------------------------------------------------------
    def start_with_retry(
        self,
        worker_addr: str,
        spins: int,
        job_id: str,
        game_name: str = "",
        interval_count: int | None = None,
        sim_type: str = "production",
        override_spin_settings: bool = True,
    ) -> dict:
        """Send POST /start to a worker with retry logic.

        Returns dict with keys: node, success, retries, error (optional).
        """
        for attempt in range(1, self.MAX_RETRIES + 1):
            try:
                response = self._session.post(
                    f"http://{worker_addr}/start",
                    json={
                        "spins": spins,
                        "job_id": job_id,
                        "game_name": game_name,
                        "interval_count": interval_count,
                        "sim_type": sim_type,
                        "override_spin_settings": override_spin_settings,
                    },
                    timeout=10,
                )
                if response.status_code == 200:
                    return {
                        "node": worker_addr,
                        "success": True,
                        "retries": attempt - 1,
                    }
                if response.status_code == 409:
                    detail = response.json() if response.text else {}
                    return {
                        "node": worker_addr,
                        "success": False,
                        "retries": attempt - 1,
                        "error": "Task already running on worker"
                        + (f" (job: {detail['job_id']})" if detail.get("job_id") else "")
                        + ", stop it first",
                    }
            except http_requests.RequestException as exc:
                if attempt < self.MAX_RETRIES:
                    time.sleep(self.RETRY_INTERVAL)
                else:
                    return {
                        "node": worker_addr,
                        "success": False,
                        "retries": attempt,
                        "error": str(exc),
                    }
        return {
            "node": worker_addr,
            "success": False,
            "retries": self.MAX_RETRIES,
            "error": "Max retries exceeded",
        }

    def proxy_post(
        self, addr: str, path: str, json_body: Any = None, timeout: int = 30, stream: bool = False
    ) -> tuple:
        """POST to a worker's Flask app and return (data_or_response, status).

        When stream=True, returns the raw requests.Response for streaming
        binary content back to the browser.
        """
        try:
            r = self._session.post(
                f"http://{addr}{path}", json=json_body, timeout=timeout, stream=stream
            )
            if stream:
                return r, r.status_code
            try:
                return r.json(), r.status_code
            except ValueError:
                return {"error": f"Worker returned non-JSON (status {r.status_code})"}, 500
        except http_requests.RequestException as exc:
            return {"error": str(exc)}, 500

    def proxy_get(self, addr: str, path: str, *, params=None, timeout: int = 10) -> tuple:
        """GET from a worker and return (json_body, status_code)."""
        try:
            r = self._session.get(f"http://{addr}{path}", params=params, timeout=timeout)
            try:
                return r.json(), r.status_code
            except ValueError:
                return {"error": f"Worker returned non-JSON (status {r.status_code})"}, 500
        except http_requests.RequestException as exc:
            return {"error": str(exc)}, 500
