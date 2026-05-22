"""WebSocket event handlers for Tile Explorer multiplayer system.

Handles SocketIO connect/disconnect events, room joining, game start,
idle timeout notifications, room auto-close, and spectator kick.
"""

import time
from datetime import datetime, timezone

from flask import session, request
from flask_socketio import join_room, leave_room, emit


# Server-side tracking of connected players per room
# Structure: {room_code: {"owner_sid": str|None, "player2_sid": str|None,
#             "owner_username": str|None, "player2_username": str|None,
#             "owner_unique_code": str|None, "player2_unique_code": str|None,
#             "spectators": {sid: username}}}
_room_connections: dict[str, dict] = {}

# Reverse mapping: sid -> (room_code, role)
_sid_to_room: dict[str, tuple[str, str]] = {}

# Reverse mapping: unique_code -> sid (for idle notifications)
_unique_code_to_sid: dict[str, str] = {}


def register_socketio_events(socketio, room_manager, game_state_manager,
                             user_manager, idle_timer_manager):
    """Register all SocketIO event handlers.

    Args:
        socketio: The Flask-SocketIO instance.
        room_manager: RoomManager instance for room data access.
        game_state_manager: GameStateManager instance for game state init.
        user_manager: UserManager instance for user level data.
        idle_timer_manager: IdleTimerManager instance for idle tracking.
    """

    def _update_room_last_activity(room_code):
        """Update last_activity timestamp for a room."""
        rooms = room_manager.get_active_rooms()
        for room in rooms:
            if room.get("unique_code") == room_code:
                room["last_activity"] = (
                    datetime.now(timezone.utc).isoformat()
                )
                room_manager._save_rooms(rooms)
                break

    def _handle_idle_actions(actions):
        """Handle idle timer actions by emitting SocketIO events.

        Called by the background monitoring loop when idle thresholds
        are breached.

        Args:
            actions: List of (unique_code, action) tuples where action
                is 'warn' or 'clear'.
        """
        for unique_code, action in actions:
            sid = _unique_code_to_sid.get(unique_code)
            if not sid:
                continue

            if action == "warn":
                socketio.emit(
                    "idle_warning",
                    {"message": "You have been idle. Continue playing?"},
                    to=sid,
                )
            elif action == "clear":
                # Clear game state
                # Find the room_code for this player
                room_info = _sid_to_room.get(sid)
                room_code = room_info[0] if room_info else None
                game_state_manager.clear_state(unique_code, room_code)

                # Emit idle_clear before disconnecting
                socketio.emit("idle_clear", {}, to=sid)

                # Disconnect the player
                socketio.server.disconnect(sid, namespace="/")

    def _check_room_auto_close():
        """Check all rooms for inactivity and auto-close expired ones.

        Emits room_closed to all connected members of expired rooms.
        """
        auto_close_seconds = idle_timer_manager.room_auto_close_seconds
        now = time.time()

        rooms = room_manager.get_active_rooms()
        rooms_to_close = []

        for room in rooms:
            last_activity_str = room.get("last_activity")
            if not last_activity_str:
                continue

            try:
                last_activity_dt = datetime.fromisoformat(
                    last_activity_str
                )
                last_activity_ts = last_activity_dt.timestamp()
            except (ValueError, TypeError):
                continue

            elapsed = now - last_activity_ts
            if elapsed >= auto_close_seconds:
                rooms_to_close.append(room.get("unique_code"))

        for room_code in rooms_to_close:
            # Emit room_closed to all members in the SocketIO room
            socketio.emit(
                "room_closed",
                {"reason": "Room closed due to inactivity"},
                to=room_code,
            )

            # Clean up connection tracking
            conn = _room_connections.pop(room_code, None)
            if conn:
                # Remove SID mappings
                for sid_key in [conn.get("owner_sid"),
                                conn.get("player2_sid")]:
                    if sid_key:
                        _sid_to_room.pop(sid_key, None)
                        # Find and remove unique_code mapping
                        for uc, s in list(_unique_code_to_sid.items()):
                            if s == sid_key:
                                _unique_code_to_sid.pop(uc, None)
                                break
                for spec_sid in list(conn.get("spectators", {}).keys()):
                    _sid_to_room.pop(spec_sid, None)

            # Remove room from storage
            room_manager.remove_room(room_code)

    # Set the idle callback on the idle timer manager
    idle_timer_manager.set_idle_callback(_handle_idle_actions)

    @socketio.on("connect")
    def handle_connect(auth=None):  # noqa: ARG001
        """Handle WebSocket connection.

        Validates session, joins SocketIO room by room_code.
        Emits appropriate events based on room state.
        On reconnect, recovers existing game state (Req 8.2, 8.3).
        If no state exists, initializes at player's saved level (Req 8.5).
        If state is corrupted, discards and reinitializes (Req 8.6).
        """
        username = session.get("username")
        unique_code = session.get("unique_code")

        if not username or not unique_code:
            return False  # Reject connection

        # Get room_code and role from query params or auth data
        room_code = request.args.get("room_code")
        role = request.args.get("role", "player")

        if not room_code:
            # Check if this is a lobby-only connection
            if role == "lobby":
                # Lobby connections don't need game state
                return True

            # Single-player mode: recover or initialize game state
            sid = request.sid
            # Track unique_code -> sid for idle notifications
            _unique_code_to_sid[unique_code] = sid
            _handle_single_player_connect(
                unique_code, username, game_state_manager, user_manager
            )
            # Start idle timer tracking for single-player
            idle_timer_manager.reset_timer(unique_code)
            return True

        sid = request.sid

        # Validate room exists
        rooms = room_manager.get_active_rooms()
        target_room = None
        for room in rooms:
            if room.get("unique_code") == room_code:
                target_room = room
                break

        if target_room is None:
            emit("error", {"message": "Room not found"})
            return False

        # Join the SocketIO room
        join_room(room_code)

        # Initialize room connection tracking if needed
        if room_code not in _room_connections:
            _room_connections[room_code] = {
                "owner_sid": None,
                "player2_sid": None,
                "owner_username": None,
                "player2_username": None,
                "owner_unique_code": None,
                "player2_unique_code": None,
                "spectators": {},
            }

        conn = _room_connections[room_code]

        if role == "spectator":
            # Add as spectator
            conn["spectators"][sid] = username
            _sid_to_room[sid] = (room_code, "spectator")
            # Notify all room members that a spectator joined
            spectator_list = list(conn["spectators"].values())
            emit("spectator_joined", {
                "username": username,
                "spectators": spectator_list,
            }, to=room_code)
            # Update last_activity on join
            _update_room_last_activity(room_code)
            return True

        # Determine if this player is the owner or player 2
        is_owner = (target_room.get("room_owner") == username)

        # Track unique_code -> sid mapping for idle notifications
        _unique_code_to_sid[unique_code] = sid

        if is_owner:
            conn["owner_sid"] = sid
            conn["owner_username"] = username
            conn["owner_unique_code"] = unique_code
            _sid_to_room[sid] = (room_code, "owner")

            # Check if player 2 is already connected
            if conn["player2_sid"] is not None:
                # Both players connected — start game
                _start_game(room_code, conn, game_state_manager,
                            user_manager)
            else:
                # Try to recover existing game state (reconnect)
                _recover_multiplayer_state(
                    unique_code, room_code, game_state_manager
                )
                # Owner is alone — emit waiting
                emit("waiting_for_opponent", {})
        else:
            # Player 2
            conn["player2_sid"] = sid
            conn["player2_username"] = username
            conn["player2_unique_code"] = unique_code
            _sid_to_room[sid] = (room_code, "player2")

            # Notify owner that opponent joined
            if conn["owner_sid"] is not None:
                emit("player_joined", {"username": username},
                     to=conn["owner_sid"])
                # Both players connected — start game
                _start_game(room_code, conn, game_state_manager,
                            user_manager)
            else:
                # Try to recover existing game state (reconnect)
                _recover_multiplayer_state(
                    unique_code, room_code, game_state_manager
                )

        # Reset idle timer for this player
        idle_timer_manager.reset_timer(unique_code)

        # Update last_activity on join
        _update_room_last_activity(room_code)

        return True

    @socketio.on("disconnect")
    def handle_disconnect():
        """Handle WebSocket disconnection.

        Removes player/spectator from room, starts idle timer,
        notifies remaining players. Updates last_activity.
        """
        sid = request.sid

        if sid not in _sid_to_room:
            return

        room_code, role = _sid_to_room.pop(sid)

        if room_code not in _room_connections:
            return

        conn = _room_connections[room_code]

        if role == "spectator":
            # Remove spectator
            username = conn["spectators"].pop(sid, None)
            # Also remove from room_manager spectator list
            if username:
                _remove_spectator_from_room(room_manager, room_code,
                                            username)
            leave_room(room_code)
            # Update last_activity on leave
            _update_room_last_activity(room_code)
            return

        # Player disconnect
        unique_code = None
        if role == "owner":
            username = conn["owner_username"]
            unique_code = conn["owner_unique_code"]
            conn["owner_sid"] = None

            # Notify player 2 if connected
            if conn["player2_sid"] is not None:
                emit("player_left", {"username": username},
                     to=conn["player2_sid"])
        elif role == "player2":
            username = conn["player2_username"]
            unique_code = conn["player2_unique_code"]
            conn["player2_sid"] = None

            # Notify owner if connected
            if conn["owner_sid"] is not None:
                emit("player_left", {"username": username},
                     to=conn["owner_sid"])

        # Remove unique_code -> sid mapping
        if unique_code:
            _unique_code_to_sid.pop(unique_code, None)

        # Start idle timer for disconnected player
        if unique_code:
            idle_timer_manager.reset_timer(unique_code)

        leave_room(room_code)

        # Update last_activity on leave
        _update_room_last_activity(room_code)

        # Clean up room connection tracking if both players disconnected
        if (conn["owner_sid"] is None and conn["player2_sid"] is None
                and not conn["spectators"]):
            _room_connections.pop(room_code, None)

    @socketio.on("tile_action")
    def handle_tile_action(data):
        """Handle tile action from a player.

        Applies the action via GameStateManager, emits state_update
        to the acting player, opponent_update to the opponent, and
        broadcasts to spectators.

        After applying the action, checks if the game is won
        (tiles empty AND slots empty) and updates the player's
        current_level in UserManager (Req 9.7, 11.2).

        Persists state after each action (within 2 seconds, Req 8.1).
        """
        sid = request.sid
        username = session.get("username")
        unique_code = session.get("unique_code")

        if not username or not unique_code:
            emit("error", {"message": "Not authenticated"})
            return

        # Determine room_code from connection tracking
        room_code = None
        role = None
        if sid in _sid_to_room:
            room_code, role = _sid_to_room[sid]

        if role == "spectator":
            emit("error", {"message": "Spectators cannot perform actions"})
            return

        # Apply the tile action via GameStateManager
        # (persist_state is called internally by apply_tile_action)
        try:
            updated_state = game_state_manager.apply_tile_action(
                unique_code, room_code, data
            )
        except ValueError as e:
            emit("error", {"message": str(e)})
            return

        # Build state view for client
        state_view = _build_state_view(updated_state)

        # Emit state_update to the acting player
        emit("state_update", state_view)

        # If in a room, emit opponent_update and broadcast to spectators
        if room_code and room_code in _room_connections:
            conn = _room_connections[room_code]

            # Determine opponent's sid
            opponent_sid = None
            if role == "owner" and conn["player2_sid"] is not None:
                opponent_sid = conn["player2_sid"]
            elif role == "player2" and conn["owner_sid"] is not None:
                opponent_sid = conn["owner_sid"]

            if opponent_sid is not None:
                emit("opponent_update", state_view, to=opponent_sid)

            # Broadcast to spectators
            for spec_sid in conn["spectators"]:
                emit("opponent_update", state_view, to=spec_sid)

            # Update last_activity on tile action
            _update_room_last_activity(room_code)

        # Check if game is won: tiles empty AND slots empty
        if (updated_state.get("game_over") is True
                and len(updated_state.get("tiles", [])) == 0
                and len(updated_state.get("slots", [])) == 0):
            # Player won — update their level (Req 9.7, 11.2)
            current_level = updated_state.get("level", 1)
            player_saved_level = user_manager.get_current_level(username)
            # Only advance if this level >= saved level (Property 12)
            if current_level >= player_saved_level:
                new_level = min(60, current_level + 1)
                user_manager.update_level(username, new_level)

        # Reset idle timer on activity
        if unique_code:
            idle_timer_manager.reset_timer(unique_code)

    @socketio.on("restart_game")
    def handle_restart_game(data=None):  # noqa: ARG001
        """Handle restart game request (Retry button).

        Clears the existing game state and reinitializes a new game
        at the player's current saved level (Req 2.1).
        """
        username = session.get("username")
        unique_code = session.get("unique_code")

        if not username or not unique_code:
            emit("error", {"message": "Not authenticated"})
            return

        # Clear existing game state (single-player only, room_code=None)
        game_state_manager.clear_state(unique_code, None)

        # Reinitialize at player's saved level
        saved_level = user_manager.get_current_level(username)
        new_state = game_state_manager.init_game_state(
            unique_code, saved_level, None
        )
        emit("state_update", _build_state_view(new_state))

        # Reset idle timer
        idle_timer_manager.reset_timer(unique_code)

    @socketio.on("join_lobby")
    def handle_join_lobby(data=None):  # noqa: ARG001
        """Handle lobby join — add client to 'lobby' room for updates."""
        join_room("lobby")

    @socketio.on("heartbeat")
    def handle_heartbeat(data=None):
        """Handle heartbeat event — reset idle timer."""
        unique_code = session.get("unique_code")
        if unique_code:
            idle_timer_manager.reset_timer(unique_code)

    @socketio.on("continue_playing")
    def handle_continue_playing(data=None):
        """Handle continue_playing response — reset idle timer."""
        unique_code = session.get("unique_code")
        if unique_code:
            idle_timer_manager.reset_timer(unique_code)

    @socketio.on("magic_attack")
    def handle_magic_attack(data=None):  # noqa: ARG001
        """Handle magic attack from a player.

        The magic type is determined by the server (pending_magic in
        game state). Validates charges, decrements, and emits
        magic_effect to the target opponent.
        """
        sid = request.sid
        username = session.get("username")
        unique_code = session.get("unique_code")

        if not username or not unique_code:
            emit("error", {"message": "Not authenticated"})
            return

        # Must be in a room
        if sid not in _sid_to_room:
            emit("error", {"message": "Not in a room"})
            return

        room_code, role = _sid_to_room[sid]
        if role == "spectator":
            emit("error", {"message": "Spectators cannot attack"})
            return

        # Get the current state to validate charges exist
        current_state = game_state_manager.get_game_state(
            unique_code, room_code
        )
        if not current_state:
            emit("error", {"message": "No game state"})
            return

        if current_state.get("magic_charges", 0) <= 0:
            emit("error", {"message": "No magic charges available"})
            return

        # Validate and decrement magic charge via game state
        try:
            game_state_manager.apply_tile_action(
                unique_code, room_code, {"type": "use_magic"}
            )
        except ValueError as e:
            emit("error", {"message": str(e)})
            return

        # Read the magic type that was used
        updated_state = game_state_manager.get_game_state(
            unique_code, room_code
        )
        magic_type = updated_state.get("_last_used_magic") if updated_state else None
        if not magic_type:
            emit("error", {"message": "Magic use failed"})
            return

        # Determine target opponent
        conn = _room_connections.get(room_code)
        if not conn:
            return

        opponent_sid = None
        opponent_unique_code = None
        if role == "owner" and conn["player2_sid"]:
            opponent_sid = conn["player2_sid"]
            opponent_unique_code = conn["player2_unique_code"]
        elif role == "player2" and conn["owner_sid"]:
            opponent_sid = conn["owner_sid"]
            opponent_unique_code = conn["owner_unique_code"]

        if opponent_sid and opponent_unique_code:
            # Get opponent's game state to pick affected tiles
            opponent_state = game_state_manager.get_game_state(
                opponent_unique_code, room_code
            )
            affected_tile_ids = []
            if opponent_state:
                import random as _rnd
                import json as _json
                import os as _os

                # Load magic config for grid_count
                magic_cfg_path = _os.path.join(
                    _os.path.dirname(__file__), "config", "magic.json"
                )
                grid_count = 5
                try:
                    with open(magic_cfg_path, "r", encoding="utf-8") as _f:
                        _mcfg = _json.load(_f)
                    mt = _mcfg.get("magic_types", {}).get(magic_type, {})
                    grid_count = mt.get("grid_count", 5)
                except (OSError, _json.JSONDecodeError):
                    pass

                opp_tiles = opponent_state.get("tiles", [])
                if opp_tiles:
                    count = min(grid_count, len(opp_tiles))
                    chosen = _rnd.sample(opp_tiles, count)
                    affected_tile_ids = [t["id"] for t in chosen]

            emit("magic_effect", {
                "magic_type": magic_type,
                "from": username,
                "affected_tile_ids": affected_tile_ids,
            }, to=opponent_sid)

            # Also notify the attacker with the same tile IDs
            emit("magic_effect_sent", {
                "magic_type": magic_type,
                "affected_tile_ids": affected_tile_ids,
            })

        # Emit updated state to the attacker (charges decremented)
        if updated_state:
            emit("state_update", _build_state_view(updated_state))

        # Reset idle timer
        idle_timer_manager.reset_timer(unique_code)

    # Start background task for room auto-close monitoring
    def _background_monitor():
        """Background task that checks room auto-close every 5 seconds."""
        while True:
            socketio.sleep(5)
            try:
                _check_room_auto_close()
            except Exception:
                pass  # Don't crash the background task

    socketio.start_background_task(_background_monitor)


