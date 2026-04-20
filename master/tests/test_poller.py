"""Tests for master.poller.ProgressPoller."""

import time
from unittest.mock import patch, MagicMock

from poller import ProgressPoller


# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------

def _make_master_status_fn(status="running", spins=500):
    """Return a callable that produces a fixed master status dict."""
    def fn():
        return {"status": status, "spin_count": spins}
    return fn


def _make_worker_response(status="running", spins=300):
    """Build a mock requests.Response for a worker /status call."""
    resp = MagicMock()
    resp.status_code = 200
    resp.raise_for_status = MagicMock()
    resp.json.return_value = {"status": status, "spin_count": spins}
    return resp


# ------------------------------------------------------------------
# Unit tests
# ------------------------------------------------------------------

class TestProgressPollerStartStop:
    """Basic lifecycle tests."""

    def test_start_creates_daemon_thread(self):
        poller = ProgressPoller(interval=10.0)
        poller.start(nodes=[])
        assert poller._thread is not None
        assert poller._thread.is_alive()
        assert poller._thread.daemon is True
        poller.stop()

    def test_stop_terminates_thread(self):
        poller = ProgressPoller(interval=10.0)
        poller.start(nodes=[])
        poller.stop()
        assert poller._thread is None

    def test_double_start_is_noop(self):
        poller = ProgressPoller(interval=10.0)
        poller.start(nodes=[])
        first_thread = poller._thread
        poller.start(nodes=[])
        assert poller._thread is first_thread
        poller.stop()


class TestGetSnapshot:
    """Snapshot collection tests."""

    @patch("poller.requests.get")
    def test_snapshot_contains_all_nodes(self, mock_get):
        mock_get.return_value = _make_worker_response()
        master_fn = _make_master_status_fn()

        poller = ProgressPoller(
            interval=0.05,
            master_status_fn=master_fn,
        )
        poller.start(nodes=["10.0.0.1:5001", "10.0.0.2:5001"])
        time.sleep(0.2)
        snap = poller.get_snapshot()
        poller.stop()

        assert "timestamp" in snap
        assert "nodes" in snap
        assert "master(local)" in snap["nodes"]
        assert "worker(10.0.0.1:5001)" in snap["nodes"]
        assert "worker(10.0.0.2:5001)" in snap["nodes"]

    @patch("poller.requests.get")
    def test_snapshot_master_status(self, mock_get):
        mock_get.return_value = _make_worker_response()
        master_fn = _make_master_status_fn("running", 999)

        poller = ProgressPoller(
            interval=0.05,
            master_status_fn=master_fn,
        )
        poller.start(nodes=[])
        time.sleep(0.2)
        snap = poller.get_snapshot()
        poller.stop()

        master_node = snap["nodes"]["master(local)"]
        assert master_node["status"] == "running"
        assert master_node["spin_count"] == 999

    def test_snapshot_without_master_fn_defaults_idle(self):
        poller = ProgressPoller(interval=0.05)
        poller.start(nodes=[])
        time.sleep(0.2)
        snap = poller.get_snapshot()
        poller.stop()

        assert snap["nodes"]["master(local)"]["status"] == "idle"


class TestWorkerErrorHandling:
    """Worker /status timeout / failure → error status."""

    @patch("poller.requests.get")
    def test_worker_timeout_marked_error(self, mock_get):
        mock_get.side_effect = Exception("Connection timed out")

        poller = ProgressPoller(interval=0.05)
        poller.start(nodes=["10.0.0.1:5001"])
        time.sleep(0.2)
        snap = poller.get_snapshot()
        poller.stop()

        worker = snap["nodes"]["worker(10.0.0.1:5001)"]
        assert worker["status"] == "error"
        assert "error" in worker

    @patch("poller.requests.get")
    def test_worker_http_error_marked_error(self, mock_get):
        resp = MagicMock()
        resp.raise_for_status.side_effect = Exception("500 Server Error")
        mock_get.return_value = resp

        poller = ProgressPoller(interval=0.05)
        poller.start(nodes=["10.0.0.1:5001"])
        time.sleep(0.2)
        snap = poller.get_snapshot()
        poller.stop()

        worker = snap["nodes"]["worker(10.0.0.1:5001)"]
        assert worker["status"] == "error"


class TestSetInterval:
    """Dynamic interval change."""

    @patch("poller.requests.get")
    def test_set_interval_updates_value(self, mock_get):
        mock_get.return_value = _make_worker_response()
        poller = ProgressPoller(interval=10.0)
        poller.start(nodes=[])
        poller.set_interval(0.05)
        assert poller._interval == 0.05
        # The wake event should be set so the thread picks up
        # the new interval immediately.
        time.sleep(0.2)
        snap = poller.get_snapshot()
        poller.stop()
        # If interval change worked, we should have a snapshot
        assert "timestamp" in snap


class TestProgressStoreIntegration:
    """Verify snapshots are persisted when a store is provided."""

    @patch("poller.requests.get")
    def test_snapshots_saved_to_store(self, mock_get, tmp_path):
        mock_get.return_value = _make_worker_response()
        from master.progress_store import ProgressStore
        store = ProgressStore(save_dir=str(tmp_path))

        poller = ProgressPoller(
            interval=0.05,
            progress_store=store,
        )
        poller.start(nodes=["10.0.0.1:5001"])
        time.sleep(0.3)
        poller.stop()

        loaded = store.load_latest()
        assert loaded is not None
        assert "nodes" in loaded


class TestMasterStatusFnError:
    """Master status callback raising should not crash the poller."""

    def test_master_fn_exception_yields_error_status(self):
        def bad_fn():
            raise RuntimeError("boom")

        poller = ProgressPoller(
            interval=0.05,
            master_status_fn=bad_fn,
        )
        poller.start(nodes=[])
        time.sleep(0.2)
        snap = poller.get_snapshot()
        poller.stop()

        master = snap["nodes"]["master(local)"]
        assert master["status"] == "error"
