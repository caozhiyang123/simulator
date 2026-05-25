"""Tile Explorer game server."""
import atexit
import hashlib
import json
import os
import uuid

from flask import Flask, jsonify, render_template, request, session, redirect
from flask_socketio import SocketIO

from room_manager import RoomManager
from user_manager import UserManager
from game_state_manager import GameStateManager
from idle_timer_manager import IdleTimerManager
from statistics_manager import StatisticsManager
from socketio_events import register_socketio_events, kick_spectators, handle_room_deleted

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "tileexplorer-secret-2026")
socketio = SocketIO(app, cors_allowed_origins="*", manage_session=False)

CONFIG_PATH = os.path.join(os.path.dirname(__file__), "config", "config.json")
STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")
USERS_PATH = os.path.join(os.path.dirname(__file__), "config", "users.json")

# Instantiate managers
room_manager = RoomManager()
user_manager = UserManager()
game_state_manager = GameStateManager()
idle_timer_manager = IdleTimerManager()
statistics_manager = StatisticsManager()

# Register WebSocket event handlers
register_socketio_events(socketio, room_manager, game_state_manager,
                         user_manager, idle_timer_manager,
                         statistics_manager)

# Start idle timer background monitoring on startup
idle_timer_manager.start_monitoring()

# Stop monitoring on shutdown
atexit.register(idle_timer_manager.stop_monitoring)

# Load config
with open(CONFIG_PATH, "r", encoding="utf-8") as _f:
    _config = json.load(_f)
PORT = _config.get("port", 5002)

# Active sessions: {username: session_token}
_active_sessions: dict = {}