def kick_spectators(socketio, room_manager, room_code, reason=None):
    """Kick all spectators from a room.

    Emits spectator_kicked to all connected spectators and removes
    them from the room connection tracking and room_manager.

    Args:
        socketio: The Flask-SocketIO instance.
        room_manager: RoomManager instance.
        room_code: The room's unique code.
        reason: Optional reason string for the kick.
    """
    if reason is None:
        reason = "Spectator access has been disabled by the room owner"

    conn = _room_connections.get(room_code)
    if not conn:
        return

    spectators = dict(conn.get("spectators", {}))
    for sid, username in spectators.items():
        # Emit spectator_kicked to each spectator
        socketio.emit("spectator_kicked", {"reason": reason}, to=sid)
        # Remove from tracking
        _sid_to_room.pop(sid, None)
        # Remove from room_manager
        _remove_spectator_from_room(room_manager, room_code, username)

    # Clear spectators from connection tracking
    conn["spectators"] = {}


def handle_room_deleted(socketio, game_state_manager, room_code):
    """Handle room deletion: notify all members and clear game state.

    Emits room_deleted to all connected players and spectators,
    clears their game state for this room, and cleans up connection
    tracking.

    Args:
        socketio: The Flask-SocketIO instance.
        game_state_manager: GameStateManager instance.
        room_code: The room's unique code.
    """
    conn = _room_connections.get(room_code)
    if not conn:
        # Even without connection tracking, emit to the SocketIO room
        socketio.emit(
            "room_deleted",
            {"reason": "The room has been deleted by the owner."},
            to=room_code,
        )
        return

    # Notify and clean up player 2
    player2_sid = conn.get("player2_sid")
    player2_unique_code = conn.get("player2_unique_code")
    if player2_sid:
        socketio.emit(
            "room_deleted",
            {"reason": "The room has been deleted by the owner."},
            to=player2_sid,
        )
        _sid_to_room.pop(player2_sid, None)

    # Clear game state for player 2
    if player2_unique_code:
        game_state_manager.clear_state(player2_unique_code, room_code)
        _unique_code_to_sid.pop(player2_unique_code, None)

    # Notify and clean up owner
    owner_sid = conn.get("owner_sid")
    owner_unique_code = conn.get("owner_unique_code")
    if owner_sid:
        _sid_to_room.pop(owner_sid, None)

    # Clear game state for owner
    if owner_unique_code:
        game_state_manager.clear_state(owner_unique_code, room_code)
        _unique_code_to_sid.pop(owner_unique_code, None)

    # Notify and clean up spectators
    spectators = dict(conn.get("spectators", {}))
    for sid in spectators:
        socketio.emit(
            "room_deleted",
            {"reason": "The room has been deleted by the owner."},
            to=sid,
        )
        _sid_to_room.pop(sid, None)

    # Remove room connection tracking
    _room_connections.pop(room_code, None)


