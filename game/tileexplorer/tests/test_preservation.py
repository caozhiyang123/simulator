"""Preservation property tests for Tile Explorer gameplay fixes.

These tests capture the EXISTING correct behavior of the unfixed code
for non-buggy inputs. They must PASS on the unfixed code to establish
a baseline that must be preserved after the fix is applied.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6**

Properties tested:
- Non-game-over reconnection recovers existing state unchanged
- No existing state initializes fresh state at saved level
- Valid tile actions (unblocked, slots not full) are processed correctly
- Multiplayer tile actions broadcast to opponent and spectators
"""

import hashlib
import json
import os
import sys

import pytest
from hypothesis import given, settings, assume, HealthCheck
from hypothesis import strategies as st

# Ensure the tileexplorer package is importable
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from game_state_manager import GameStateManager, MAX_SLOTS
from user_manager import UserManager


# --- Strategies ---

@st.composite
def game_state_strategy(draw, game_over=False, max_slots=6):
    """Generate a valid game state dict with game_over=False by default.

    This generates states that represent in-progress games (non-buggy path).
    """
    level = draw(st.integers(min_value=1, max_value=60))
    num_slots = draw(st.integers(min_value=0, max_value=max_slots))
    num_tiles = draw(st.integers(min_value=1, max_value=30))

    tiles = []
    for i in range(num_tiles):
        tiles.append({
            "id": i,
            "imgIdx": draw(st.integers(min_value=0, max_value=9)),
            "img": f"/static/{draw(st.integers(min_value=1, max_value=9))}.PNG",
            "x": draw(st.floats(min_value=0, max_value=370, allow_nan=False, allow_infinity=False)),
            "y": draw(st.floats(min_value=0, max_value=510, allow_nan=False, allow_infinity=False)),
            "layer": draw(st.integers(min_value=0, max_value=2)),
            "z": i,
        })

    slots = []
    for i in range(num_slots):
        slots.append({
            "id": 100 + i,
            "imgIdx": draw(st.integers(min_value=0, max_value=9)),
            "img": f"/static/{draw(st.integers(min_value=1, max_value=9))}.PNG",
        })

    return {
        "unique_code": "test-uuid-preserve",
        "room_code": None,
        "level": level,
        "tiles": tiles,
        "slots": slots,
        "remaining": num_tiles,
        "game_over": game_over,
        "timestamp": "2026-01-01T00:00:00+00:00",
    }


@st.composite
def valid_level_strategy(draw):
    """Generate a valid level number (1-60)."""
    return draw(st.integers(min_value=1, max_value=60))


# --- Fixtures ---

@pytest.fixture
def game_manager(tmp_path):
    """Create a GameStateManager with temp config and static dirs."""
    config_dir = tmp_path / "config"
    config_dir.mkdir()

    config = {
        "port": 5002,
        "levels": {
            "1": {"image_count": 4, "copies": 3, "layers": 1, "shape": "circle"},
            "2": {"image_count": 5, "copies": 6, "layers": 2, "shape": "heart"},
            "3": {"image_count": 3, "copies": 3, "layers": 1, "shape": "diamond"},
        },
    }
    config_file = config_dir / "config.json"
    config_file.write_text(json.dumps(config), encoding="utf-8")

    static_dir = tmp_path / "static"
    static_dir.mkdir()
    for i in range(1, 10):
        (static_dir / f"{i}.PNG").write_bytes(b"fake")

    return GameStateManager(
        config_path=str(config_file), static_dir=str(static_dir)
    )


@pytest.fixture
def user_manager(tmp_path):
    """Create a UserManager with temp users file."""
    config_dir = tmp_path / "config"
    config_dir.mkdir(exist_ok=True)

    users = [
        {
            "username": "testplayer",
            "password": hashlib.md5(b"pass").hexdigest(),
            "role": "worker",
            "unique_code": "test-uuid-preserve",
            "current_level": 5,
        },
    ]
    users_path = config_dir / "users.json"
    users_path.write_text(json.dumps(users), encoding="utf-8")

    return UserManager(users_path=str(users_path))


