"""Auth blueprint – login / logout / register / session endpoints."""

import hashlib
import json
import os
import uuid

from flask import Blueprint, jsonify, redirect, render_template, request, session

auth_bp = Blueprint("auth", __name__)

# ---------------------------------------------------------------------------
# Paths (resolved at import time via init_auth)
# ---------------------------------------------------------------------------
_base_dir: str = ""
USERS_PATH: str = ""

# Active sessions: {username: session_token} - only one active session per user
_active_sessions: dict[str, str] = {}


def init_auth(base_dir: str, *, load_roles_fn, load_authorities_fn, cleanup_old_builds_fn):
    """Wire up runtime dependencies injected from the app factory."""
    global _base_dir, USERS_PATH, _load_roles, _load_authorities, _cleanup_old_builds
    _base_dir = base_dir
    USERS_PATH = os.path.join(base_dir, "iam", "users.json")
    _load_roles = load_roles_fn
    _load_authorities = load_authorities_fn
    _cleanup_old_builds = cleanup_old_builds_fn


# Placeholders replaced by init_auth
_load_roles = lambda: []
_load_authorities = lambda: []
_cleanup_old_builds = lambda username: None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _md5(text: str) -> str:
    return hashlib.md5(text.encode()).hexdigest()


def _load_users() -> list:
    if not os.path.isfile(USERS_PATH):
        return []
    with open(USERS_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def _save_users(users: list) -> None:
    with open(USERS_PATH, "w", encoding="utf-8") as f:
        json.dump(users, f, ensure_ascii=False, indent=2)


# ---------------------------------------------------------------------------
# Before-request hook (registered on the app, not here)
# ---------------------------------------------------------------------------
def require_login():
    """Require login for all routes except auth and static."""
    allowed_prefixes = ("/auth/", "/static/", "/login")
    if any(request.path.startswith(p) for p in allowed_prefixes):
        return
    if not session.get("logged_in"):
        return redirect("/login")
    username = session.get("username")
    token = session.get("token")
    if username and token and _active_sessions.get(username) != token:
        session.clear()
        return redirect("/login")


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@auth_bp.route("/login")
def login_page():
    if session.get("logged_in"):
        return redirect("/")
    return render_template("login.html")


@auth_bp.route("/auth/login", methods=["POST"])
def auth_login():
    data = request.get_json(force=True)
    username = data.get("username", "")
    password = data.get("password", "")
    users = _load_users()
    for u in users:
        if u["username"] == username and u["password"] == _md5(password):
            token = str(uuid.uuid4())
            _active_sessions[username] = token
            session["logged_in"] = True
            session["username"] = username
            session["role"] = u.get("role", "worker")
            session["token"] = token
            # Cleanup old CICD builds on login
            try:
                _cleanup_old_builds(username)
            except Exception:
                pass
            # Get user menus based on role
            role = u.get("role", "worker")
            roles = _load_roles()
            authorities = _load_authorities()
            authority_str = ""
            for r in roles:
                if r["role"] == role:
                    authority_str = r["authority"]
                    break
            authority_names = [a.strip() for a in authority_str.split(",") if a.strip()]
            menus_set: set = set()
            for auth_name in authority_names:
                for a in authorities:
                    if a["authority"] == auth_name:
                        menus_set.update(a.get("menus", []))
                        break
            all_menus_order = [
                "Home", "Workers", "Config", "History", "MD5", "SHA1",
                "Plugin", "CICD", "Play", "IAM", "Family",
            ]
            menus = [m for m in all_menus_order if m in menus_set]
            for m in menus_set:
                if m not in menus:
                    menus.append(m)
            return jsonify({"status": "ok", "username": username, "role": role, "menus": menus})
    return jsonify({"error": "Invalid username or password"}), 401


@auth_bp.route("/auth/register", methods=["POST"])
def auth_register():
    data = request.get_json(force=True)
    admin_user = data.get("admin_username", "")
    admin_pass = data.get("admin_password", "")
    new_user = data.get("username", "")
    new_pass = data.get("password", "")

    users = _load_users()
    admin_ok = False
    for u in users:
        if u["username"] == admin_user and u["password"] == _md5(admin_pass) and u["role"] == "admin":
            admin_ok = True
            break
    if not admin_ok:
        return jsonify({"error": "Admin authentication failed"}), 403

    for u in users:
        if u["username"] == new_user:
            return jsonify({"error": "Username already exists"}), 409

    users.append({
        "username": new_user,
        "password": _md5(new_pass),
        "role": "worker",
    })
    _save_users(users)
    return jsonify({"status": "ok", "username": new_user})


@auth_bp.route("/auth/logout", methods=["POST"])
def auth_logout():
    session.clear()
    return jsonify({"status": "ok"})


@auth_bp.route("/auth/me", methods=["GET"])
def auth_me():
    """Return current logged-in user info."""
    if session.get("logged_in"):
        username = session.get("username")
        token = session.get("token")
        if username and token and _active_sessions.get(username) != token:
            session.clear()
            return jsonify({"error": "Session expired (logged in elsewhere)"}), 401
        return jsonify({"username": username, "role": session.get("role")})
    return jsonify({"error": "not logged in"}), 401
