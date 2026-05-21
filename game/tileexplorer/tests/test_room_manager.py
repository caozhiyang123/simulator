"""Unit tests for RoomManager module."""
import json
import os
import tempfile

import pytest

import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from room_manager import RoomManager


@pytest.fixture
def tmp_config_dir():
    """Create a temporary config directory for testing."""
    tmpdir = tempfile.mkdtemp()
    yield tmpdir


@pytest.fixture
def rm(tmp_config_dir):
    """Create a RoomManager instance with a temp directory."""
    return RoomManager(config_dir=tmp_config_dir)


class TestFileInitialization:
    def test_creates_room_list_json_on_init(self, tmp_config_dir):
        rm = RoomManager(config_dir=tmp_config_dir)
        path = os.path.join(tmp_config_dir, "room_list.json")
        assert os.path.isfile(path)
        with open(path, "r") as f:
            assert json.load(f) == []

    def test_does_not_overwrite_existing_file(self, tmp_config_dir):
        path = os.path.join(tmp_config_dir, "room_list.json")
        os.makedirs(tmp_config_dir, exist_ok=True)
        with open(path, "w") as f:
            json.dump([{"test": "data"}], f)
        rm = RoomManager(config_dir=tmp_config_dir)
        with open(path, "r") as f:
            data = json.load(f)
        assert data == [{"test": "data"}]


class TestCreateRoom:
    def test_creates_room_with_correct_fields(self, rm):
        room = rm.create_room("player1", "uuid-1234")
        assert room["alias"] == "player1"
        assert room["room_owner"] == "player1"
        assert room["room_owner_unique_code"] == "uuid-1234"
        assert len(room["unique_code"]) == 8
        assert len(room["invitation_code"]) == 8
        assert room["unique_code"] != room["invitation_code"]
        assert room["player2_username"] is None
        assert room["player2_unique_code"] is None
        assert room["spectator_access_enabled"] is True
        assert room["spectator_requires_invitation"] is True
        assert room["spectators"] == []
        assert "created_at" in room
        assert "last_activity" in room

    def test_codes_are_alphanumeric(self, rm):
        room = rm.create_room("player1", "uuid-1234")
        assert room["unique_code"].isalnum()
        assert room["invitation_code"].isalnum()

    def test_one_room_per_owner(self, rm):
        rm.create_room("player1", "uuid-1234")
        with pytest.raises(ValueError, match="close existing room"):
            rm.create_room("player1", "uuid-1234")

    def test_alias_truncated_to_20_chars(self, rm):
        long_name = "a" * 30
        room = rm.create_room(long_name, "uuid-long")
        assert len(room["alias"]) == 20
        assert room["alias"] == "a" * 20

    def test_room_persisted_to_file(self, rm, tmp_config_dir):
        room = rm.create_room("player1", "uuid-1234")
        path = os.path.join(tmp_config_dir, "room_list.json")
        with open(path, "r") as f:
            data = json.load(f)
        assert len(data) == 1
        assert data[0]["room_owner"] == "player1"


class TestJoinRoom:
    def test_join_room_success(self, rm):
        room = rm.create_room("owner", "uuid-owner")
        result = rm.join_room(
            room["unique_code"], room["invitation_code"], "player2", "uuid-p2"
        )
        assert result["player2_username"] == "player2"
        assert result["player2_unique_code"] == "uuid-p2"

    def test_wrong_invitation_code(self, rm):
        room = rm.create_room("owner", "uuid-owner")
        with pytest.raises(ValueError, match="Incorrect invitation code"):
            rm.join_room(room["unique_code"], "WRONGCODE", "p2", "uuid-p2")

    def test_room_full(self, rm):
        room = rm.create_room("owner", "uuid-owner")
        rm.join_room(room["unique_code"], room["invitation_code"], "p2", "uuid-p2")
        with pytest.raises(ValueError, match="full"):
            rm.join_room(room["unique_code"], room["invitation_code"], "p3", "uuid-p3")

    def test_owner_cannot_join_own_room(self, rm):
        room = rm.create_room("owner", "uuid-owner")
        with pytest.raises(ValueError, match="own room"):
            rm.join_room(
                room["unique_code"], room["invitation_code"], "owner", "uuid-owner"
            )

    def test_player_already_in_another_room(self, rm):
        room1 = rm.create_room("owner1", "uuid-o1")
        rm.join_room(room1["unique_code"], room1["invitation_code"], "p2", "uuid-p2")
        room2 = rm.create_room("owner2", "uuid-o2")
        with pytest.raises(ValueError, match="leave current room"):
            rm.join_room(room2["unique_code"], room2["invitation_code"], "p2", "uuid-p2")

    def test_room_not_found(self, rm):
        with pytest.raises(ValueError, match="Room not found"):
            rm.join_room("NONEXIST", "CODE1234", "p2", "uuid-p2")