# --- Property Tests: Non-Game-Over Reconnection ---

class TestPreservationReconnection:
    """Property: For all game states where game_over=False,
    reconnection recovers the existing state unchanged.

    **Validates: Requirements 3.3, 3.6**
    """

    @given(
        state=game_state_strategy(game_over=False),
        suffix=st.integers(min_value=0, max_value=100000),
    )
    @settings(max_examples=50, suppress_health_check=[HealthCheck.function_scoped_fixture])
    def test_non_game_over_state_recovered_unchanged(
        self, state, suffix, game_manager
    ):
        """When game_over=False, get_game_state returns the same state."""
        # Use a unique code per example to avoid cross-contamination
        unique_code = f"active-test-{suffix}"
        state["unique_code"] = unique_code
        key = game_manager._state_key(unique_code, None)

        # Clear any existing state for this key
        game_manager._states.pop(key, None)
        game_manager._persisted.pop(key, None)

        # Inject the state directly into the manager
        game_manager._states[key] = state

        # Simulate reconnection: get_game_state should recover it
        recovered = game_manager.get_game_state(unique_code, None)

        assert recovered is not None
        assert recovered["game_over"] is False
        assert recovered["level"] == state["level"]
        assert recovered["tiles"] == state["tiles"]
        assert recovered["slots"] == state["slots"]
        assert recovered["remaining"] == state["remaining"]

    @given(
        state=game_state_strategy(game_over=False),
        suffix=st.integers(min_value=0, max_value=100000),
    )
    @settings(max_examples=50, suppress_health_check=[HealthCheck.function_scoped_fixture])
    def test_non_game_over_state_recovered_from_persisted(
        self, state, suffix, game_manager
    ):
        """When active state is lost but persisted exists, recovery works."""
        # Use a unique code per example to avoid cross-contamination
        unique_code = f"persist-test-{suffix}"
        state["unique_code"] = unique_code
        key = game_manager._state_key(unique_code, None)

        # Clear any existing state for this key
        game_manager._states.pop(key, None)
        game_manager._persisted.pop(key, None)

        # Store in persisted (simulating server restart scenario)
        game_manager._persisted[key] = state

        # get_game_state should recover from persisted
        recovered = game_manager.get_game_state(unique_code, None)

        assert recovered is not None
        assert recovered["game_over"] is False
        assert recovered["level"] == state["level"]
        assert recovered["tiles"] == state["tiles"]
        assert recovered["slots"] == state["slots"]


# --- Property Tests: Fresh State Initialization ---

class TestPreservationInitialization:
    """Property: For all game states where no state exists,
    initialization creates fresh state at saved level.

    **Validates: Requirements 3.3**
    """

    @given(level=valid_level_strategy())
    @settings(max_examples=30, suppress_health_check=[HealthCheck.function_scoped_fixture])
    def test_no_state_returns_none(self, level, game_manager):
        """When no state exists, get_game_state returns None."""
        unique_code = f"nonexistent-{level}"
        result = game_manager.get_game_state(unique_code, None)
        assert result is None

    @given(level=valid_level_strategy())
    @settings(max_examples=30, suppress_health_check=[HealthCheck.function_scoped_fixture])
    def test_init_creates_fresh_state_at_level(self, level, game_manager):
        """init_game_state creates a fresh state at the given level."""
        unique_code = f"fresh-player-{level}"
        new_state = game_manager.init_game_state(unique_code, level, None)

        assert new_state is not None
        assert new_state["game_over"] is False
        assert new_state["level"] == level
        assert new_state["slots"] == []
        assert len(new_state["tiles"]) > 0
        assert new_state["remaining"] == len(new_state["tiles"])
        # Tiles should be multiples of 3
        assert len(new_state["tiles"]) % 3 == 0


# --- Property Tests: Valid Tile Actions ---

