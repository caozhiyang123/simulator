"""Unit tests for UserManager module."""

import json
import os
import tempfile
import uuid

import pytest

from game.tileexplorer.user_manager import UserManager


@pytest.fixture
def tmp_users_file(tmp_path):
    """Create a temporary users.json file with default users."""
    users_file = tmp_path / "users.json"
    default_users = [
        {"username": "admin", "password": "21232f297a57a5a743894a0e4a801fc3", "role": "admin"},
        {"username": "player1", "password": "hash1", "role": "worker"},
    ]
    users_file.write_text(json.dumps(default_users), encoding="utf-8")
    return str(users_file)


@pytest.fixture
def user_manager(tmp_users_file):
    """Create a UserManager instance with a temporary users file."""
    return UserManager(users_path=tmp_users_file)


class TestGetOrCreateUniqueCode:
    """Tests for get_or_create_unique_code method."""

    def test_generates_uuid_for_user_without_code(self, user_manager, tmp_users_file):
        """User without unique_code gets a new UUID v4 assigned."""
        code = user_manager.get_or_create_unique_code("admin")

        # Should be a valid UUID v4
        parsed = uuid.UUID(code, version=4)
        assert str(parsed) == code

        # Should be persisted to file
        with open(tmp_users_file, "r", encoding="utf-8") as f:
            users = json.load(f)
        admin = next(u for u in users if u["username"] == "admin")
        assert admin["unique_code"] == code
        assert admin["current_level"] == 1

    def test_returns_existing_code(self, user_manager, tmp_users_file):
        """User with existing unique_code gets the same code back."""
        # First call generates
        code1 = user_manager.get_or_create_unique_code("admin")
        # Second call returns same
        code2 = user_manager.get_or_create_unique_code("admin")
        assert code1 == code2

    def test_sets_current_level_to_1_for_new_user(self, user_manager, tmp_users_file):
        """New user gets current_level set to 1."""
        user_manager.get_or_create_unique_code("admin")

        with open(tmp_users_file, "r", encoding="utf-8") as f:
            users = json.load(f)
        admin = next(u for u in users if u["username"] == "admin")
        assert admin["current_level"] == 1

    def test_creates_entry_for_unknown_user(self, user_manager, tmp_users_file):
        """Unknown username gets a new entry created."""
        code = user_manager.get_or_create_unique_code("newplayer")

        parsed = uuid.UUID(code, version=4)
        assert str(parsed) == code

        with open(tmp_users_file, "r", encoding="utf-8") as f:
            users = json.load(f)
        new_user = next(u for u in users if u["username"] == "newplayer")
        assert new_user["unique_code"] == code
        assert new_user["current_level"] == 1

    def test_preserves_existing_fields(self, user_manager, tmp_users_file):
        """Existing user fields (password, role) are preserved."""
        user_manager.get_or_create_unique_code("admin")

        with open(tmp_users_file, "r", encoding="utf-8") as f:
            users = json.load(f)
        admin = next(u for u in users if u["username"] == "admin")
        assert admin["password"] == "21232f297a57a5a743894a0e4a801fc3"
        assert admin["role"] == "admin"


class TestGetCurrentLevel:
    """Tests for get_current_level method."""

    def test_returns_1_for_user_without_level(self, user_manager):
        """User without current_level returns 1."""
        level = user_manager.get_current_level("admin")
        assert level == 1

    def test_returns_stored_level(self, tmp_path):
        """Returns the stored current_level value."""
        users_file = tmp_path / "users.json"
        users_file.write_text(json.dumps([
            {"username": "player", "current_level": 15}
        ]), encoding="utf-8")
        um = UserManager(users_path=str(users_file))

        assert um.get_current_level("player") == 15

    def test_returns_1_for_unknown_user(self, user_manager):
        """Unknown user returns level 1."""
        assert user_manager.get_current_level("nonexistent") == 1

    def test_caps_level_at_60(self, tmp_path):
        """Level above 60 is capped to 60."""
        users_file = tmp_path / "users.json"
        users_file.write_text(json.dumps([
            {"username": "player", "current_level": 100}
        ]), encoding="utf-8")
        um = UserManager(users_path=str(users_file))

        assert um.get_current_level("player") == 60

    def test_caps_level_at_1_minimum(self, tmp_path):
        """Level below 1 is capped to 1."""
        users_file = tmp_path / "users.json"
        users_file.write_text(json.dumps([
            {"username": "player", "current_level": 0}
        ]), encoding="utf-8")
        um = UserManager(users_path=str(users_file))

        assert um.get_current_level("player") == 1


