"""Statistics Manager module for Tile Explorer.

Tracks round-level and session-level statistics, persisting them
to JSON files in the config/ directory.
"""

import json
import os
import uuid
from datetime import datetime, timezone


ROUND_STATS_PATH = os.path.join(
    os.path.dirname(__file__), "config", "user_round_statistics.json"
)
SESSION_STATS_PATH = os.path.join(
    os.path.dirname(__file__), "config", "user_session_statistics.json"
)


class StatisticsManager:
    """Manages round and session statistics for Tile Explorer."""

    def __init__(
        self,
        round_stats_path: str = ROUND_STATS_PATH,
        session_stats_path: str = SESSION_STATS_PATH,
    ):
        self._round_stats_path = round_stats_path
        self._session_stats_path = session_stats_path
        # In-memory session tracking: {session_id: {...}}
        self._active_sessions: dict[str, dict] = {}
        # In-memory round_id tracking for multiplayer rooms:
        # {room_code: round_id} — ensures both players share the same round_id
        self._room_round_ids: dict[str, str] = {}

        # Ensure JSON files exist
        self._ensure_file(self._round_stats_path)
        self._ensure_file(self._session_stats_path)

    @staticmethod
    def generate_id() -> str:
        """Generate a new UUID v4 string."""
        return str(uuid.uuid4())

    def get_or_create_room_round_id(self, room_code: str) -> str:
        """Get existing round_id for a room, or create one.

        Ensures both players in the same room share the same round_id.
        """
        if room_code not in self._room_round_ids:
            self._room_round_ids[room_code] = self.generate_id()
        return self._room_round_ids[room_code]

    def clear_room_round_id(self, room_code: str) -> None:
        """Clear the stored round_id for a room (after both players finish)."""
        self._room_round_ids.pop(room_code, None)

    def record_round(
        self,
        round_id: str,
        username: str,
        unique_code: str,
        level: int,
        coins: int,
        balance_before: int,
        balance_after: int,
        total_spend: int,
        total_win: int,
        room_id: str | None,
    ) -> None:
        """Append a round record to user_round_statistics.json.

        Args:
            round_id: Unique identifier for this round.
            username: Player's username.
            unique_code: Player's unique code.
            level: Level played.
            coins: Current coin balance (same as balance_after).
            balance_before: Coin balance before the round.
            balance_after: Coin balance after the round.
            total_spend: Coins spent this round.
            total_win: Coins won this round.
            room_id: Room code for multiplayer, None for single-player.
        """
        record = {
            "round_id": round_id,
            "username": username,
            "unique_code": unique_code,
            "level": level,
            "coins": coins,
            "balance_before": balance_before,
            "balance_after": balance_after,
            "total_spend": total_spend,
            "total_win": total_win,
            "room_id": room_id,
            "time": datetime.now(timezone.utc).isoformat(),
        }
        data = self._load_json(self._round_stats_path)
        data.append(record)
        self._save_json(self._round_stats_path, data)

    def start_session(
        self,
        session_id: str,
        username: str,
        unique_code: str,
        coins: int,
        level: int,
    ) -> None:
        """Record session start data in memory.

        Args:
            session_id: Unique session identifier.
            username: Player's username.
            unique_code: Player's unique code.
            coins: Coin balance at login.
            level: Level at login.
        """
        self._active_sessions[session_id] = {
            "session_id": session_id,
            "username": username,
            "unique_code": unique_code,
            "balance_before_login": coins,
            "level_before_login": level,
            "total_spend": 0,
            "total_win": 0,
        }

    def record_session_spend(self, session_id: str, amount: int) -> None:
        """Accumulate total_spend for a session.

        Args:
            session_id: The session to update.
            amount: Amount spent to add.
        """
        if session_id in self._active_sessions:
            self._active_sessions[session_id]["total_spend"] += amount

    def record_session_win(self, session_id: str, amount: int) -> None:
        """Accumulate total_win for a session.

        Args:
            session_id: The session to update.
            amount: Amount won to add.
        """
        if session_id in self._active_sessions:
            self._active_sessions[session_id]["total_win"] += amount

    def end_session(
        self,
        session_id: str,
        username: str,
        unique_code: str,
        coins: int,
        level: int,
    ) -> None:
        """Write session record to user_session_statistics.json.

        Args:
            session_id: The session identifier.
            username: Player's username.
            unique_code: Player's unique code.
            coins: Coin balance at logout.
            level: Level at logout.
        """
        session_data = self._active_sessions.pop(session_id, None)
        if session_data is None:
            # Session not tracked (e.g., server restart) — create minimal record
            session_data = {
                "session_id": session_id,
                "username": username,
                "unique_code": unique_code,
                "balance_before_login": coins,
                "level_before_login": level,
                "total_spend": 0,
                "total_win": 0,
            }

        record = {
            "session_id": session_data["session_id"],
            "username": username,
            "unique_code": unique_code,
            "level": level,
            "coins": coins,
            "balance_before_login": session_data["balance_before_login"],
            "balance_after_login": coins,
            "level_before_login": session_data["level_before_login"],
            "level_after_login": level,
            "total_spend": session_data["total_spend"],
            "total_win": session_data["total_win"],
        }
        data = self._load_json(self._session_stats_path)
        data.append(record)
        self._save_json(self._session_stats_path, data)

    def _ensure_file(self, path: str) -> None:
        """Create the JSON file with an empty array if it doesn't exist."""
        if not os.path.isfile(path):
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "w", encoding="utf-8") as f:
                json.dump([], f)

    def _load_json(self, path: str) -> list:
        """Load a JSON array from file. Returns [] on error."""
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, list):
                return data
            return []
        except (OSError, json.JSONDecodeError):
            return []

    def _save_json(self, path: str, data: list) -> None:
        """Save a JSON array to file."""
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