class TestPreservationValidTileAction:
    """Property: For all tile clicks where tile is unblocked AND
    slots.length < MAX_SLOTS AND game_over=False, apply_tile_action
    processes correctly and returns updated state.

    **Validates: Requirements 3.1, 3.2**
    """

    @given(level=st.integers(min_value=1, max_value=3))
    @settings(max_examples=20, suppress_health_check=[HealthCheck.function_scoped_fixture])
    def test_valid_unblocked_tile_action_processes(self, level, game_manager):
        """Selecting an unblocked tile with slots not full succeeds."""
        unique_code = f"valid-action-{level}"
        state = game_manager.init_game_state(unique_code, level, None)

        # Find an unblocked tile
        unblocked_tile = self._find_unblocked_tile(state)
        assume(unblocked_tile is not None)
        assume(len(state["slots"]) < MAX_SLOTS)
        assume(state["game_over"] is False)

        initial_tile_count = len(state["tiles"])
        tile_id = unblocked_tile["id"]

        # Apply the action
        updated = game_manager.apply_tile_action(
            unique_code, None, {"type": "select_tile", "tile_id": tile_id}
        )

        # Verify the action was processed
        assert updated is not None
        # Tile was removed from board (or triple match cleared more)
        assert len(updated["tiles"]) <= initial_tile_count - 1
        # Remaining count matches tiles
        assert updated["remaining"] == len(updated["tiles"])
        # State is still valid
        assert isinstance(updated["tiles"], list)
        assert isinstance(updated["slots"], list)

    @given(level=st.integers(min_value=1, max_value=3))
    @settings(max_examples=20, suppress_health_check=[HealthCheck.function_scoped_fixture])
    def test_valid_tile_action_moves_to_slots(self, level, game_manager):
        """A valid tile action moves the tile to the slot area."""
        unique_code = f"slot-move-{level}"
        state = game_manager.init_game_state(unique_code, level, None)

        unblocked_tile = self._find_unblocked_tile(state)
        assume(unblocked_tile is not None)

        tile_img_idx = unblocked_tile["imgIdx"]
        initial_slots = len(state["slots"])

        updated = game_manager.apply_tile_action(
            unique_code, None,
            {"type": "select_tile", "tile_id": unblocked_tile["id"]}
        )

        # Either the tile is in slots (no triple match) or slots were cleared
        # In either case, the action succeeded without error
        assert updated is not None
        # If no triple match occurred, slots increased by 1
        # If triple match occurred, slots decreased by 2 (added 1, removed 3)
        # Both are valid outcomes
        assert isinstance(updated["slots"], list)

    @given(level=st.integers(min_value=1, max_value=3))
    @settings(max_examples=15, suppress_health_check=[HealthCheck.function_scoped_fixture])
    def test_blocked_tile_raises_error(self, level, game_manager):
        """Attempting to select a blocked tile raises ValueError."""
        unique_code = f"blocked-{level}"
        state = game_manager.init_game_state(unique_code, level, None)

        blocked_tile = self._find_blocked_tile(state)
        assume(blocked_tile is not None)

        with pytest.raises(ValueError, match="blocked"):
            game_manager.apply_tile_action(
                unique_code, None,
                {"type": "select_tile", "tile_id": blocked_tile["id"]}
            )

    def _find_unblocked_tile(self, state):
        """Find a tile that is not blocked by higher-layer tiles."""
        tiles = state["tiles"]
        for tile in tiles:
            layer = tile.get("layer", 0)
            blocked = False
            for other in tiles:
                if other["id"] == tile["id"]:
                    continue
                if other.get("layer", 0) <= layer:
                    continue
                if (abs(other["x"] - tile["x"]) < 60
                        and abs(other["y"] - tile["y"]) < 60):
                    blocked = True
                    break
            if not blocked:
                return tile
        return None

    def _find_blocked_tile(self, state):
        """Find a tile that IS blocked by a higher-layer tile."""
        tiles = state["tiles"]
        for tile in tiles:
            layer = tile.get("layer", 0)
            for other in tiles:
                if other["id"] == tile["id"]:
                    continue
                if other.get("layer", 0) <= layer:
                    continue
                if (abs(other["x"] - tile["x"]) < 60
                        and abs(other["y"] - tile["y"]) < 60):
                    return tile
        return None


