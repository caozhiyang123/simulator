"""Room Manager module for Tile Explorer multiplayer."""
import json
import os
import random
import string
from datetime import datetime, timezone


class RoomManager:
    """Manages room lifecycle: creation, joining, deletion, persistence."""

    def __init__(self, config_dir: str | None = None):
        if config_dir is None:
            config_dir = os.path.join(os.path.dirname(__file__), "config")
        self._config_dir = config_dir
        self._room_list_path = os.path.join(self._config_dir, "room_list.json")
        self._ensure_file_exists()

    def _ensure_file_exists(self) -> None:
        """Initialize room_list.json as empty array if not exists."""
        os.makedirs(self._config_dir, exist_ok=True)
        if not os.path.isfile(self._room_list_path):
            self._save_rooms([])

    def _generate_unique_code(self, length: int = 8) -> str:
        """Generate alphanumeric code not matching any existing code."""
        rooms = self._load_rooms()
        existing_codes = set()
        for room in rooms:
            existing_codes.add(room.get("unique_code", ""))
            existing_codes.add(room.get("invitation_code", ""))

        chars = string.ascii_uppercase + string.digits
        while True:
            code = "".join(random.choices(chars, k=length))
            if code not in existing_codes:
                return code

    def _load_rooms(self) -> list[dict]:
        """Load rooms from room_list.json, handling corruption."""
        if not os.path.isfile(self._room_list_path):
            return []
        try:
            with open(self._room_list_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            if not isinstance(data, list):
                self._save_rooms([])
                return []
            return data
        except (json.JSONDecodeError, ValueError):
            self._save_rooms([])
            return []

    def _save_rooms(self, rooms: list[dict]) -> None:
        """Persist rooms to room_list.json."""
        os.makedirs(self._config_dir, exist_ok=True)
        with open(self._room_list_path, "w", encoding="utf-8") as f:
            json.dump(rooms, f, ensure_ascii=False, indent=2)

    def create_room(self, owner_username: str, owner_unique_code: str,
                    game_name: str = "") -> dict:
        """Create a new room. Returns room dict or raises ValueError."""
        rooms = self._load_rooms()

        # Enforce one room per owner (Req 3.7)
        for room in rooms:
            if room.get("room_owner") == owner_username:
                raise ValueError(
                    "Must close existing room before creating a new one"
                )

        # Generate unique codes that don't collide with any existing codes
        existing_codes = set()
        for room in rooms:
            existing_codes.add(room.get("unique_code", ""))
            existing_codes.add(room.get("invitation_code", ""))

        chars = string.ascii_uppercase + string.digits

        # Generate room unique_code
        while True:
            room_code = "".join(random.choices(chars, k=8))
            if room_code not in existing_codes:
                existing_codes.add(room_code)
                break

        # Generate invitation_code
        while True:
            invitation_code = "".join(random.choices(chars, k=8))
            if invitation_code not in existing_codes:
                break

        now = datetime.now(timezone.utc).isoformat()

        # Alias derived from owner username, truncated to 20 chars (Req 12.5)
        alias = owner_username[:20]

        room = {
            "game_name": game_name,
            "alias": alias,
            "unique_code": room_code,
            "invitation_code": invitation_code,
            "room_owner": owner_username,
            "room_owner_unique_code": owner_unique_code,
            "player2_username": None,
            "player2_unique_code": None,
            "spectator_access_enabled": True,
            "spectator_requires_invitation": True,
            "spectators": [],
            "created_at": now,
            "last_activity": now,
        }

        rooms.append(room)
        self._save_rooms(rooms)
        return room

    def join_room(
        self,
        room_code: str,
        invitation_code: str,
        username: str,
        unique_code: str,
    ) -> dict:
        """Join an existing room as player 2. Returns updated room dict."""
        rooms = self._load_rooms()

        # Find the target room
        target_room = None
        for room in rooms:
            if room.get("unique_code") == room_code:
                target_room = room
                break

        if target_room is None:
            raise ValueError("Room not found")

        # Validate invitation code (Req 4.3, 4.4)
        if target_room.get("invitation_code") != invitation_code:
            raise ValueError("Incorrect invitation code")

        # Check capacity - max 2 players (Req 4.5)
        if target_room.get("player2_username") is not None:
            raise ValueError("Room is full")

        # Owner cannot join own room (Req 4.6)
        if target_room.get("room_owner") == username:
            raise ValueError("Cannot join your own room")

        # Player cannot join if already in another room (Req 4.7)
        for room in rooms:
            if room.get("unique_code") == room_code:
                continue
            if (
                room.get("room_owner") == username
                or room.get("player2_username") == username
            ):
                raise ValueError("Must leave current room first")

        # Add player to room
        target_room["player2_username"] = username
        target_room["player2_unique_code"] = unique_code
        target_room["last_activity"] = datetime.now(timezone.utc).isoformat()

        self._save_rooms(rooms)
        return target_room

    def join_spectator(
        self,
        room_code: str,
        invitation_code: str | None,
        username: str,
    ) -> bool:
        """Join a room as spectator. Returns True on success."""
        rooms = self._load_rooms()

        # Find the target room
        target_room = None
        for room in rooms:
            if room.get("unique_code") == room_code:
                target_room = room
                break

        if target_room is None:
            raise ValueError("Room not found")

        # Check if spectator access is enabled (Req 6.2)
        if not target_room.get("spectator_access_enabled", True):
            raise ValueError("Spectator access is disabled")

        # Check invitation code if required (Req 6.3, 6.4)
        if target_room.get("spectator_requires_invitation", True):
            if invitation_code != target_room.get("invitation_code"):
                raise ValueError("Incorrect invitation code")

        # Check spectator capacity - max 10 (Req 6.7, 6.8)
        spectators = target_room.get("spectators", [])
        if len(spectators) >= 10:
            raise ValueError("Spectator slots full")

        # Add spectator
        spectators.append(username)
        target_room["spectators"] = spectators
        target_room["last_activity"] = datetime.now(timezone.utc).isoformat()

        self._save_rooms(rooms)
        return True

    def delete_room(self, room_code: str, requesting_user: str) -> bool:
        """Delete a room (owner only). Returns True on success."""
        rooms = self._load_rooms()

        target_room = None
        for room in rooms:
            if room.get("unique_code") == room_code:
                target_room = room
                break

        if target_room is None:
            raise ValueError("Room not found")

        # Owner-only authorization (Req 7.4, 7.5)
        if target_room.get("room_owner") != requesting_user:
            raise ValueError("Unauthorized: only the room owner can delete")

        rooms = [r for r in rooms if r.get("unique_code") != room_code]
        self._save_rooms(rooms)
        return True

    def update_settings(
        self, room_code: str, requesting_user: str, settings: dict
    ) -> bool:
        """Update room settings (owner only). Returns True on success."""
        rooms = self._load_rooms()

        target_room = None
        for room in rooms:
            if room.get("unique_code") == room_code:
                target_room = room
                break

        if target_room is None:
            raise ValueError("Room not found")

        # Owner-only authorization (Req 7.5)
        if target_room.get("room_owner") != requesting_user:
            raise ValueError("Unauthorized: only the room owner can update settings")

        # Apply allowed settings
        allowed_keys = {"spectator_access_enabled", "spectator_requires_invitation"}
        for key, value in settings.items():
            if key in allowed_keys:
                target_room[key] = value

        target_room["last_activity"] = datetime.now(timezone.utc).isoformat()
        self._save_rooms(rooms)
        return True

    def get_active_rooms(self) -> list[dict]:
        """Return list of active rooms for lobby display."""
        return self._load_rooms()

    def remove_room(self, room_code: str) -> None:
        """Remove room from storage (used by auto-close)."""
        rooms = self._load_rooms()
        rooms = [r for r in rooms if r.get("unique_code") != room_code]
        self._save_rooms(rooms)
