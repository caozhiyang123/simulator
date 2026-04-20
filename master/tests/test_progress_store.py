"""Tests for ProgressStore – local progress snapshot persistence."""

import json
import os

from progress_store import ProgressStore


# ---------------------------------------------------------------------------
# Unit tests
# ---------------------------------------------------------------------------


class TestProgressStoreSave:
    """Unit tests for ProgressStore.save()."""

    def test_creates_directory_if_missing(self, tmp_path):
        save_dir = str(tmp_path / "nested" / "dir")
        store = ProgressStore(save_dir)
        store.save({"job_id": "j1", "nodes": {}})
        assert os.path.isdir(save_dir)

    def test_adds_timestamp_when_absent(self, tmp_path):
        store = ProgressStore(str(tmp_path))
        store.save({"job_id": "j1", "nodes": {}})

        files = list(tmp_path.iterdir())
        assert len(files) == 1
        data = json.loads(files[0].read_text(encoding="utf-8"))
        assert "timestamp" in data

    def test_preserves_existing_timestamp(self, tmp_path):
        store = ProgressStore(str(tmp_path))
        ts = "2025-01-15T10:30:00+00:00"
        store.save({"job_id": "j1", "timestamp": ts, "nodes": {}})

        files = list(tmp_path.iterdir())
        data = json.loads(files[0].read_text(encoding="utf-8"))
        assert data["timestamp"] == ts

    def test_filename_contains_timestamp(self, tmp_path):
        store = ProgressStore(str(tmp_path))
        ts = "2025-01-01T12:00:00+00:00"
        store.save({"job_id": "j1", "timestamp": ts, "nodes": {}})

        files = [f.name for f in tmp_path.iterdir()]
        assert len(files) == 1
        assert files[0].startswith("progress_")
        assert files[0].endswith(".json")

    def test_snapshot_content_round_trips(self, tmp_path):
        store = ProgressStore(str(tmp_path))
        snapshot = {
            "timestamp": "2025-06-01T00:00:00+00:00",
            "job_id": "abc",
            "nodes": {
                "master(local)": {
                    "spin_count": 100,
                    "total_win": 50.5,
                    "total_spend": 60.0,
                    "base_win": 30.0,
                    "base_spend": 40.0,
                    "eb_win": 20.5,
                    "eb_spend": 20.0,
                }
            },
        }
        store.save(snapshot)
        loaded = store.load_latest()
        assert loaded == snapshot


class TestProgressStoreLoadLatest:
    """Unit tests for ProgressStore.load_latest()."""

    def test_returns_none_when_dir_missing(self, tmp_path):
        store = ProgressStore(str(tmp_path / "nonexistent"))
        assert store.load_latest() is None

    def test_returns_none_when_dir_empty(self, tmp_path):
        store = ProgressStore(str(tmp_path))
        assert store.load_latest() is None

    def test_returns_latest_snapshot(self, tmp_path):
        store = ProgressStore(str(tmp_path))
        old = {
            "timestamp": "2025-01-01T00:00:00+00:00",
            "job_id": "old",
            "nodes": {},
        }
        new = {
            "timestamp": "2025-06-01T00:00:00+00:00",
            "job_id": "new",
            "nodes": {},
        }
        store.save(old)
        store.save(new)

        latest = store.load_latest()
        assert latest is not None
        assert latest["job_id"] == "new"

    def test_ignores_non_progress_files(self, tmp_path):
        store = ProgressStore(str(tmp_path))
        # Write a file that doesn't match the naming convention
        (tmp_path / "random.json").write_text("{}")
        assert store.load_latest() is None
