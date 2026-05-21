"""Unit tests for room API routes."""
import json
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from tests.conftest import _login


class TestGetRooms:
    """Tests for GET /api/rooms."""

    def test_returns_empty_list_when_no_rooms(self, app_client):
        _login(app_client)
        resp = app_client.get("/api/rooms")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["rooms"] == []

    def test_returns_rooms_after_creation(self, app_client):
        _login(app_client)
        app_client.post("/api/rooms/create")
        resp = app_client.get("/api/rooms")
        assert resp.status_code == 200
        data = resp.get_json()
        assert len(data["rooms"]) == 1
        room = data["rooms"][0]
        assert "alias" in room
        assert "unique_code" in room
        assert "player_count" in room
        assert room["player_count"] == 1

    def test_requires_login(self, app_client):
        resp = app_client.get("/api/rooms")
        assert resp.status_code == 302  # Redirect to login


class TestCreateRoom:
    """Tests for POST /api/rooms/create."""

    def test_creates_room_successfully(self, app_client):
        _login(app_client)
        resp = app_client.post("/api/rooms/create")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["status"] == "ok"
        assert "room" in data
        assert "redirect" in data
        assert data["redirect"].startswith("/battle/")
        assert data["room"]["room_owner"] == "testuser"

    def test_returns_409_when_owner_has_existing_room(self, app_client):
        _login(app_client)
        app_client.post("/api/rooms/create")
        resp = app_client.post("/api/rooms/create")
        assert resp.status_code == 409
        data = resp.get_json()
        assert "error" in data

    def test_requires_login(self, app_client):
        resp = app_client.post("/api/rooms/create")
        assert resp.status_code == 302


class TestJoinRoom:
    """Tests for POST /api/rooms/join."""

    def test_join_room_successfully(self, app_client):
        # Create room as testuser
        _login(app_client)
        create_resp = app_client.post("/api/rooms/create")
        room_data = create_resp.get_json()
        room_code = room_data["room"]["unique_code"]
        invitation_code = room_data["room"]["invitation_code"]

        # Logout and login as testuser2
        app_client.post("/auth/logout")
        _login(app_client, "testuser2", "testpass2")

        resp = app_client.post("/api/rooms/join", json={
            "room_code": room_code,
            "invitation_code": invitation_code,
        })
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["status"] == "ok"
        assert data["redirect"] == f"/battle/{room_code}"

    def test_returns_403_for_wrong_invitation_code(self, app_client):
        _login(app_client)
        create_resp = app_client.post("/api/rooms/create")
        room_data = create_resp.get_json()
        room_code = room_data["room"]["unique_code"]

        app_client.post("/auth/logout")
        _login(app_client, "testuser2", "testpass2")

        resp = app_client.post("/api/rooms/join", json={
            "room_code": room_code,
            "invitation_code": "WRONGCODE",
        })
        assert resp.status_code == 403

    def test_returns_404_for_nonexistent_room(self, app_client):
        _login(app_client)
        resp = app_client.post("/api/rooms/join", json={
            "room_code": "NOEXIST1",
            "invitation_code": "WHATEVER",
        })
        assert resp.status_code == 404

    def test_returns_409_when_room_full(self, app_client):
        # Create room as testuser
        _login(app_client)
        create_resp = app_client.post("/api/rooms/create")
        room_data = create_resp.get_json()
        room_code = room_data["room"]["unique_code"]
        invitation_code = room_data["room"]["invitation_code"]

        # Join as testuser2
        app_client.post("/auth/logout")
        _login(app_client, "testuser2", "testpass2")
        app_client.post("/api/rooms/join", json={
            "room_code": room_code,
            "invitation_code": invitation_code,
        })

        # Try to join again (room is full) - need a third user
        # Since we only have 2 test users, we verify the room is full
        # by trying to join again with the same user (already in room)
        app_client.post("/auth/logout")
        _login(app_client, "testuser2", "testpass2")
        resp = app_client.post("/api/rooms/join", json={
            "room_code": room_code,
            "invitation_code": invitation_code,
        })
        # Should get 409 because room is full
        assert resp.status_code == 409


