"""Bug condition exploration tests for Tile Explorer gameplay fixes.

These tests encode the EXPECTED (correct) behavior for three bugs:
1. Retry button should reinitialize game state when game_over=True
2. Client should NOT emit tile_action when slots are full
3. Templates should display username and logout button

On UNFIXED code, these tests are EXPECTED TO FAIL — failure confirms
the bugs exist. After the fix is applied, these tests should PASS.

**Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6**
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


@pytest.fixture
def bug_test_setup(tmp_path):
    """Set up Flask app with SocketIO test client for bug exploration tests."""
    config_dir = tmp_path / "config"
    config_dir.mkdir()

    # Write config.json with levels
    config = {
        "port": 5002,
        "idle_warning_seconds": 10,
        "idle_clear_seconds": 60,
        "levels": {
            "1": {"image_count": 4, "copies": 3, "layers": 1, "shape": "circle"},
            "3": {"image_count": 5, "copies": 3, "layers": 2, "shape": "heart"},
        },
    }
    (config_dir / "config.json").write_text(json.dumps(config), encoding="utf-8")

    # Write users.json
    users = [
        {
            "username": "bugtest_user",
            "password": hashlib.md5(b"testpass").hexdigest(),
            "role": "worker",
            "unique_code": "bugtest-uuid-0001",
            "current_level": 3,
        },
    ]
    (config_dir / "users.json").write_text(json.dumps(users), encoding="utf-8")

    # Write empty room_list.json
    (config_dir / "room_list.json").write_text("[]", encoding="utf-8")

    # Create static dir with dummy images
    static_dir = tmp_path / "static"
    static_dir.mkdir()
    for i in range(1, 6):
        (static_dir / f"{i}.PNG").write_bytes(b"fake image")

    # Patch paths before importing app
    import game.tileexplorer.app as app_module
    from room_manager import RoomManager
    from user_manager import UserManager
    from game_state_manager import GameStateManager
    from idle_timer_manager import IdleTimerManager
    from socketio_events import (
        register_socketio_events, _room_connections, _sid_to_room
    )

    original_config_path = app_module.CONFIG_PATH
    original_users_path = app_module.USERS_PATH

    app_module.CONFIG_PATH = str(config_dir / "config.json")
    app_module.USERS_PATH = str(config_dir / "users.json")

    # Re-instantiate managers with temp paths
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

    # Re-register socketio events with new manager instances
    register_socketio_events(
        app_module.socketio,
        app_module.room_manager,
        app_module.game_state_manager,
        app_module.user_manager,
        app_module.idle_timer_manager,
    )

    app_module.app.config["TESTING"] = True
    app_module.app.config["SECRET_KEY"] = "test-secret"

    # Populate _active_sessions so require_login doesn't reject test sessions
    app_module._active_sessions["bugtest_user"] = "test-token"

    # Clear global state
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

    # Restore original paths
    app_module.CONFIG_PATH = original_config_path
    app_module.USERS_PATH = original_users_path

    # Clear global state after test
    _room_connections.clear()
    _sid_to_room.clear()


def _create_socketio_client(setup, username, unique_code, room_code=None):
    """Create a SocketIO test client with session data."""
    from flask_socketio import SocketIOTestClient

    app = setup["app"]
    socketio = setup["socketio"]

    query_string = ""
    if room_code:
        query_string = f"?room_code={room_code}&role=player"

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


class TestBug1RetryReconnectReinitialization:
    """Bug 1: Retry button should reinitialize game when game_over=True.

    On UNFIXED code, _handle_single_player_connect re-emits the existing
    game-over state without clearing it. The expected behavior is that
    when game_over=True, the server should clear the state and emit a
    fresh game with game_over=False.

    **Validates: Requirements 1.1, 2.1**
    """

    @given(
        num_slots=st.integers(min_value=7, max_value=7),
    )
    @settings(
        max_examples=5,
        deadline=None,
        suppress_health_check=[HealthCheck.function_scoped_fixture],
    )
    def test_reconnect_with_game_over_state_reinitializes(
        self, bug_test_setup, num_slots
    ):
        """When existing state has game_over=True and slots are full,
        reconnecting should emit a fresh state with game_over=False.

        On unfixed code, this FAILS because the server re-emits the
        game-over state unchanged.
        """
        setup = bug_test_setup
        gsm = setup["game_state_manager"]
        um = setup["user_manager"]

        unique_code = "bugtest-uuid-0001"
        username = "bugtest_user"

        # Initialize a game state and manually set it to game-over
        state = gsm.init_game_state(unique_code, 3, None)

        # Simulate game-over condition: fill slots to MAX_SLOTS
        state["game_over"] = True
        state["slots"] = [
            {"id": i, "imgIdx": i % 4, "img": f"/static/{(i % 4) + 1}.PNG"}
            for i in range(num_slots)
        ]

        # Now simulate a reconnect (page reload after clicking Retry)
        client = _create_socketio_client(
            setup, username, unique_code
        )

        # Get the state_update emitted on connect
        received = client.get_received()
        state_updates = [
            r for r in received if r["name"] == "state_update"
        ]

        assert len(state_updates) > 0, "Should receive state_update on connect"

        emitted_state = state_updates[0]["args"][0]

        # EXPECTED BEHAVIOR: game_over should be False (fresh game)
        assert emitted_state["game_over"] is False, (
            f"Expected game_over=False after retry reconnect, "
            f"but got game_over={emitted_state['game_over']}. "
            f"Bug 1: Server re-emits game-over state without reinitializing."
        )

        # EXPECTED BEHAVIOR: slots should be empty (fresh game)
        assert len(emitted_state["slots"]) == 0, (
            f"Expected empty slots after retry reconnect, "
            f"but got {len(emitted_state['slots'])} slots. "
            f"Bug 1: Server re-emits stale slots."
        )

        # EXPECTED BEHAVIOR: tiles should be present (fresh game)
        assert len(emitted_state["tiles"]) > 0, (
            "Expected tiles in fresh game state after retry reconnect."
        )

        client.disconnect()


class TestBug2ClientSlotsFullGuard:
    """Bug 2: Client should NOT emit tile_action when slots are full.

    On UNFIXED code, clickTile(idx) only checks gameOver but not
    slots.length >= MAX_SLOTS. This test verifies the server-side
    behavior when a tile_action is received with slots already full
    (which shouldn't happen if the client guards properly).

    We test this by directly emitting tile_action when the game state
    has full slots — on unfixed code, the server processes it (or errors)
    rather than the client preventing it.

    **Validates: Requirements 1.2, 2.2**
    """

    @given(
        slot_count=st.integers(min_value=7, max_value=7),
    )
    @settings(max_examples=5, deadline=None,
              suppress_health_check=[HealthCheck.function_scoped_fixture])
    def test_tile_action_rejected_when_slots_full(
        self, bug_test_setup, slot_count
    ):
        """When slots are full (>=MAX_SLOTS), clicking a tile should not
        result in a successful tile_action processing.

        On unfixed code, this FAILS because:
        - The client has no slots-full guard in clickTile()
        - The server processes the action and sets game_over=True

        We verify by checking that after the action, the game state
        reflects that the action was processed (slots grew or game_over
        was set) — which should NOT happen if the client properly guards.

        Since we can't test client-side JS directly in pytest, we test
        the server-side: if a tile_action arrives when slots are already
        at MAX_SLOTS, the game_over flag gets set to True (the server
        processes it). The EXPECTED behavior after fix is that the client
        never sends this action, so we verify the unfixed code allows it.
        """
        setup = bug_test_setup
        gsm = setup["game_state_manager"]

        unique_code = "bugtest-uuid-0001"
        username = "bugtest_user"

        # Initialize a game state
        state = gsm.init_game_state(unique_code, 1, None)

        # Manually fill slots to MAX_SLOTS - 1 (so one more will trigger full)
        # We need game_over=False so the action can be attempted
        state["game_over"] = False
        state["slots"] = [
            {"id": 1000 + i, "imgIdx": i % 4, "img": f"/static/{(i % 4) + 1}.PNG"}
            for i in range(slot_count)
        ]

        # Connect the client
        client = _create_socketio_client(
            setup, username, unique_code
        )
        received = client.get_received()  # Clear connect events

        # Find a valid tile to click (top layer, unblocked)
        current_state = gsm.get_game_state(unique_code, None)
        assert current_state is not None
        assert len(current_state["tiles"]) > 0

        # Find an unblocked tile
        tiles = current_state["tiles"]
        unblocked_tile = None
        for tile in tiles:
            tile_layer = tile.get("layer", 0)
            is_blocked = any(
                other["id"] != tile["id"]
                and other.get("layer", 0) > tile_layer
                and abs(other["x"] - tile["x"]) < 60
                and abs(other["y"] - tile["y"]) < 60
                for other in tiles
            )
            if not is_blocked:
                unblocked_tile = tile
                break

        assume(unblocked_tile is not None)

        # Emit tile_action — on unfixed code, the client would send this
        # even with slots full because there's no guard
        client.emit(
            "tile_action",
            {"type": "select_tile", "tile_id": unblocked_tile["id"]}
        )

        received = client.get_received()
        event_names = [r["name"] for r in received]

        # EXPECTED BEHAVIOR (after fix):
        # 1. Client-side: never sends tile_action when slots >= MAX_SLOTS
        #    (cannot be tested in pytest — this is a JS guard)
        # 2. Server-side (defense-in-depth): rejects with error if the
        #    action somehow arrives with slots already full
        #
        # On UNFIXED code: the server processes the action and returns
        # state_update with game_over=True (slots overflow). This is the bug.
        #
        # On FIXED code: the server rejects with an error (slots full guard)
        # which is correct defense-in-depth behavior.
        if "state_update" in event_names:
            state_update = next(
                r["args"][0] for r in received if r["name"] == "state_update"
            )
            # If the server processed it and set game_over=True, the bug exists
            assert state_update["game_over"] is False, (
                f"Bug 2: tile_action was processed when slots were already full "
                f"({slot_count} slots). The client should have prevented this. "
                f"Server set game_over=True after processing."
            )
        elif "error" in event_names:
            # Server rejected the action — this is correct defense-in-depth.
            # The server-side guard prevents processing when slots are full.
            # Combined with the client-side guard, this ensures the action
            # is never processed regardless of how it arrives.
            pass  # Expected: server rejects slots-full actions

        client.disconnect()


class TestBug3TemplateUsernameLogout:
    """Bug 3: Templates should display username and logout button.

    On UNFIXED code, single.html and battle.html lack the .user-bar
    element with username display and logout button.

    **Validates: Requirements 1.4, 1.5, 1.6, 2.4, 2.5, 2.6**
    """

    @given(
        username=st.text(
            alphabet=st.characters(whitelist_categories=("L", "N")),
            min_size=1,
            max_size=20,
        )
    )
    @settings(max_examples=10, deadline=None,
              suppress_health_check=[HealthCheck.function_scoped_fixture])
    def test_single_html_contains_user_bar(self, bug_test_setup, username):
        """single.html should contain a .user-bar element with username
        and logout button.

        On unfixed code, this FAILS because the template lacks these elements.
        """
        setup = bug_test_setup
        app = setup["app"]

        with app.test_request_context():
            with app.test_client() as client:
                # Log in with session
                with client.session_transaction() as sess:
                    sess["logged_in"] = True
                    sess["username"] = username
                    sess["unique_code"] = "bugtest-uuid-0001"
                    sess["token"] = "test-token"

                # Request the single page
                response = client.get("/single")
                assert response.status_code == 200

                html = response.data.decode("utf-8")

                # EXPECTED BEHAVIOR: page should contain user-bar class
                assert "user-bar" in html, (
                    f"Bug 3: single.html does not contain a .user-bar element. "
                    f"Expected username '{username}' and logout button to be displayed."
                )

                # EXPECTED BEHAVIOR: page should contain the username
                assert username in html, (
                    f"Bug 3: single.html does not display the username '{username}'. "
                    f"Expected username to appear in the page."
                )

                # EXPECTED BEHAVIOR: page should contain logout functionality
                assert "logout" in html.lower(), (
                    f"Bug 3: single.html does not contain logout button/link. "
                    f"Expected a logout mechanism to be present."
                )

    @given(
        username=st.text(
            alphabet=st.characters(whitelist_categories=("L", "N")),
            min_size=1,
            max_size=20,
        )
    )
    @settings(max_examples=10, deadline=None,
              suppress_health_check=[HealthCheck.function_scoped_fixture])
    def test_battle_html_contains_user_bar(self, bug_test_setup, username):
        """battle.html should contain a .user-bar element with username
        and logout button.

        On unfixed code, this FAILS because the template lacks these elements.
        """
        setup = bug_test_setup
        app = setup["app"]

        with app.test_request_context():
            with app.test_client() as client:
                # Log in with session
                with client.session_transaction() as sess:
                    sess["logged_in"] = True
                    sess["username"] = username
                    sess["unique_code"] = "bugtest-uuid-0001"
                    sess["token"] = "test-token"

                # Request the battle page (need a room_code in URL)
                response = client.get("/battle/TEST-ROOM-CODE")
                assert response.status_code == 200

                html = response.data.decode("utf-8")

                # EXPECTED BEHAVIOR: page should contain user-bar class
                assert "user-bar" in html, (
                    f"Bug 3: battle.html does not contain a .user-bar element. "
                    f"Expected username '{username}' and logout button to be displayed."
                )

                # EXPECTED BEHAVIOR: page should contain the username
                assert username in html, (
                    f"Bug 3: battle.html does not display the username '{username}'. "
                    f"Expected username to appear in the page."
                )

                # EXPECTED BEHAVIOR: page should contain logout functionality
                assert "logout" in html.lower(), (
                    f"Bug 3: battle.html does not contain logout button/link. "
                    f"Expected a logout mechanism to be present."
                )
