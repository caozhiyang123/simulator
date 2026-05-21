"""Shared test fixtures for Tile Explorer tests."""
import os
import sys
import tempfile

import pytest

# Ensure the tileexplorer package is importable
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


@pytest.fixture
def app_client(tmp_path):
    """Create a Flask test client with isolated config/data directories."""
    # Create temp config directory with required files
    config_dir = tmp_path / "config"
    config_dir.mkdir()

    # Write minimal config.json
    import json
    config = {"port": 5002, "levels": {"1": {"shape": "circle", "count": 9}}}
    (config_dir / "config.json").write_text(json.dumps(config), encoding="utf-8")

    # Write minimal users.json
    import hashlib
    users = [
        {
            "username": "testuser",
            "password": hashlib.md5(b"testpass").hexdigest(),
            "role": "worker",
            "unique_code": "test-uuid-1234",
            "current_level": 1,
        },
        {
            "username": "testuser2",
            "password": hashlib.md5(b"testpass2").hexdigest(),
            "role": "worker",
            "unique_code": "test-uuid-5678",
            "current_level": 1,
        },
    ]
    (config_dir / "users.json").write_text(json.dumps(users), encoding="utf-8")

    # Patch paths before importing app
    import game.tileexplorer.app as app_module

    original_config_path = app_module.CONFIG_PATH
    original_users_path = app_module.USERS_PATH

    app_module.CONFIG_PATH = str(config_dir / "config.json")
    app_module.USERS_PATH = str(config_dir / "users.json")

    # Re-instantiate managers with temp paths
    from room_manager import RoomManager
    from user_manager import UserManager

    app_module.room_manager = RoomManager(config_dir=str(config_dir))
    app_module.user_manager = UserManager(users_path=str(config_dir / "users.json"))

    app_module.app.config["TESTING"] = True
    app_module.app.config["SECRET_KEY"] = "test-secret"

    client = app_module.app.test_client()

    yield client

    # Restore original paths
    app_module.CONFIG_PATH = original_config_path
    app_module.USERS_PATH = original_users_path


def _login(client, username="testuser", password="testpass"):
    """Helper to log in a test user."""
    return client.post(
        "/auth/login",
        json={"username": username, "password": password},
    )