class TestSpectateRoom:
    """Tests for POST /api/rooms/spectate."""

    def test_spectate_room_with_invitation(self, app_client):
        _login(app_client)
        create_resp = app_client.post("/api/rooms/create")
        room_data = create_resp.get_json()
        room_code = room_data["room"]["unique_code"]
        invitation_code = room_data["room"]["invitation_code"]

        app_client.post("/auth/logout")
        _login(app_client, "testuser2", "testpass2")

        resp = app_client.post("/api/rooms/spectate", json={
            "room_code": room_code,
            "invitation_code": invitation_code,
        })
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["status"] == "ok"
        assert data["redirect"] == f"/battle/{room_code}"

    def test_returns_403_for_wrong_invitation_code(self, app_client):
        _login(app_client)
        create_resp = app_client.post("/api/rooms/create")
        room_data = create_resp.get_json()
        room_code = room_data["room"]["unique_code"]

        app_client.post("/auth/logout")
        _login(app_client, "testuser2", "testpass2")

        resp = app_client.post("/api/rooms/spectate", json={
            "room_code": room_code,
            "invitation_code": "WRONGCODE",
        })
        assert resp.status_code == 403

    def test_returns_403_when_spectator_access_disabled(self, app_client):
        _login(app_client)
        create_resp = app_client.post("/api/rooms/create")
        room_data = create_resp.get_json()
        room_code = room_data["room"]["unique_code"]

        # Disable spectator access
        app_client.post(f"/api/rooms/{room_code}/settings", json={
            "spectator_access_enabled": False,
        })

        app_client.post("/auth/logout")
        _login(app_client, "testuser2", "testpass2")

        resp = app_client.post("/api/rooms/spectate", json={
            "room_code": room_code,
            "invitation_code": "ANYTHING",
        })
        assert resp.status_code == 403

    def test_returns_404_for_nonexistent_room(self, app_client):
        _login(app_client)
        resp = app_client.post("/api/rooms/spectate", json={
            "room_code": "NOEXIST1",
            "invitation_code": "WHATEVER",
        })
        assert resp.status_code == 404


class TestDeleteRoom:
    """Tests for POST /api/rooms/<code>/delete."""

    def test_owner_can_delete_room(self, app_client):
        _login(app_client)
        create_resp = app_client.post("/api/rooms/create")
        room_data = create_resp.get_json()
        room_code = room_data["room"]["unique_code"]

        resp = app_client.post(f"/api/rooms/{room_code}/delete")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["status"] == "ok"

        # Verify room is gone
        rooms_resp = app_client.get("/api/rooms")
        assert rooms_resp.get_json()["rooms"] == []

    def test_non_owner_cannot_delete(self, app_client):
        _login(app_client)
        create_resp = app_client.post("/api/rooms/create")
        room_data = create_resp.get_json()
        room_code = room_data["room"]["unique_code"]

        app_client.post("/auth/logout")
        _login(app_client, "testuser2", "testpass2")

        resp = app_client.post(f"/api/rooms/{room_code}/delete")
        assert resp.status_code == 403

    def test_returns_404_for_nonexistent_room(self, app_client):
        _login(app_client)
        resp = app_client.post("/api/rooms/NOEXIST1/delete")
        assert resp.status_code == 404


class TestUpdateRoomSettings:
    """Tests for POST /api/rooms/<code>/settings."""

    def test_owner_can_update_settings(self, app_client):
        _login(app_client)
        create_resp = app_client.post("/api/rooms/create")
        room_data = create_resp.get_json()
        room_code = room_data["room"]["unique_code"]

        resp = app_client.post(f"/api/rooms/{room_code}/settings", json={
            "spectator_access_enabled": False,
            "spectator_requires_invitation": False,
        })
        assert resp.status_code == 200
        assert resp.get_json()["status"] == "ok"

    def test_non_owner_cannot_update_settings(self, app_client):
        _login(app_client)
        create_resp = app_client.post("/api/rooms/create")
        room_data = create_resp.get_json()
        room_code = room_data["room"]["unique_code"]

        app_client.post("/auth/logout")
        _login(app_client, "testuser2", "testpass2")

        resp = app_client.post(f"/api/rooms/{room_code}/settings", json={
            "spectator_access_enabled": False,
        })
        assert resp.status_code == 403

    def test_returns_404_for_nonexistent_room(self, app_client):
        _login(app_client)
        resp = app_client.post("/api/rooms/NOEXIST1/settings", json={
            "spectator_access_enabled": False,
        })
        assert resp.status_code == 404