class TestJoinSpectator:
    def test_spectator_join_with_invitation(self, rm):
        room = rm.create_room("owner", "uuid-owner")
        result = rm.join_spectator(
            room["unique_code"], room["invitation_code"], "spec1"
        )
        assert result is True
        rooms = rm.get_active_rooms()
        target = [r for r in rooms if r["unique_code"] == room["unique_code"]][0]
        assert "spec1" in target["spectators"]

    def test_spectator_access_disabled(self, rm):
        room = rm.create_room("owner", "uuid-owner")
        rm.update_settings(
            room["unique_code"], "owner", {"spectator_access_enabled": False}
        )
        with pytest.raises(ValueError, match="disabled"):
            rm.join_spectator(room["unique_code"], room["invitation_code"], "spec1")

    def test_spectator_wrong_invitation_code(self, rm):
        room = rm.create_room("owner", "uuid-owner")
        with pytest.raises(ValueError, match="Incorrect invitation code"):
            rm.join_spectator(room["unique_code"], "WRONGCODE", "spec1")

    def test_spectator_no_invitation_required(self, rm):
        room = rm.create_room("owner", "uuid-owner")
        rm.update_settings(
            room["unique_code"], "owner", {"spectator_requires_invitation": False}
        )
        result = rm.join_spectator(room["unique_code"], None, "spec1")
        assert result is True

    def test_max_10_spectators(self, rm):
        room = rm.create_room("owner", "uuid-owner")
        rm.update_settings(
            room["unique_code"],
            "owner",
            {"spectator_requires_invitation": False},
        )
        for i in range(10):
            rm.join_spectator(room["unique_code"], None, f"spec{i}")
        with pytest.raises(ValueError, match="full"):
            rm.join_spectator(room["unique_code"], None, "spec_overflow")


class TestDeleteRoom:
    def test_owner_can_delete(self, rm):
        room = rm.create_room("owner", "uuid-owner")
        result = rm.delete_room(room["unique_code"], "owner")
        assert result is True
        rooms = rm.get_active_rooms()
        assert all(r["unique_code"] != room["unique_code"] for r in rooms)

    def test_non_owner_cannot_delete(self, rm):
        room = rm.create_room("owner", "uuid-owner")
        with pytest.raises(ValueError, match="Unauthorized"):
            rm.delete_room(room["unique_code"], "not_owner")


class TestUpdateSettings:
    def test_owner_can_update(self, rm):
        room = rm.create_room("owner", "uuid-owner")
        result = rm.update_settings(
            room["unique_code"], "owner", {"spectator_access_enabled": False}
        )
        assert result is True
        rooms = rm.get_active_rooms()
        target = [r for r in rooms if r["unique_code"] == room["unique_code"]][0]
        assert target["spectator_access_enabled"] is False

    def test_non_owner_cannot_update(self, rm):
        room = rm.create_room("owner", "uuid-owner")
        with pytest.raises(ValueError, match="Unauthorized"):
            rm.update_settings(
                room["unique_code"], "not_owner", {"spectator_access_enabled": False}
            )

    def test_ignores_unknown_settings(self, rm):
        room = rm.create_room("owner", "uuid-owner")
        rm.update_settings(
            room["unique_code"], "owner", {"unknown_key": "value"}
        )
        rooms = rm.get_active_rooms()
        target = [r for r in rooms if r["unique_code"] == room["unique_code"]][0]
        assert "unknown_key" not in target


class TestRemoveRoom:
    def test_remove_room(self, rm):
        room = rm.create_room("owner", "uuid-owner")
        rm.remove_room(room["unique_code"])
        rooms = rm.get_active_rooms()
        assert len(rooms) == 0

    def test_remove_nonexistent_room_no_error(self, rm):
        rm.remove_room("NONEXIST")  # Should not raise


class TestCorruptionRecovery:
    def test_invalid_json_returns_empty_and_overwrites(self, tmp_config_dir):
        rm = RoomManager(config_dir=tmp_config_dir)
        path = os.path.join(tmp_config_dir, "room_list.json")
        with open(path, "w") as f:
            f.write("not valid json {{{")
        rooms = rm._load_rooms()
        assert rooms == []
        with open(path, "r") as f:
            assert json.load(f) == []

    def test_non_list_json_returns_empty_and_overwrites(self, tmp_config_dir):
        rm = RoomManager(config_dir=tmp_config_dir)
        path = os.path.join(tmp_config_dir, "room_list.json")
        with open(path, "w") as f:
            json.dump({"not": "a list"}, f)
        rooms = rm._load_rooms()
        assert rooms == []
        with open(path, "r") as f:
            assert json.load(f) == []
