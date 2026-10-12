"""CICD blueprint – views, items, build execution, settings."""

import json
import os
import time

from flask import Blueprint, jsonify, request, session

cicd_bp = Blueprint("cicd", __name__)

# ---------------------------------------------------------------------------
# Paths & dependencies (set via init_cicd)
# ---------------------------------------------------------------------------
CICD_VIEW_PATH: str = ""
CICD_SETTING_PATH: str = ""
CICD_CONFIG_PATH: str = ""
CICD_LOGS_DIR: str = ""

_config = None  # ClusterConfig instance
_worker_session = None  # requests.Session


def init_cicd(base_dir: str, *, config, worker_session):
    """Inject runtime dependencies."""
    global CICD_VIEW_PATH, CICD_SETTING_PATH, CICD_CONFIG_PATH, CICD_LOGS_DIR
    global _config, _worker_session
    CICD_VIEW_PATH = os.path.join(base_dir, "cicd", "user_cicd_view.json")
    CICD_SETTING_PATH = os.path.join(base_dir, "cicd", "user_cicd_setting.json")
    CICD_CONFIG_PATH = os.path.join(base_dir, "cicd", "config.json")
    CICD_LOGS_DIR = os.path.join(base_dir, "cicd", "logs")
    _config = config
    _worker_session = worker_session


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _load_cicd_config():
    if not os.path.isfile(CICD_CONFIG_PATH):
        return {"max_builds": 50, "max_days": 30}
    with open(CICD_CONFIG_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def _get_cicd_username():
    return session.get("username", "admin")


def _load_cicd_all():
    if not os.path.isfile(CICD_VIEW_PATH):
        return []
    with open(CICD_VIEW_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def _save_cicd_all(data):
    os.makedirs(os.path.dirname(CICD_VIEW_PATH), exist_ok=True)
    with open(CICD_VIEW_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def _load_cicd():
    username = _get_cicd_username()
    all_data = _load_cicd_all()
    for entry in all_data:
        if entry.get("username") == username:
            return {"views": entry.get("views", []), "items": entry.get("items", [])}
    return {"views": [], "items": []}


def _save_cicd(data):
    username = _get_cicd_username()
    all_data = _load_cicd_all()
    found = False
    for entry in all_data:
        if entry.get("username") == username:
            entry["views"] = data.get("views", [])
            entry["items"] = data.get("items", [])
            found = True
            break
    if not found:
        all_data.append({"username": username, "views": data.get("views", []), "items": data.get("items", [])})
    _save_cicd_all(all_data)


def _load_cicd_settings():
    if not os.path.isfile(CICD_SETTING_PATH):
        return []
    with open(CICD_SETTING_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def _save_cicd_settings(data):
    os.makedirs(os.path.dirname(CICD_SETTING_PATH), exist_ok=True)
    with open(CICD_SETTING_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def _get_user_settings():
    username = _get_cicd_username()
    all_settings = _load_cicd_settings()
    for entry in all_settings:
        if entry.get("username") == username:
            return entry.get("setting", {})
    return {}


def _save_user_settings(setting):
    username = _get_cicd_username()
    all_settings = _load_cicd_settings()
    found = False
    for entry in all_settings:
        if entry.get("username") == username:
            entry["setting"] = setting
            found = True
            break
    if not found:
        all_settings.append({"username": username, "setting": setting})
    _save_cicd_settings(all_settings)


def _save_build_log(username, item_name, build_number, log_content):
    log_dir = os.path.join(CICD_LOGS_DIR, username, item_name)
    os.makedirs(log_dir, exist_ok=True)
    log_path = os.path.join(log_dir, f"build_{build_number}.log")
    with open(log_path, "w", encoding="utf-8") as f:
        f.write(log_content)


def _load_build_log(username, item_name, build_number):
    log_path = os.path.join(CICD_LOGS_DIR, username, item_name, f"build_{build_number}.log")
    if os.path.isfile(log_path):
        with open(log_path, "r", encoding="utf-8") as f:
            return f.read()
    return None


def cleanup_old_builds(username):
    """Remove build records exceeding max_builds or max_days for a user."""
    from datetime import datetime, timedelta
    cfg = _load_cicd_config()
    max_builds = cfg.get("max_builds", 50)
    max_days = cfg.get("max_days", 30)
    cutoff_date = datetime.now() - timedelta(days=max_days)

    all_data = _load_cicd_all()
    changed = False
    for entry in all_data:
        if entry.get("username") != username:
            continue
        for item in entry.get("items", []):
            history = item.get("build_history", [])
            if not history:
                continue
            original_len = len(history)
            filtered = []
            for b in history:
                ts = b.get("timestamp", "")
                if ts:
                    try:
                        build_time = datetime.strptime(ts, "%Y-%m-%d %H:%M:%S")
                        if build_time < cutoff_date:
                            log_path = os.path.join(CICD_LOGS_DIR, username, item["name"], f"build_{b['number']}.log")
                            if os.path.isfile(log_path):
                                os.remove(log_path)
                            continue
                    except ValueError:
                        pass
                filtered.append(b)
            if len(filtered) > max_builds:
                removed = filtered[:-max_builds]
                filtered = filtered[-max_builds:]
                for b in removed:
                    log_path = os.path.join(CICD_LOGS_DIR, username, item["name"], f"build_{b['number']}.log")
                    if os.path.isfile(log_path):
                        os.remove(log_path)
            if len(filtered) != original_len:
                item["build_history"] = filtered
                changed = True
    if changed:
        _save_cicd_all(all_data)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@cicd_bp.route("/cicd/views", methods=["GET"])
def cicd_list_views():
    data = _load_cicd()
    return jsonify({"views": data.get("views", [])})


@cicd_bp.route("/cicd/views", methods=["POST"])
def cicd_create_view():
    req = request.get_json(force=True)
    name = req.get("name", "").strip()
    parent = req.get("parent", "")
    if not name:
        return jsonify({"error": "View name is required"}), 400
    data = _load_cicd()
    for v in data["views"]:
        if v["name"] == name and v.get("parent", "") == parent:
            return jsonify({"error": "View already exists"}), 409
    data["views"].append({"name": name, "parent": parent, "items": req.get("items", [])})
    _save_cicd(data)
    return jsonify({"status": "ok", "views": data["views"]})


@cicd_bp.route("/cicd/views/update", methods=["POST"])
def cicd_update_view():
    req = request.get_json(force=True)
    name = req.get("name", "").strip()
    parent = req.get("parent", "")
    items = req.get("items", [])
    data = _load_cicd()
    found = False
    for v in data["views"]:
        if v["name"] == name and v.get("parent", "") == parent:
            v["items"] = items
            found = True
            break
    if not found:
        return jsonify({"error": "View not found"}), 404
    _save_cicd(data)
    return jsonify({"status": "ok"})


@cicd_bp.route("/cicd/views/delete", methods=["POST"])
def cicd_delete_view():
    req = request.get_json(force=True)
    name = req.get("name", "").strip()
    parent = req.get("parent", "")
    data = _load_cicd()
    data["views"] = [v for v in data["views"] if not (v["name"] == name and v.get("parent", "") == parent)]
    _save_cicd(data)
    return jsonify({"status": "ok"})


@cicd_bp.route("/cicd/items", methods=["GET"])
def cicd_list_items():
    parent = request.args.get("parent", "")
    data = _load_cicd()
    items = data.get("items", [])
    if parent:
        view = None
        for v in data.get("views", []):
            if v["name"] == parent:
                view = v
                break
        if view:
            view_item_names = view.get("items", [])
            items = [i for i in items if i["name"] in view_item_names]
    return jsonify({"items": items})


@cicd_bp.route("/cicd/items", methods=["POST"])
def cicd_create_item():
    req = request.get_json(force=True)
    name = req.get("name", "").strip()
    item_type = req.get("type", "freestyle")
    parent_view = req.get("parent_view", "")
    if not name:
        return jsonify({"error": "Item name is required"}), 400
    data = _load_cicd()
    for i in data["items"]:
        if i["name"] == name and i.get("parent_view", "") == parent_view:
            return jsonify({"error": "Item already exists"}), 409
    item = {
        "name": name,
        "type": item_type,
        "parent_view": parent_view,
        "enabled": True,
        "description": "",
        "scm": {"type": "none"},
        "triggers": [],
        "environment": {},
        "build_steps": [],
        "post_build": [],
        "last_success": None,
        "last_failure": None,
        "last_duration": None,
        "build_history": [],
    }
    data["items"].append(item)
    if parent_view:
        for v in data["views"]:
            if v["name"] == parent_view:
                if name not in v.get("items", []):
                    v.setdefault("items", []).append(name)
                break
    _save_cicd(data)
    return jsonify({"status": "ok", "item": item})


@cicd_bp.route("/cicd/items/get", methods=["GET"])
def cicd_get_item():
    name = request.args.get("name", "")
    parent_view = request.args.get("parent_view", "")
    data = _load_cicd()
    for i in data["items"]:
        if i["name"] == name and i.get("parent_view", "") == parent_view:
            return jsonify({"item": i})
    for i in data["items"]:
        if i["name"] == name:
            return jsonify({"item": i})
    return jsonify({"error": "Item not found"}), 404


@cicd_bp.route("/cicd/items/update", methods=["POST"])
def cicd_update_item():
    req = request.get_json(force=True)
    name = req.get("name", "").strip()
    parent_view = req.get("parent_view", "")

    dangerous_patterns = ["rm -rf", "rm -r", "rmdir /s", "del /f", "format ", "mkfs.", "dd if="]
    for steps_key in ["build_steps", "post_build"]:
        steps = req.get(steps_key, [])
        for step in steps:
            if step.get("type") == "ssh":
                cmd = step.get("config", {}).get("exec_command", "").strip()
                if cmd:
                    for line in cmd.splitlines():
                        line_lower = line.strip().lower()
                        if not line_lower:
                            continue
                        if line_lower == "rm" or line_lower.startswith("rm ") or line_lower.startswith("rm;"):
                            return jsonify({"error": f"Dangerous command 'rm' detected in {steps_key}. Forbidden for safety."}), 400
                        for dp in dangerous_patterns:
                            if dp in line_lower:
                                return jsonify({"error": f"Dangerous command '{dp.strip()}' detected in {steps_key}. Forbidden for safety."}), 400
                        parts = line_lower.replace("&&", ";").replace("|", ";").split(";")
                        for part in parts:
                            part = part.strip()
                            if part == "rm" or part.startswith("rm "):
                                return jsonify({"error": f"Dangerous command 'rm' detected in {steps_key}. Forbidden for safety."}), 400

    data = _load_cicd()
    found = False
    for i in data["items"]:
        if i["name"] == name and i.get("parent_view", "") == parent_view:
            for key in ["enabled", "description", "scm", "triggers", "environment", "build_steps", "post_build", "parameters", "trigger_token"]:
                if key in req:
                    i[key] = req[key]
            found = True
            break
    if not found:
        for i in data["items"]:
            if i["name"] == name:
                for key in ["enabled", "description", "scm", "triggers", "environment", "build_steps", "post_build", "parameters", "trigger_token"]:
                    if key in req:
                        i[key] = req[key]
                found = True
                break
    if not found:
        return jsonify({"error": "Item not found"}), 404
    _save_cicd(data)
    return jsonify({"status": "ok"})


@cicd_bp.route("/cicd/items/delete", methods=["POST"])
def cicd_delete_item():
    req = request.get_json(force=True)
    name = req.get("name", "").strip()
    parent_view = req.get("parent_view", "")
    data = _load_cicd()
    data["items"] = [i for i in data["items"] if not (i["name"] == name and i.get("parent_view", "") == parent_view)]
    for v in data["views"]:
        if name in v.get("items", []):
            v["items"].remove(name)
    _save_cicd(data)
    return jsonify({"status": "ok"})


@cicd_bp.route("/cicd/items/run", methods=["POST"])
def cicd_run_item():
    """Execute a CICD item's build steps."""
    import subprocess
    try:
        import paramiko
    except ImportError:
        paramiko = None

    req = request.get_json(force=True)
    name = req.get("name", "").strip()
    parent_view = req.get("parent_view", "")
    data = _load_cicd()
    item = None
    for i in data["items"]:
        if i["name"] == name and i.get("parent_view", "") == parent_view:
            item = i
            break
    if not item:
        for i in data["items"]:
            if i["name"] == name:
                item = i
                break
    if not item:
        return jsonify({"error": "Item not found"}), 404

    results = []
    build_number = len(item.get("build_history", [])) + 1
    start_time = time.time()

    for step in item.get("build_steps", []):
        step_type = step.get("type", "")
        if step_type == "ssh":
            if paramiko is None:
                results.append({"step": step_type, "success": False, "output": "paramiko not installed. Run: pip install paramiko"})
                continue
            ssh_config = step.get("config", {})
            server_name = ssh_config.get("hostname", "")
            remote_dir = ssh_config.get("remote_directory", "")
            exec_command = ssh_config.get("exec_command", "")
            source_files = ssh_config.get("source_files", "")

            user_setting = _get_user_settings()
            ssh_key_config = user_setting.get("ssh_key", {})
            global_disable_exec = user_setting.get("disable_exec", False)
            ssh_servers = user_setting.get("ssh_servers", [])
            server_info = None
            for srv in ssh_servers:
                if srv.get("name") == server_name:
                    server_info = srv
                    break
            if not server_info:
                results.append({"step": step_type, "success": False, "output": f"SSH Server '{server_name}' not found in settings"})
                continue

            if global_disable_exec and exec_command:
                results.append({"step": step_type, "success": False, "output": "Exec commands are disabled globally in settings (Disable exec is checked). Build failed."})
                continue

            if exec_command:
                dangerous_patterns_exec = ["rm -rf", "rm -r", "rmdir /s", "del /f", "format ", "mkfs.", "dd if="]
                is_dangerous = False
                for line in exec_command.splitlines():
                    line_lower = line.strip().lower()
                    if not line_lower:
                        continue
                    if line_lower == "rm" or line_lower.startswith("rm ") or line_lower.startswith("rm;"):
                        is_dangerous = True
                        break
                    for dp in dangerous_patterns_exec:
                        if dp in line_lower:
                            is_dangerous = True
                            break
                    if is_dangerous:
                        break
                    parts = line_lower.replace("&&", ";").replace("|", ";").split(";")
                    for part in parts:
                        part = part.strip()
                        if part == "rm" or part.startswith("rm "):
                            is_dangerous = True
                            break
                    if is_dangerous:
                        break
                if is_dangerous:
                    results.append({"step": step_type, "success": False, "output": "Dangerous command detected. Commands containing rm, rm -rf, del /f, format, mkfs, dd if= are forbidden. Build failed."})
                    continue

            hostname = server_info.get("hostname", "")
            port = int(server_info.get("port", 22))
            username = server_info.get("username", "")
            srv_key_path = server_info.get("key_path", "")
            srv_key_content = server_info.get("key_content", "")
            srv_passphrase = server_info.get("passphrase", "")
            key_path = srv_key_path if srv_key_path else ssh_key_config.get("path_to_key", "")
            key_content = srv_key_content if srv_key_content else ssh_key_config.get("key_content", "")
            passphrase = srv_passphrase if srv_passphrase else ssh_key_config.get("passphrase", "")
            if not remote_dir:
                remote_dir = server_info.get("remote_directory", "")

            try:
                import io as _io
                client = paramiko.SSHClient()
                client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
                connect_kwargs = {"hostname": hostname, "port": port, "username": username, "timeout": 30}
                if key_content:
                    key_file = _io.StringIO(key_content)
                    pkey = None
                    key_classes = [paramiko.RSAKey, paramiko.Ed25519Key, paramiko.ECDSAKey]
                    if hasattr(paramiko, 'DSSKey'):
                        key_classes.append(paramiko.DSSKey)
                    for key_class in key_classes:
                        try:
                            key_file.seek(0)
                            pkey = key_class.from_private_key(key_file, password=passphrase or None)
                            break
                        except Exception:
                            continue
                    if pkey:
                        connect_kwargs["pkey"] = pkey
                    else:
                        results.append({"step": step_type, "success": False, "output": "Failed to parse SSH private key content"})
                        continue
                elif key_path and os.path.isfile(key_path):
                    connect_kwargs["key_filename"] = key_path
                    if passphrase:
                        connect_kwargs["passphrase"] = passphrase
                client.connect(**connect_kwargs)

                output_lines = []
                if source_files:
                    sftp = client.open_sftp()
                    for src in source_files.split(","):
                        src = src.strip()
                        if src and os.path.isfile(src):
                            remote_path = remote_dir.rstrip("/") + "/" + os.path.basename(src) if remote_dir else os.path.basename(src)
                            sftp.put(src, remote_path)
                            output_lines.append(f"Transferred: {src} -> {remote_path}")
                    sftp.close()

                if exec_command:
                    if remote_dir:
                        exec_command = f"cd {remote_dir} && {exec_command}"
                    stdin, stdout, stderr = client.exec_command(exec_command)
                    out = stdout.read().decode("utf-8", errors="replace")
                    err = stderr.read().decode("utf-8", errors="replace")
                    exit_code = stdout.channel.recv_exit_status()
                    output_lines.append(out)
                    if err:
                        output_lines.append(f"STDERR: {err}")
                    results.append({"step": step_type, "success": exit_code == 0, "output": "\n".join(output_lines), "exit_code": exit_code})
                else:
                    results.append({"step": step_type, "success": True, "output": "\n".join(output_lines)})

                client.close()
            except Exception as exc:
                results.append({"step": step_type, "success": False, "output": str(exc)})
        else:
            results.append({"step": step_type, "success": False, "output": "Unsupported step type"})

    duration = round(time.time() - start_time, 1)
    all_success = all(r.get("success") for r in results) if results else False

    build_record = {
        "number": build_number,
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
        "duration": f"{duration}s",
        "success": all_success,
        "results": results,
    }
    item.setdefault("build_history", []).append(build_record)
    if all_success:
        item["last_success"] = build_record["timestamp"]
        item["last_duration"] = build_record["duration"]
    else:
        item["last_failure"] = build_record["timestamp"]
        item["last_duration"] = build_record["duration"]
    _save_cicd(data)

    # Save console log
    cicd_username = _get_cicd_username()
    log_lines = []
    log_lines.append(f"Started by user {cicd_username}")
    log_lines.append("Running as SYSTEM")
    log_lines.append(f"Building in workspace /cicd/workspace/{name}")
    log_lines.append("")
    for idx, r in enumerate(results):
        if r.get("step") == "ssh":
            step_config = item.get("build_steps", [{}])[idx].get("config", {}) if idx < len(item.get("build_steps", [])) else {}
            log_lines.append(f"SSH: Connecting with configuration [{step_config.get('hostname', 'unknown')}] ...")
            log_lines.append("SSH: Connected")
            log_lines.append("SSH: Opening exec channel ...")
            log_lines.append("SSH: EXEC: channel open")
            if step_config.get("exec_command"):
                log_lines.append(f"SSH: EXEC: STDOUT/STDERR from command [{step_config['exec_command']}]")
            if r.get("output"):
                log_lines.append(r["output"])
            log_lines.append("SSH: EXEC: completed")
            if "exit_code" in r:
                log_lines.append(f"SSH: EXEC: exit status: {r['exit_code']}")
            log_lines.append("SSH: Disconnecting configuration ...")
            log_lines.append("")
    log_lines.append(f"Finished: {'SUCCESS' if all_success else 'UNSTABLE'}")
    _save_build_log(cicd_username, name, build_number, "\n".join(log_lines))

    return jsonify({"status": "ok" if all_success else "error", "build": build_record})


@cicd_bp.route("/cicd/build-log", methods=["GET"])
def cicd_build_log():
    item_name = request.args.get("item", "")
    build_number = request.args.get("build", 0, type=int)
    username = _get_cicd_username()
    log = _load_build_log(username, item_name, build_number)
    if log is None:
        return jsonify({"error": "Log not found"}), 404
    return jsonify({"log": log})


@cicd_bp.route("/cicd/nodes", methods=["GET"])
def cicd_nodes():
    nodes = [{"name": "master(local)", "addr": "master"}]
    for w in _config.workers:
        alias = w.get("alias", "")
        name = alias if alias else w["addr"]
        nodes.append({"name": name, "addr": w["addr"]})
    return jsonify({"nodes": nodes})


@cicd_bp.route("/cicd/nodes/health", methods=["GET"])
def cicd_nodes_health():
    health = {"master": True}
    for w in _config.workers:
        addr = w["addr"]
        try:
            r = _worker_session.get(f"http://{addr}/status", timeout=2)
            health[addr] = r.status_code == 200
        except Exception:
            health[addr] = False
    return jsonify({"health": health})


@cicd_bp.route("/cicd/settings", methods=["GET"])
def cicd_get_settings():
    setting = _get_user_settings()
    return jsonify({"setting": setting})


@cicd_bp.route("/cicd/settings", methods=["POST"])
def cicd_save_settings():
    req = request.get_json(force=True)
    setting = req.get("setting", {})
    _save_user_settings(setting)
    return jsonify({"status": "ok"})


@cicd_bp.route("/cicd/settings/ssh-servers", methods=["GET"])
def cicd_get_ssh_servers():
    setting = _get_user_settings()
    servers = setting.get("ssh_servers", [])
    return jsonify({"ssh_servers": servers})


@cicd_bp.route("/cicd/settings/test-ssh", methods=["POST"])
def cicd_test_ssh():
    try:
        import paramiko
    except ImportError:
        return jsonify({"error": "paramiko not installed"}), 500

    req = request.get_json(force=True)
    hostname = req.get("hostname", "")
    port = int(req.get("port", 22))
    username = req.get("username", "")

    setting = _get_user_settings()
    ssh_key = setting.get("ssh_key", {})
    key_path = ssh_key.get("path_to_key", "")
    key_content = ssh_key.get("key_content", "")
    passphrase = ssh_key.get("passphrase", "")

    try:
        import io as _io
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        connect_kwargs = {"hostname": hostname, "port": port, "username": username, "timeout": 10}
        if key_content:
            key_file = _io.StringIO(key_content)
            pkey = None
            key_classes = [paramiko.RSAKey, paramiko.Ed25519Key, paramiko.ECDSAKey]
            if hasattr(paramiko, 'DSSKey'):
                key_classes.append(paramiko.DSSKey)
            for key_class in key_classes:
                try:
                    key_file.seek(0)
                    pkey = key_class.from_private_key(key_file, password=passphrase or None)
                    break
                except Exception:
                    continue
            if pkey:
                connect_kwargs["pkey"] = pkey
            else:
                return jsonify({"error": "Failed to parse SSH private key content"}), 400
        elif key_path and os.path.isfile(key_path):
            connect_kwargs["key_filename"] = key_path
            if passphrase:
                connect_kwargs["passphrase"] = passphrase
        client.connect(**connect_kwargs)
        client.close()
        return jsonify({"message": f"Successfully connected to {hostname}:{port}"})
    except Exception as exc:
        return jsonify({"error": f"Connection failed: {str(exc)}"}), 400