def _load_users():
    if not os.path.isfile(USERS_PATH):
        return []
    with open(USERS_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def _save_users(users):
    with open(USERS_PATH, "w", encoding="utf-8") as f:
        json.dump(users, f, ensure_ascii=False, indent=2)


def _md5(text):
    return hashlib.md5(text.encode()).hexdigest()


# Ensure default users.json exists
if not os.path.isfile(USERS_PATH):
    _save_users([
        {"username": "admin", "password": _md5("admin"), "role": "admin"},
        {"username": "1", "password": _md5("1"), "role": "worker"},
    ])


@app.before_request
def require_login():
    """Require login for all routes except auth and static."""
    allowed_prefixes = ('/auth/', '/static/', '/login')
    if any(request.path.startswith(p) for p in allowed_prefixes):
        return
    if not session.get('logged_in'):
        return redirect('/login')
    # Skip token validation in testing mode
    if app.config.get('TESTING'):
        return
    username = session.get('username')
    token = session.get('token')
    if username and token and _active_sessions.get(username) != token:
        session.clear()
        return redirect('/login')


@app.route("/login")
def login_page():
    if session.get('logged_in'):
        return redirect('/')
    return render_template("login.html")


@app.route("/auth/login", methods=["POST"])
def auth_login():
    data = request.get_json(force=True)
    username = data.get("username", "")
    password = data.get("password", "")
    users = _load_users()
    for u in users:
        if u["username"] == username and u["password"] == _md5(password):
            token = str(uuid.uuid4())
            _active_sessions[username] = token
            # Generate or retrieve unique_code for the user
            unique_code = user_manager.get_or_create_unique_code(username)
            session['logged_in'] = True
            session['username'] = username
            session['role'] = u.get("role", "worker")
            session['token'] = token
            session['unique_code'] = unique_code

            # Start session statistics tracking
            session_id = str(uuid.uuid4())
            session['session_id'] = session_id
            coins = user_manager.get_coins(username)
            level = user_manager.get_current_level(username)
            statistics_manager.start_session(
                session_id, username, unique_code, coins, level
            )

            return jsonify({"status": "ok", "username": username})
    return jsonify({"error": "Invalid username or password"}), 401


@app.route("/auth/logout", methods=["POST"])
def auth_logout():
    # End session statistics tracking
    session_id = session.get('session_id')
    username = session.get('username')
    unique_code = session.get('unique_code')
    if session_id and username and unique_code:
        coins = user_manager.get_coins(username)
        level = user_manager.get_current_level(username)
        statistics_manager.end_session(
            session_id, username, unique_code, coins, level
        )
    session.clear()
    return jsonify({"status": "ok"})


@app.route("/auth/register", methods=["POST"])
def auth_register():
    """Register a new player user (admin-only)."""
    data = request.get_json(force=True)

    # Validate all required fields are present and non-empty
    required_fields = [
        "admin_username", "admin_password",
        "new_username", "new_password"
    ]
    for field in required_fields:
        value = data.get(field)
        if not value or not str(value).strip():
            return jsonify({
                "error": f"Missing or empty field: {field}"
            }), 400

    admin_username = data["admin_username"].strip()
    admin_password = data["admin_password"]
    new_username = data["new_username"].strip()
    new_password = data["new_password"]

    # Validate new_username length (1-32 chars)
    if len(new_username) < 1 or len(new_username) > 32:
        return jsonify({
            "error": "Username must be 1-32 characters"
        }), 400

    # Validate new_password length (1-64 chars)
    if len(new_password) < 1 or len(new_password) > 64:
        return jsonify({
            "error": "Password must be 1-64 characters"
        }), 400

    # Load users and verify admin credentials
    users = _load_users()
    admin_user = None
    for u in users:
        if u["username"] == admin_username:
            if u["password"] == _md5(admin_password):
                admin_user = u
            break

    if not admin_user or admin_user.get("role") != "admin":
        return jsonify({
            "error": "Admin authentication failed"
        }), 403

    # Check if new_username already exists
    for u in users:
        if u["username"] == new_username:
            return jsonify({
                "error": "Username already exists"
            }), 409

    # Create new user entry
    new_user = {
        "username": new_username,
        "password": _md5(new_password),
        "role": "player",
        "unique_code": str(uuid.uuid4()),
        "current_level": 1
    }

    users.append(new_user)
    _save_users(users)

    return jsonify({"status": "ok", "username": new_username})


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/single")
def single():
    username = session.get("username", "")
    return render_template("single.html", username=username)


@app.route("/battle/<room_code>")
def battle(room_code):
    """Serve battle page for a specific room."""
    username = session.get("username", "")
    # Find the room to get invitation_code, owner status, and spectator status
    invitation_code = ""
    is_owner = False
    is_spectator = False
    rooms = room_manager.get_active_rooms()
    for room in rooms:
        if room.get("unique_code") == room_code:
            if room.get("room_owner") == username:
                invitation_code = room.get("invitation_code", "")
                is_owner = True
            elif username in room.get("spectators", []):
                is_spectator = True
            break
    return render_template("battle.html", room_code=room_code,
                           username=username,
                           invitation_code=invitation_code,
                           is_owner=is_owner,
                           is_spectator=is_spectator)


@app.route("/api/config", methods=["GET"])
def get_config():
    """Return level config and client settings."""
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        cfg = json.load(f)
    return jsonify({
        "reconnect_max_attempts": cfg.get(
            "reconnect_max_attempts", 3),
        "reconnect_interval_seconds": cfg.get(
            "reconnect_interval_seconds", 3),
        "undo_max_per_round": cfg.get("undo_max_per_round", 3),
        "tile_size": cfg.get("tile_size", 80),
        "levels": cfg.get("levels", {}),
    })


ADS_CONFIG_PATH = os.path.join(
    os.path.dirname(__file__), "config", "ads.json"
)


@app.route("/api/ads-config", methods=["GET"])
def get_ads_config():
    """Return ads configuration for the client."""
    try:
        with open(ADS_CONFIG_PATH, "r", encoding="utf-8") as f:
            ads_cfg = json.load(f)
    except (OSError, json.JSONDecodeError):
        ads_cfg = {}
    return jsonify({
        "ad_duration_seconds": ads_cfg.get("ad_duration_seconds", 3),
        "ad_provider_url": ads_cfg.get(
            "ad_provider_url", "https://example.com/ads/placeholder"),
        "undo_reward_count": ads_cfg.get("undo_reward_count", 1),
    })


MAGIC_CONFIG_PATH = os.path.join(
    os.path.dirname(__file__), "config", "magic.json"
)


@app.route("/api/magic-config", methods=["GET"])
def get_magic_config():
    """Return magic attack configuration for the client."""
    try:
        with open(MAGIC_CONFIG_PATH, "r", encoding="utf-8") as f:
            magic_cfg = json.load(f)
    except (OSError, json.JSONDecodeError):
        magic_cfg = {}
    return jsonify(magic_cfg)


@app.route("/api/images", methods=["GET"])
def list_images():
    """List all image files in static directory."""
    images = sorted([
        f for f in os.listdir(STATIC_DIR)
        if f.lower().endswith(('.png', '.jpg', '.jpeg'))
    ])
    return jsonify({"images": images})


GAME_SETTING_PATH = os.path.join(
    os.path.dirname(__file__), "config", "game_setting.json"
)
FLASH_CONFIG_PATH = os.path.join(
    os.path.dirname(__file__), "config", "flash.json"
)


@app.route("/api/game-setting", methods=["GET"])
def get_game_setting():
    """Return game settings (coins, costs, rewards)."""
    try:
        with open(GAME_SETTING_PATH, "r", encoding="utf-8") as f:
            cfg = json.load(f)
    except (OSError, json.JSONDecodeError):
        cfg = {}
    return jsonify(cfg)


@app.route("/api/flash-config", methods=["GET"])
def get_flash_config():
    """Return flash animation config."""
    try:
        with open(FLASH_CONFIG_PATH, "r", encoding="utf-8") as f:
            cfg = json.load(f)
    except (OSError, json.JSONDecodeError):
        cfg = {}
    return jsonify(cfg)


@app.route("/api/coins", methods=["GET"])
def get_coins():
    """Return current user's coin balance."""
    username = session.get("username")
    if not username:
        return jsonify({"error": "Not authenticated"}), 401
    coins = user_manager.get_coins(username)
    return jsonify({"coins": coins})


@app.route("/api/coins/watch-ad", methods=["POST"])
def watch_ad_for_coins():
    """Reward coins for watching an ad."""
    username = session.get("username")
    if not username:
        return jsonify({"error": "Not authenticated"}), 401
    try:
        with open(GAME_SETTING_PATH, "r", encoding="utf-8") as f:
            cfg = json.load(f)
    except (OSError, json.JSONDecodeError):
        cfg = {}
    reward = cfg.get("ad_coin_reward", 5)
    new_balance = user_manager.add_coins(username, reward)
    return jsonify({"coins": new_balance, "reward": reward})


@app.route("/api/coins/deduct-single", methods=["POST"])
def deduct_single_mode_cost():
    """Deduct coins for entering single-player mode."""
    username = session.get("username")
    if not username:
        return jsonify({"error": "Not authenticated"}), 401
    try:
        with open(GAME_SETTING_PATH, "r", encoding="utf-8") as f:
            cfg = json.load(f)
    except (OSError, json.JSONDecodeError):
        cfg = {}
    cost = cfg.get("single_mode_cost", 5)
    success = user_manager.deduct_coins(username, cost)
    if not success:
        return jsonify({"error": "Insufficient coins", "coins": user_manager.get_coins(username)}), 400

    # Record session spend immediately when coins are deducted
    session_id = session.get("session_id")
    if session_id:
        statistics_manager.record_session_spend(session_id, cost)

    return jsonify({"coins": user_manager.get_coins(username)})


@app.route("/api/active-game", methods=["GET"])
def get_active_game():
    """Check if the current user has an active (in-progress) game session.

    Returns:
      - active: bool
      - mode: "single" | "battle"
      - room_code: str (only for battle mode)
    """
    username = session.get("username")
    unique_code = session.get("unique_code")

    if not username or not unique_code:
        return jsonify({"active": False})

    # Check single-player game state
    state = game_state_manager.get_game_state(unique_code, None)
    if state and not state.get("game_over", False):
        return jsonify({
            "active": True,
            "mode": "single",
            "room_code": None,
        })

    # Check multiplayer: find if user is in any active room
    rooms = room_manager.get_active_rooms()
    for room in rooms:
        if (room.get("room_owner") == username
                or room.get("player2_username") == username):
            room_code = room.get("unique_code")
            # Check if there's an active game state for this room
            room_state = game_state_manager.get_game_state(
                unique_code, room_code
            )
            if room_state and not room_state.get("game_over", False):
                return jsonify({
                    "active": True,
                    "mode": "battle",
                    "room_code": room_code,
                })
            # Even without game state, if they're in a room, offer rejoin
            return jsonify({
                "active": True,
                "mode": "battle",
                "room_code": room_code,
            })

    return jsonify({"active": False})


# --- Helper: broadcast room list to lobby ---

def _broadcast_room_list():
    """Emit updated room list to all clients in the lobby room."""
    rooms = room_manager.get_active_rooms()
    result = []
    for room in rooms:
        player_count = 1
        if room.get("player2_username") is not None:
            player_count = 2
        result.append({
            "alias": room.get("alias", ""),
            "unique_code": room.get("unique_code", ""),
            "player_count": player_count,
            "spectator_access_enabled": room.get("spectator_access_enabled", True),
            "spectator_requires_invitation": room.get("spectator_requires_invitation", True),
            "spectator_count": len(room.get("spectators", [])),
            "room_owner": room.get("room_owner", ""),
            "player2_username": room.get("player2_username", ""),
        })
    socketio.emit("room_list_update", {"rooms": result}, to="lobby")


# --- Room API Routes ---


@app.route("/api/rooms", methods=["GET"])
def get_rooms():
    """Return list of active rooms with alias, unique_code, player count, spectator status."""
    username = session.get("username", "")
    rooms = room_manager.get_active_rooms()
    result = []
    for room in rooms:
        player_count = 1  # Owner is always present
        if room.get("player2_username") is not None:
            player_count = 2
        is_member = (room.get("room_owner") == username
                     or room.get("player2_username") == username)
        result.append({
            "alias": room.get("alias", ""),
            "unique_code": room.get("unique_code", ""),
            "player_count": player_count,
            "spectator_access_enabled": room.get("spectator_access_enabled", True),
            "spectator_requires_invitation": room.get("spectator_requires_invitation", True),
            "spectator_count": len(room.get("spectators", [])),
            "is_member": is_member,
        })
    return jsonify({"rooms": result})


@app.route("/api/rooms/create", methods=["POST"])
def create_room():
    """Create a new room. Returns room data or error."""
    username = session.get("username")
    unique_code = session.get("unique_code")

    if not username or not unique_code:
        return jsonify({"error": "Session missing user data"}), 401

    try:
        room = room_manager.create_room(username, unique_code)
    except ValueError as e:
        return jsonify({"error": str(e)}), 409

    _broadcast_room_list()

    return jsonify({
        "status": "ok",
        "room": {
            "alias": room["alias"],
            "unique_code": room["unique_code"],
            "invitation_code": room["invitation_code"],
            "room_owner": room["room_owner"],
        },
        "redirect": f"/battle/{room['unique_code']}",
    })


@app.route("/api/rooms/join", methods=["POST"])
def join_room():
    """Validate invitation code, join room, return redirect URL."""
    username = session.get("username")
    unique_code = session.get("unique_code")

    if not username or not unique_code:
        return jsonify({"error": "Session missing user data"}), 401

    data = request.get_json(force=True)
    room_code = data.get("room_code", "")
    invitation_code = data.get("invitation_code", "")

    try:
        room = room_manager.join_room(room_code, invitation_code, username, unique_code)
    except ValueError as e:
        error_msg = str(e)
        if "invitation code" in error_msg.lower():
            return jsonify({"error": error_msg}), 403
        if "full" in error_msg.lower():
            return jsonify({"error": error_msg}), 409
        if "own room" in error_msg.lower():
            return jsonify({"error": error_msg}), 409
        if "leave" in error_msg.lower() or "current room" in error_msg.lower():
            return jsonify({"error": error_msg}), 409
        if "not found" in error_msg.lower():
            return jsonify({"error": error_msg}), 404
        return jsonify({"error": error_msg}), 400

    _broadcast_room_list()

    return jsonify({
        "status": "ok",
        "redirect": f"/battle/{room['unique_code']}",
    })


@app.route("/api/rooms/spectate", methods=["POST"])
def spectate_room():
    """Validate spectator access, return redirect URL."""
    username = session.get("username")

    if not username:
        return jsonify({"error": "Session missing user data"}), 401

    data = request.get_json(force=True)
    room_code = data.get("room_code", "")
    invitation_code = data.get("invitation_code")  # May be None if not required

    try:
        room_manager.join_spectator(room_code, invitation_code, username)
    except ValueError as e:
        error_msg = str(e)
        if "invitation code" in error_msg.lower():
            return jsonify({"error": error_msg}), 403
        if "disabled" in error_msg.lower():
            return jsonify({"error": error_msg}), 403
        if "full" in error_msg.lower():
            return jsonify({"error": error_msg}), 409
        if "not found" in error_msg.lower():
            return jsonify({"error": error_msg}), 404
        return jsonify({"error": error_msg}), 400

    _broadcast_room_list()

    return jsonify({
        "status": "ok",
        "redirect": f"/battle/{room_code}",
    })


@app.route("/api/rooms/<code>/delete", methods=["POST"])
def delete_room(code):
    """Owner-only room deletion."""
    username = session.get("username")

    if not username:
        return jsonify({"error": "Session missing user data"}), 401

    try:
        room_manager.delete_room(code, username)
    except ValueError as e:
        error_msg = str(e)
        if "unauthorized" in error_msg.lower():
            return jsonify({"error": error_msg}), 403
        if "not found" in error_msg.lower():
            return jsonify({"error": error_msg}), 404
        return jsonify({"error": error_msg}), 400

    # Notify all players/spectators and clear game state
    handle_room_deleted(socketio, game_state_manager, code)

    _broadcast_room_list()

    return jsonify({"status": "ok"})


@app.route("/api/rooms/<code>/settings", methods=["POST"])
def update_room_settings(code):
    """Owner-only settings update."""
    username = session.get("username")

    if not username:
        return jsonify({"error": "Session missing user data"}), 401

    data = request.get_json(force=True)
    settings = {}
    if "spectator_access_enabled" in data:
        settings["spectator_access_enabled"] = bool(data["spectator_access_enabled"])
    if "spectator_requires_invitation" in data:
        settings["spectator_requires_invitation"] = bool(data["spectator_requires_invitation"])

    try:
        room_manager.update_settings(code, username, settings)
    except ValueError as e:
        error_msg = str(e)
        if "unauthorized" in error_msg.lower():
            return jsonify({"error": error_msg}), 403
        if "not found" in error_msg.lower():
            return jsonify({"error": error_msg}), 404
        return jsonify({"error": error_msg}), 400

    # If spectator access was disabled, kick all spectators (Req 7.3)
    if settings.get("spectator_access_enabled") is False:
        kick_spectators(socketio, room_manager, code)

    return jsonify({"status": "ok"})


if __name__ == "__main__":
    print(f"Tile Explorer running on http://127.0.0.1:{PORT}")
    socketio.run(app, host="0.0.0.0", port=PORT)
