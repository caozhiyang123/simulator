"""Local file storage for progress snapshots.

Only keeps a single file (latest.json) that gets overwritten each time,
avoiding the accumulation of thousands of small files.
"""

import json
import os
from datetime import datetime, timezone


class ProgressStore:
    """Persists the latest progress snapshot as a single JSON file."""

    def __init__(self, save_dir: str):
        self._save_dir = save_dir
        self._filepath = os.path.join(save_dir, "latest.json")

    def save(self, snapshot: dict) -> str:
        """Save a progress snapshot, overwriting the previous one.

        Returns:
            The path of the written file.
        """
        os.makedirs(self._save_dir, exist_ok=True)

        if "timestamp" not in snapshot:
            snapshot = {
                **snapshot,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }

        with open(self._filepath, "w", encoding="utf-8") as fh:
            json.dump(snapshot, fh, ensure_ascii=False, indent=2)

        return self._filepath

    def load_latest(self) -> dict | None:
        """Load the most recently saved progress snapshot.

        Returns:
            The snapshot dict, or None when no snapshot exists.
        """
        if not os.path.isfile(self._filepath):
            return None

        with open(self._filepath, "r", encoding="utf-8") as fh:
            return json.load(fh)
