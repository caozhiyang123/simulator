"""Local file storage for progress snapshots."""

import json
import os
from datetime import datetime, timezone


class ProgressStore:
    """Persists progress snapshots as JSON files in a local directory."""

    def __init__(self, save_dir: str):
        self._save_dir = save_dir

    def save(self, snapshot: dict) -> str:
        """Save a progress snapshot to a timestamped JSON file.

        Automatically adds an ISO-format ``timestamp`` field if one is not
        already present.  Creates the save directory when it does not exist.

        Returns:
            The path of the written file.
        """
        os.makedirs(self._save_dir, exist_ok=True)

        if "timestamp" not in snapshot:
            snapshot = {
                **snapshot,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }

        # Build a filesystem-safe filename from the timestamp
        safe_ts = snapshot["timestamp"].replace(":", "-")
        filename = f"progress_{safe_ts}.json"
        filepath = os.path.join(self._save_dir, filename)

        with open(filepath, "w", encoding="utf-8") as fh:
            json.dump(snapshot, fh, ensure_ascii=False, indent=2)

        return filepath

    def load_latest(self) -> dict | None:
        """Load the most recently saved progress snapshot.

        Returns:
            The snapshot dict, or ``None`` when no snapshots exist (or the
            directory itself is missing).
        """
        if not os.path.isdir(self._save_dir):
            return None

        files = [
            f for f in os.listdir(self._save_dir)
            if f.startswith("progress_")
            and f.endswith(".json")
        ]

        if not files:
            return None

        # Filenames are timestamped – lexicographic sort
        # gives chronological order.
        files.sort()
        latest = os.path.join(self._save_dir, files[-1])

        with open(latest, "r", encoding="utf-8") as fh:
            return json.load(fh)