def _handle_single_player_connect(unique_code, username,
                                  game_state_manager, user_manager):
    """Handle single-player WebSocket connection with state recovery.

    On connect without a room_code (Req 8.3, 8.5, 8.6):
    - If existing state found and game is NOT over, emit state_update
      with recovered state
    - If existing state found and game IS over, clear and reinitialize
      at player's saved level (Req 2.1)
    - If no state exists, initialize at player's saved level
    - If state is corrupted, discard and reinitialize

    Args:
        unique_code: Player's unique code.
        username: Player's username.
        game_state_manager: GameStateManager instance.
        user_manager: UserManager instance.
    """
    # room_code is None for single-player
    state = game_state_manager.get_game_state(unique_code, None)

    if state is not None:
        # If game is over, clear and reinitialize (Req 2.1 — Retry reconnect)
        if state.get("game_over", False):
            game_state_manager.clear_state(unique_code, None)
            saved_level = user_manager.get_current_level(username)
            new_state = game_state_manager.init_game_state(
                unique_code, saved_level, None
            )
            emit("state_update", _build_state_view(new_state))
        else:
            # Recovered existing in-progress state — emit to player
            emit("state_update", _build_state_view(state))
    else:
        # No state exists — initialize at player's saved level
        saved_level = user_manager.get_current_level(username)
        new_state = game_state_manager.init_game_state(
            unique_code, saved_level, None
        )
        emit("state_update", _build_state_view(new_state))