class TestUpdateLevel:
    """Tests for update_level method."""

    def test_updates_level(self, user_manager, tmp_users_file):
        """Level is updated and persisted."""
        user_manager.update_level("admin", 10)

        with open(tmp_users_file, "r", encoding="utf-8") as f:
            users = json.load(f)
        admin = next(u for u in users if u["username"] == "admin")
        assert admin["current_level"] == 10

    def test_caps_level_at_60(self, user_manager, tmp_users_file):
        """Level above 60 is capped to 60."""
        user_manager.update_level("admin", 100)

        with open(tmp_users_file, "r", encoding="utf-8") as f:
            users = json.load(f)
        admin = next(u for u in users if u["username"] == "admin")
        assert admin["current_level"] == 60

    def test_caps_level_at_1(self, user_manager, tmp_users_file):
        """Level below 1 is capped to 1."""
        user_manager.update_level("admin", -5)

        with open(tmp_users_file, "r", encoding="utf-8") as f:
            users = json.load(f)
        admin = next(u for u in users if u["username"] == "admin")
        assert admin["current_level"] == 1

    def test_no_op_for_unknown_user(self, user_manager, tmp_users_file):
        """Update for unknown user does nothing."""
        user_manager.update_level("nonexistent", 10)

        with open(tmp_users_file, "r", encoding="utf-8") as f:
            users = json.load(f)
        # No new user should be added
        assert not any(u["username"] == "nonexistent" for u in users)


class TestLoadUsers:
    """Tests for _load_users method."""

    def test_loads_from_file(self, user_manager, tmp_users_file):
        """Loads users from the JSON file."""
        users = user_manager._load_users()
        assert len(users) == 2
        assert users[0]["username"] == "admin"

    def test_returns_empty_for_missing_file(self, tmp_path):
        """Returns empty list if file doesn't exist."""
        um = UserManager(users_path=str(tmp_path / "nonexistent.json"))
        assert um._load_users() == []

    def test_returns_empty_for_invalid_json(self, tmp_path):
        """Returns empty list if file contains invalid JSON."""
        users_file = tmp_path / "users.json"
        users_file.write_text("not valid json {{{", encoding="utf-8")
        um = UserManager(users_path=str(users_file))
        assert um._load_users() == []

    def test_returns_empty_for_non_array_json(self, tmp_path):
        """Returns empty list if JSON is not an array."""
        users_file = tmp_path / "users.json"
        users_file.write_text('{"not": "an array"}', encoding="utf-8")
        um = UserManager(users_path=str(users_file))
        assert um._load_users() == []


class TestSaveUsers:
    """Tests for _save_users method."""

    def test_persists_to_file(self, user_manager, tmp_users_file):
        """Users are written to the JSON file."""
        users = [{"username": "test", "current_level": 5}]
        user_manager._save_users(users)

        with open(tmp_users_file, "r", encoding="utf-8") as f:
            saved = json.load(f)
        assert saved == users

    def test_retains_in_memory_on_write_failure(self, tmp_path):
        """On write failure, data is retained in memory."""
        # Use a path that can't be written to (directory as file path)
        bad_path = str(tmp_path / "nonexistent_dir" / "subdir" / "users.json")
        um = UserManager(users_path=bad_path)

        users = [{"username": "test", "current_level": 5}]
        um._save_users(users)

        # Data should be retained in memory
        assert um._users == users

    def test_retries_write_on_next_save(self, tmp_path):
        """After a failed write, next save retries with accumulated data."""
        # First, create a situation where write fails
        bad_dir = tmp_path / "readonly"
        bad_dir.mkdir()
        bad_file = bad_dir / "users.json"

        um = UserManager(users_path=str(bad_file))

        # Write initial data successfully
        users = [{"username": "test", "current_level": 5}]
        um._save_users(users)

        # Verify it was written
        with open(str(bad_file), "r", encoding="utf-8") as f:
            saved = json.load(f)
        assert saved == users
        assert um._users is None  # Cache cleared on success

    def test_uses_cached_data_after_write_failure(self, tmp_path):
        """After write failure, _load_users returns cached data."""
        bad_path = str(tmp_path / "no_such_dir" / "deep" / "users.json")
        um = UserManager(users_path=bad_path)

        users = [{"username": "cached_user", "current_level": 3}]
        um._save_users(users)

        # _load_users should return the cached data
        loaded = um._load_users()
        assert loaded == users