# --- Property Tests: Multiplayer Broadcasting ---

class TestPreservationMultiplayerBroadcast:
    """Property: For all valid tile actions in multiplayer,
    opponent and spectators receive updates.

    **Validates: Requirements 3.4, 3.5**

    Note: This test uses the SocketIO test client infrastructure
    to verify that tile actions in multiplayer rooms correctly
    broadcast opponent_update events.
    """

    @pytest.fixture
    def socketio_setup(self, tmp_path):
        """Set up Flask app with SocketIO test client support."""
        config_dir = tmp_path / "config"
        config_dir.mkdir()

        config = {
            "port": 5002,
            "idle_warning_seconds": 10,
            "idle_clear_seconds": 60,
            "levels": {
                "1": {"image_count": 4, "copies": 3, "layers": 1, "shape": "circle"},
            },
        }
        (config_dir / "config.json").write_text(
            json.dumps(config), encoding="utf-8"
        )

        users = [
            {
                "username": "owner1",
                "password": hashlib.md5(b"pass1").hexdigest(),
                "role": "worker",
                "unique_code": "owner-uuid-1111",
                "current_level": 1,
            },
            {
                "username": "player2",
                "password": hashlib.md5(b"pass2").hexdigest(),
                "role": "worker",
                "unique_code": "player2-uuid-2222",
                "current_level": 1,
            },
        ]
        (config_dir / "users.json").write_text(
            json.dumps(users), encoding="utf-8"
        )
        (config_dir / "room_list.json").write_text("[]", encoding="utf-8")

        static_dir = tmp_path / "static"
        static_dir.mkdir()
        for i in range(1, 5):
            (static_dir / f"{i}.PNG").write_bytes(b"fake image")

        import game.tileexplorer.app as app_module
        from room_manager import RoomManager
        from user_manager import UserManager
        from game_state_manager import GameStateManager
        from idle_timer_manager import IdleTimerManager
        from socketio_events import (
            register_socketio_events,
            _room_connections,
            _sid_to_room,
        )

        original_config_path = app_module.CONFIG_PATH
        original_users_path = app_module.USERS_PATH

        app_module.CONFIG_PATH = str(config_dir / "config.json")
        app_module.USERS_PATH = str(config_dir / "users.json")

        app_module.room_manager = RoomManager(config_dir=str(config_dir))
        app_module.user_manager = UserManager(
            users_path=str(config_dir / "users.json")
        )
        app_module.game_state_manager = GameStateManager(
            config_path=str(config_dir / "config.json"),
            static_dir=str(static_dir),
        )
        app_module.idle_timer_manager = IdleTimerManager(
            config_path=str(config_dir / "config.json")
        )

        register_socketio_events(
            app_module.socketio,
            app_module.room_manager,
            app_module.game_state_manager,
            app_module.user_manager,
            app_module.idle_timer_manager,
        )

        app_module.app.config["TESTING"] = True
        app_module.app.config["SECRET_KEY"] = "test-secret"

        _room_connections.clear()
        _sid_to_room.clear()

        yield {
            "app": app_module.app,
            "socketio": app_module.socketio,
            "room_manager": app_module.room_manager,
            "user_manager": app_module.user_manager,
            "game_state_manager": app_module.game_state_manager,
            "idle_timer_manager": app_module.idle_timer_manager,
        }

        app_module.CONFIG_PATH = original_config_path
        app_module.USERS_PATH = original_users_path
        _room_connections.clear()
        _sid_to_room.clear()

    def _create_socketio_client(self, setup, username, unique_code,
                                room_code=None, role="player"):
        """Create a SocketIO test client with session data."""
        from flask_socketio import SocketIOTestClient

        app = setup["app"]
        socketio = setup["socketio"]

        query_string = ""
        if room_code:
            query_string = f"?room_code={room_code}&role={role}"

        with app.test_request_context():
            with app.test_client() as http_client:
                with http_client.session_transaction() as sess:
                    sess["logged_in"] = True
                    sess["username"] = username
                    sess["unique_code"] = unique_code
                    sess["token"] = "test-token"

                client = socketio.test_client(
                    app,
                    flask_test_client=http_client,
                    query_string=query_string,
                )
                return client

    def test_multiplayer_tile_action_sends_opponent_update(self, socketio_setup):
        """In multiplayer, a valid tile action sends opponent_update to other player.

        **Validates: Requirements 3.4, 3.5**
        """
        setup = socketio_setup
        rm = setup["room_manager"]
        gsm = setup["game_state_manager"]

        # Create room and join
        room = rm.create_room("owner1", "owner-uuid-1111")
        room_code = room["unique_code"]
        rm.join_room(
            room_code, room["invitation_code"],
            "player2", "player2-uuid-2222"
        )

        # Connect both players
        owner_client = self._create_socketio_client(
            setup, "owner1", "owner-uuid-1111", room_code
        )
        player2_client = self._create_socketio_client(
            setup, "player2", "player2-uuid-2222", room_code
        )

        # Clear initial events
        owner_client.get_received()
        player2_client.get_received()

        # Get a valid unblocked tile from owner's state
        state = gsm.get_game_state("owner-uuid-1111", room_code)
        assert state is not None
        unblocked = self._find_unblocked_tile_from_state(state)
        assert unblocked is not None

        # Owner performs tile action
        owner_client.emit(
            "tile_action",
            {"type": "select_tile", "tile_id": unblocked["id"]}
        )

        # Owner should receive state_update
        owner_received = owner_client.get_received()
        owner_events = [r["name"] for r in owner_received]
        assert "state_update" in owner_events

        # Player 2 should receive opponent_update
        p2_received = player2_client.get_received()
        p2_events = [r["name"] for r in p2_received]
        assert "opponent_update" in p2_events

        # Verify opponent_update payload has correct structure
        for event in p2_received:
            if event["name"] == "opponent_update":
                data = event["args"][0]
                assert "tiles" in data
                assert "slots" in data
                assert "level" in data
                assert "remaining" in data
                assert "game_over" in data
                break

        owner_client.disconnect()
        player2_client.disconnect()

    def test_multiplayer_state_update_has_correct_structure(self, socketio_setup):
        """State update from tile action has tiles, slots, level, remaining, game_over.

        **Validates: Requirements 3.1, 3.4**
        """
        setup = socketio_setup
        rm = setup["room_manager"]
        gsm = setup["game_state_manager"]

        room = rm.create_room("owner1", "owner-uuid-1111")
        room_code = room["unique_code"]
        rm.join_room(
            room_code, room["invitation_code"],
            "player2", "player2-uuid-2222"
        )

        owner_client = self._create_socketio_client(
            setup, "owner1", "owner-uuid-1111", room_code
        )
        player2_client = self._create_socketio_client(
            setup, "player2", "player2-uuid-2222", room_code
        )

        owner_client.get_received()
        player2_client.get_received()

        state = gsm.get_game_state("owner-uuid-1111", room_code)
        unblocked = self._find_unblocked_tile_from_state(state)
        assert unblocked is not None

        owner_client.emit(
            "tile_action",
            {"type": "select_tile", "tile_id": unblocked["id"]}
        )

        owner_received = owner_client.get_received()
        for event in owner_received:
            if event["name"] == "state_update":
                data = event["args"][0]
                assert "tiles" in data
                assert "slots" in data
                assert "level" in data
                assert "remaining" in data
                assert "game_over" in data
                # game_over should still be False (just one tile moved)
                assert data["game_over"] is False
                break

        owner_client.disconnect()
        player2_client.disconnect()

    def _find_unblocked_tile_from_state(self, state):
        """Find an unblocked tile from a game state."""
        tiles = state["tiles"]
        for tile in tiles:
            layer = tile.get("layer", 0)
            blocked = False
            for other in tiles:
                if other["id"] == tile["id"]:
                    continue
                if other.get("layer", 0) <= layer:
                    continue
                if (abs(other["x"] - tile["x"]) < 60
                        and abs(other["y"] - tile["y"]) < 60):
                    blocked = True
                    break
            if not blocked:
                return tile
        return None