def _recover_multiplayer_state(unique_code, room_code,
                               game_state_manager):
    """Attempt to recover multiplayer game state on reconnect.

    If state exists for this player in this room, emit state_update
    (Req 8.2). If state is corrupted or missing, do nothing —
    game_start will reinitialize when both players are connected.

    Args:
        unique_code: Player's unique code.
        room_code: The room's unique code.
        game_state_manager: GameStateManager instance.
    """
    state = game_state_manager.get_game_state(unique_code, room_code)

    if state is not None:
        # Recovered existing state — emit to reconnecting player
        emit("state_update", _build_state_view(state))


def _start_game(room_code, conn, game_state_manager, user_manager):
    """Initialize or recover game states for both players and emit game_start.

    If both players already have existing (non-game-over) state for this
    room, recover and emit those states instead of reinitializing.

    Args:
        room_code: The room's unique code.
        conn: The room connection tracking dict.
        game_state_manager: GameStateManager instance.
        user_manager: UserManager instance.
    """
    owner_username = conn["owner_username"]
    owner_unique_code = conn["owner_unique_code"]
    player2_username = conn["player2_username"]
    player2_unique_code = conn["player2_unique_code"]

    # Try to recover existing game states (reconnect/refresh scenario)
    owner_state = game_state_manager.get_game_state(
        owner_unique_code, room_code
    )
    player2_state = game_state_manager.get_game_state(
        player2_unique_code, room_code
    )

    # If both have valid in-progress states, recover them
    if (owner_state is not None
            and not owner_state.get("game_over", False)
            and player2_state is not None
            and not player2_state.get("game_over", False)):
        # Recover existing game — don't reinitialize
        pass
    else:
        # One or both states missing/finished — initialize fresh game
        owner_level = user_manager.get_current_level(owner_username)
        player2_level = user_manager.get_current_level(player2_username)
        game_level = min(owner_level, player2_level)

        owner_state = game_state_manager.init_game_state(
            owner_unique_code, game_level, room_code
        )
        player2_state = game_state_manager.init_game_state(
            player2_unique_code, game_level, room_code
        )

    # Build read-only views (exclude unique_code for privacy)
    owner_view = _build_state_view(owner_state)
    player2_view = _build_state_view(player2_state)

    # Emit game_start to owner
    emit("game_start", {
        "own_state": owner_view,
        "opponent_state": player2_view,
        "opponent_name": player2_username,
    }, to=conn["owner_sid"])

    # Emit game_start to player 2
    emit("game_start", {
        "own_state": player2_view,
        "opponent_state": owner_view,
        "opponent_name": owner_username,
    }, to=conn["player2_sid"])


def _build_state_view(state: dict) -> dict:
    """Build a client-safe view of a game state.

    Excludes internal fields like unique_code.
    """
    return {
        "tiles": state.get("tiles", []),
        "slots": state.get("slots", []),
        "level": state.get("level", 1),
        "remaining": state.get("remaining", 0),
        "game_over": state.get("game_over", False),
        "magic_charges": state.get("magic_charges", 0),
        "pending_magic": state.get("pending_magic"),
    }


def _remove_spectator_from_room(room_manager, room_code, username):
    """Remove a spectator from the room_manager's room record."""
    rooms = room_manager.get_active_rooms()
    for room in rooms:
        if room.get("unique_code") == room_code:
            spectators = room.get("spectators", [])
            if username in spectators:
                spectators.remove(username)
                room["spectators"] = spectators
                room_manager._save_rooms(rooms)
            break


def get_room_connections():
    """Get the room connections dict (for testing/debugging)."""
    return _room_connections


def get_sid_to_room():
    """Get the sid-to-room mapping (for testing/debugging)."""
    return _sid_to_room


def get_unique_code_to_sid():
    """Get the unique_code-to-sid mapping (for testing/debugging)."""
    return _unique_code_to_sid
