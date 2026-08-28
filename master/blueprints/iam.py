"""IAM blueprint – users / roles / authorities / resources management."""

import json
import os

from flask import Blueprint, jsonify, request, session

iam_bp = Blueprint("iam", __name__)

# ---------------------------------------------------------------------------
# Paths (set via init_iam)
# ---------------------------------------------------------------------------
ROLE_PATH: str = ""
AUTHORITY_PATH: str = ""
RESOURCES_PATH: str = ""

# Injected helpers
_load_users = lambda: []
_save_users = lambda users: None
_md5 = lambda text: ""


def init_iam(base_dir: str, *, load_users_fn, save_users_fn, md5_fn):
    """Wire up runtime dependencies."""
    global ROLE_PATH, AUTHORITY_PATH, RESOURCES_PATH
    global _load_users, _save_users, _md5
    ROLE_PATH = os.path.join(base_dir, "iam", "role.json")
    AUTHORITY_PATH = os.path.join(base_dir, "iam", "authority.json")
    RESOURCES_PATH = os.path.join(base_dir, "iam", "resources.json")
    _load_users = load_users_fn
    _save_users = save_users_fn
    _md5 = md5_fn


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _load_roles() -> list:
    if not os.path.isfile(ROLE_PATH):
        return []
    with open(ROLE_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def _load_authorities() -> list:
    if not os.path.isfile(AUTHORITY_PATH):
        return []
    with open(AUTHORITY_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def _load_resources() -> list:
    if not os.path.isfile(RESOURCES_PATH):
        return ["Home", "Workers", "Config", "History", "MD5", "SHA1", "Plugin", "CICD", "Play", "IAM", "Family"]
    with open(RESOURCES_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def _save_resources(resources: list) -> None:
    with open(RESOURCES_PATH, "w", encoding="utf-8") as f:
        json.dump(resources, f, ensure_ascii=False, indent=2)


# ---------------------------------------------------------------------------
# User routes
# ---------------------------------------------------------------------------
@iam_bp.route("/iam/users", methods=["GET"])
def iam_users():
    """Get all users (without password hash)."""
    users = _load_users()
    return jsonify({"users": [{"username": u["username"], "role": u["role"]} for u in users]})


@iam_bp.route("/iam/users/update", methods=["POST"])
def iam_users_update():
    """Update a user's password and/or role."""
    data = request.get_json(force=True)
    target_username = data.get("username", "")
    new_password = data.get("password", "")
    new_role = data.get("role", "")

    if not target_username:
        return jsonify({"error": "username is required"}), 400
    if target_username == "admin" and new_role and new_role != "admin":
        return jsonify({"error": "Cannot change admin's role"}), 403

    users = _load_users()
    found = False
    for u in users:
        if u["username"] == target_username:
            if new_password:
                u["password"] = _md5(new_password)
            if new_role:
                u["role"] = new_role
            found = True
            break

    if not found:
        return jsonify({"error": "User not found"}), 404

    _save_users(users)

    if new_role and session.get("username") == target_username:
        session["role"] = new_role

    return jsonify({"status": "ok"})


@iam_bp.route("/iam/users/delete", methods=["POST"])
def iam_users_delete():
    """Delete a user."""
    data = request.get_json(force=True)
    target_username = data.get("username", "")

    if not target_username:
        return jsonify({"error": "username is required"}), 400
    if target_username == "admin":
        return jsonify({"error": "Cannot delete admin user"}), 403

    users = _load_users()
    new_users = [u for u in users if u["username"] != target_username]
    if len(new_users) == len(users):
        return jsonify({"error": "User not found"}), 404

    _save_users(new_users)
    return jsonify({"status": "ok"})


@iam_bp.route("/iam/users/create", methods=["POST"])
def iam_users_create():
    """Create a new user."""
    data = request.get_json(force=True)
    username = data.get("username", "").strip()
    password = data.get("password", "").strip()
    role = data.get("role", "worker").strip()

    if not username:
        return jsonify({"error": "username is required"}), 400
    if not password:
        return jsonify({"error": "password is required"}), 400

    users = _load_users()
    for u in users:
        if u["username"] == username:
            return jsonify({"error": "Username already exists"}), 409

    users.append({
        "username": username,
        "password": _md5(password),
        "role": role,
    })
    _save_users(users)
    return jsonify({"status": "ok"})


# ---------------------------------------------------------------------------
# Role routes
# ---------------------------------------------------------------------------
@iam_bp.route("/iam/roles", methods=["GET"])
def iam_roles():
    """Get all roles."""
    return jsonify({"roles": _load_roles()})


@iam_bp.route("/iam/roles/update", methods=["POST"])
def iam_roles_update():
    """Update a role's authorities."""
    data = request.get_json(force=True)
    role_name = data.get("role", "")
    new_authorities = data.get("authorities", [])

    if not role_name:
        return jsonify({"error": "role is required"}), 400
    if not new_authorities:
        return jsonify({"error": "authorities must be a non-empty array"}), 400

    roles = _load_roles()
    found = False
    for r in roles:
        if r["role"] == role_name:
            r["authority"] = ",".join(new_authorities)
            found = True
            break

    if not found:
        return jsonify({"error": "Role not found"}), 404

    with open(ROLE_PATH, "w", encoding="utf-8") as f:
        json.dump(roles, f, ensure_ascii=False, indent=2)

    return jsonify({"status": "ok"})


@iam_bp.route("/iam/roles/create", methods=["POST"])
def iam_roles_create():
    """Create a new role."""
    data = request.get_json(force=True)
    role_name = data.get("role", "").strip()
    authority = data.get("authority", "").strip()

    if not role_name:
        return jsonify({"error": "role name is required"}), 400

    roles = _load_roles()
    for r in roles:
        if r["role"] == role_name:
            return jsonify({"error": "Role already exists"}), 409

    roles.append({"role": role_name, "authority": authority or ""})

    with open(ROLE_PATH, "w", encoding="utf-8") as f:
        json.dump(roles, f, ensure_ascii=False, indent=2)

    return jsonify({"status": "ok"})


@iam_bp.route("/iam/roles/delete", methods=["POST"])
def iam_roles_delete():
    """Delete a role."""
    data = request.get_json(force=True)
    role_name = data.get("role", "").strip()

    if not role_name:
        return jsonify({"error": "role name is required"}), 400
    if role_name == "admin":
        return jsonify({"error": "Cannot delete admin role"}), 403

    users = _load_users()
    referencing_users = [u["username"] for u in users if u.get("role") == role_name]
    if referencing_users:
        return jsonify({"error": f"Cannot delete: role '{role_name}' is referenced by user(s): {', '.join(referencing_users)}"}), 409

    roles = _load_roles()
    new_roles = [r for r in roles if r["role"] != role_name]
    if len(new_roles) == len(roles):
        return jsonify({"error": "Role not found"}), 404

    with open(ROLE_PATH, "w", encoding="utf-8") as f:
        json.dump(new_roles, f, ensure_ascii=False, indent=2)

    return jsonify({"status": "ok"})


# ---------------------------------------------------------------------------
# Authority routes
# ---------------------------------------------------------------------------
@iam_bp.route("/iam/authorities", methods=["GET"])
def iam_authorities():
    """Get all authorities."""
    return jsonify({"authorities": _load_authorities()})


@iam_bp.route("/iam/authorities/update", methods=["POST"])
def iam_authorities_update():
    """Update an authority's menus."""
    data = request.get_json(force=True)
    authority_name = data.get("authority", "")
    new_menus = data.get("menus", [])

    if not authority_name:
        return jsonify({"error": "authority is required"}), 400

    authorities = _load_authorities()
    found = False
    for a in authorities:
        if a["authority"] == authority_name:
            a["menus"] = new_menus
            found = True
            break

    if not found:
        return jsonify({"error": "Authority not found"}), 404

    with open(AUTHORITY_PATH, "w", encoding="utf-8") as f:
        json.dump(authorities, f, ensure_ascii=False, indent=2)

    return jsonify({"status": "ok"})


@iam_bp.route("/iam/authorities/create", methods=["POST"])
def iam_authorities_create():
    """Create a new authority."""
    data = request.get_json(force=True)
    authority_name = data.get("authority", "")
    menus = data.get("menus", [])

    if not authority_name:
        return jsonify({"error": "authority name is required"}), 400

    authorities = _load_authorities()
    for a in authorities:
        if a["authority"] == authority_name:
            return jsonify({"error": "Authority already exists"}), 409

    authorities.append({"authority": authority_name, "menus": menus})

    with open(AUTHORITY_PATH, "w", encoding="utf-8") as f:
        json.dump(authorities, f, ensure_ascii=False, indent=2)

    return jsonify({"status": "ok"})


@iam_bp.route("/iam/authorities/delete", methods=["POST"])
def iam_authorities_delete():
    """Delete an authority."""
    data = request.get_json(force=True)
    authority_name = data.get("authority", "").strip()

    if not authority_name:
        return jsonify({"error": "authority name is required"}), 400
    if authority_name == "administrator_privileges":
        return jsonify({"error": "Cannot delete administrator_privileges"}), 403

    roles = _load_roles()
    referencing_roles = []
    for r in roles:
        auths = [a.strip() for a in r["authority"].split(",") if a.strip()]
        if authority_name in auths:
            referencing_roles.append(r["role"])
    if referencing_roles:
        return jsonify({"error": f"Cannot delete: authority '{authority_name}' is referenced by role(s): {', '.join(referencing_roles)}"}), 409

    authorities = _load_authorities()
    new_authorities = [a for a in authorities if a["authority"] != authority_name]
    if len(new_authorities) == len(authorities):
        return jsonify({"error": "Authority not found"}), 404

    with open(AUTHORITY_PATH, "w", encoding="utf-8") as f:
        json.dump(new_authorities, f, ensure_ascii=False, indent=2)

    return jsonify({"status": "ok"})


# ---------------------------------------------------------------------------
# Resource routes
# ---------------------------------------------------------------------------
@iam_bp.route("/iam/resources", methods=["GET"])
def iam_resources():
    """Get all resources."""
    return jsonify({"resources": _load_resources()})


@iam_bp.route("/iam/resources/create", methods=["POST"])
def iam_resources_create():
    """Create a new resource."""
    data = request.get_json(force=True)
    resource_name = data.get("resource", "").strip()

    if not resource_name:
        return jsonify({"error": "resource name is required"}), 400

    resources = _load_resources()
    if resource_name in resources:
        return jsonify({"error": "Resource already exists"}), 409

    resources.append(resource_name)
    _save_resources(resources)
    return jsonify({"status": "ok"})


@iam_bp.route("/iam/resources/delete", methods=["POST"])
def iam_resources_delete():
    """Delete a resource."""
    data = request.get_json(force=True)
    resource_name = data.get("resource", "").strip()

    if not resource_name:
        return jsonify({"error": "resource name is required"}), 400

    authorities = _load_authorities()
    referencing_auths = [a["authority"] for a in authorities if resource_name in a.get("menus", [])]
    if referencing_auths:
        return jsonify({"error": f"Cannot delete: resource '{resource_name}' is referenced by authority(ies): {', '.join(referencing_auths)}"}), 409

    resources = _load_resources()
    if resource_name not in resources:
        return jsonify({"error": "Resource not found"}), 404

    resources.remove(resource_name)
    _save_resources(resources)
    return jsonify({"status": "ok"})


@iam_bp.route("/iam/resources/rename", methods=["POST"])
def iam_resources_rename():
    """Rename a resource."""
    data = request.get_json(force=True)
    old_name = data.get("old_name", "").strip()
    new_name = data.get("new_name", "").strip()

    if not old_name or not new_name:
        return jsonify({"error": "old_name and new_name are required"}), 400
    if old_name == new_name:
        return jsonify({"status": "ok"})

    resources = _load_resources()
    if old_name not in resources:
        return jsonify({"error": "Resource not found"}), 404
    if new_name in resources:
        return jsonify({"error": "Resource name already exists"}), 409

    idx = resources.index(old_name)
    resources[idx] = new_name
    _save_resources(resources)

    authorities = _load_authorities()
    changed = False
    for a in authorities:
        if old_name in a.get("menus", []):
            menu_idx = a["menus"].index(old_name)
            a["menus"][menu_idx] = new_name
            changed = True
    if changed:
        with open(AUTHORITY_PATH, "w", encoding="utf-8") as f:
            json.dump(authorities, f, ensure_ascii=False, indent=2)

    return jsonify({"status": "ok"})


# ---------------------------------------------------------------------------
# Menu route
# ---------------------------------------------------------------------------
@iam_bp.route("/iam/menus", methods=["GET"])
def iam_menus():
    """Get the menu list for the current logged-in user."""
    username = session.get("username")
    role = session.get("role")
    if not username or not role:
        return jsonify({"error": "not logged in"}), 401

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
        "Plugin", "CICD", "Play", "IAM", "Family", "Settings",
    ]
    menus = [m for m in all_menus_order if m in menus_set]
    for m in menus_set:
        if m not in menus:
            menus.append(m)

    return jsonify({"menus": menus, "role": role, "authority": authority_str})
