"""User Manager module for Tile Explorer multiplayer system.

Manages user data: unique codes, level progress, and persistence to users.json.
"""

import json
import os
import uuid


USERS_PATH = os.path.join(os.path.dirname(__file__), "config", "users.json")


class UserManager:
    """Manages user data: unique codes, level progress."""

    def __init__(self, users_path: str = USERS_PATH):
        self._users_path = users_path
        self._users: list[dict] | None = None

    def get_or_create_unique_code(self, username: str) -> str:
        """Get existing unique_code or generate UUID v4 for new user.

        If the user does not have a unique_code, generates a new UUID v4
        and sets current_level to 1.
        """
        users = self._load_users()
        for user in users:
            if user["username"] == username:
                if "unique_code" in user and user["unique_code"]:
                    return user["unique_code"]
                # Existing user without unique_code — assign one
                user["unique_code"] = str(uuid.uuid4())
                user["current_level"] = user.get("current_level", 1)
                self._save_users(users)
                return user["unique_code"]
        # User not found — should not happen in normal flow since login
        # validates credentials first, but handle gracefully
        new_user = {
            "username": username,
            "unique_code": str(uuid.uuid4()),
            "current_level": 1,
        }
        users.append(new_user)
        self._save_users(users)
        return new_user["unique_code"]

    def get_current_level(self, username: str) -> int:
        """Get player's current level (1-60).

        Returns 1 if the user is not found or has no current_level set.
        """
        users = self._load_users()
        for user in users:
            if user["username"] == username:
                level = user.get("current_level", 1)
                # Ensure level is within valid range
                return max(1, min(60, level))
        return 1

    def update_level(self, username: str, level: int) -> None:
        """Update player's current level and persist.

        Level is capped to the range [1, 60].
        """
        # Cap level to valid range
        level = max(1, min(60, level))

        users = self._load_users()
        for user in users:
            if user["username"] == username:
                user["current_level"] = level
                self._save_users(users)
                return
        # User not found — no-op (shouldn't happen in normal flow)

    def _load_users(self) -> list[dict]:
        """Load users from users.json.

        If in-memory cache exists (due to previous write failure),
        returns that. Otherwise reads from disk. Returns empty list
        if file doesn't exist or contains invalid JSON.
        """
        # If we have in-memory data from a failed write, use it
        if self._users is not None:
            return self._users

        if not os.path.isfile(self._users_path):
            return []

        try:
            with open(self._users_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, list):
                return data
            return []
        except (json.JSONDecodeError, OSError):
            return []

    def _save_users(self, users: list[dict]) -> None:
        """Persist users to users.json.

        If write fails, retains data in memory for retry on next update.
        """
        try:
            with open(self._users_path, "w", encoding="utf-8") as f:
                json.dump(users, f, ensure_ascii=False, indent=2)
            # Write succeeded — clear in-memory cache
            self._users = None
        except OSError:
            # Write failed — retain in memory for retry on next update
            self._users = users
