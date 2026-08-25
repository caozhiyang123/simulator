"""Master Flask 主应用与路由。

提供 Web 控制面板、批量/单独启动模拟、进度查询、
Worker 动态管理、配置修改、文件同步等 HTTP 端点。
"""

import logging
import math
import os
import sys
import threading
import time
import uuid

# PyInstaller support: resolve templates/static paths
if getattr(sys, 'frozen', False):
    _base_dir = os.path.dirname(sys.executable)
    _bundle_dir = sys._MEIPASS
    sys.path.insert(0, _bundle_dir)
else:
    _base_dir = os.path.dirname(__file__)
    _bundle_dir = os.path.dirname(__file__)

import requests as http_requests
from flask import Flask, jsonify, render_template, request, session, redirect

from config import ClusterConfig, WorkerExistsError, WorkerNotFoundError
from file_sync import FileSync
from history_store import HistoryStore
from merger import ResultMerger
from poller import ProgressPoller
from progress_store import ProgressStore
from simulator_runner import SimulatorRunner
from task_splitter import TaskSplitter

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
CONFIG_PATH = os.environ.get("CONFIG_PATH", os.path.join(_base_dir, "config.json"))
MACHINE_DATA_DIR = os.path.join(_bundle_dir, "data", "machine")
DYNAMIC_START_MODULES_PATH = os.path.join(
    _base_dir, "out", "batch_start", "dynamic_create_batch_start.json"
)

# Read port from config.json, fallback to env var, then default 5000
import json as _json
_raw_config = {}
if os.path.isfile(CONFIG_PATH):
    with open(CONFIG_PATH, "r", encoding="utf-8") as _cf:
        _raw_config = _json.load(_cf)
PORT = int(os.environ.get("MASTER_PORT", _raw_config.get("port", 5000)))

# ---------------------------------------------------------------------------
# HTTP session used for all master<->worker/launcher calls.
#
# Some LAN setups have a misconfigured system/environment HTTP(S) proxy
# (common on corporate machines) that causes `requests` to route internal
# worker calls through the proxy, which then fails to reach the worker's
# private IP -- surfacing as "Cannot connect to worker ... Is it running?"
# even though telnet/curl to the worker succeed directly.
#
# If your workers are also reachable only through a proxy (e.g. workers on
# a public/external IP behind a corporate proxy), set
# "worker_bypass_proxy": false in config.json to keep using the system/
# environment proxy settings for these calls. Defaults to true (bypass),
# which is the right choice when master and workers share a LAN.
_worker_bypass_proxy = _raw_config.get("worker_bypass_proxy", True)
_worker_session = http_requests.Session()
_worker_session.trust_env = not _worker_bypass_proxy

# ---------------------------------------------------------------------------
# Application & component initialisation
# ---------------------------------------------------------------------------
app = Flask(__name__,
            template_folder=os.path.join(_bundle_dir, 'templates'),
            static_folder=os.path.join(_bundle_dir, 'static'))
app.secret_key = os.environ.get("SECRET_KEY", "simulator-cluster-secret-2026")

# Static files cache: 10 seconds (short cache for development, bump version param on script tags for immediate updates)
app.config['SEND_FILE_MAX_AGE_DEFAULT'] = 10

config = ClusterConfig(CONFIG_PATH)
splitter = TaskSplitter()
merger = ResultMerger()
progress_store = ProgressStore(config.progress_save_dir)
history_store = HistoryStore(os.path.join(_base_dir, "out"))
sim_runner = SimulatorRunner(config.simulator_dir, config.production_dir)
file_sync = FileSync(config.simulator_dir, "")
poller = ProgressPoller(
    interval=config.get_poll_interval(),
    master_status_fn=sim_runner.get_status,
    progress_store=progress_store,
    session=_worker_session,
    enable_poll_log=config.enable_poller_log,
)

_dynamic_start_modules_lock = threading.Lock()


def _positive_int(value, field_name: str) -> int:
    """Validate a positive integer while rejecting booleans."""
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise ValueError(f"{field_name} must be a positive integer")
    return value


def _boolean_value(value, field_name: str) -> bool:
    """Validate a strict JSON boolean without truthy coercion."""
    if not isinstance(value, bool):
        raise ValueError(f"{field_name} must be a boolean")
    return value


def _bounded_string(value, field_name: str, max_length: int, *, required: bool = False) -> str:
    """Validate and normalize a bounded string field."""
    if not isinstance(value, str):
        raise ValueError(f"{field_name} must be a string")
    value = value.strip()
    if required and not value:
        raise ValueError(f"{field_name} is required")
    if len(value) > max_length:
        raise ValueError(f"{field_name} is too long")
    return value


def _sanitize_dynamic_start_modules(payload) -> dict:
    """Validate dynamic Batch/Single Start configuration for persistence."""
    if not isinstance(payload, dict):
        raise ValueError("payload must be an object")
    if payload.get("version", 1) != 1:
        raise ValueError("unsupported version")

    modules = payload.get("modules", [])
    if not isinstance(modules, list):
        raise ValueError("modules must be an array")
    if len(modules) > 100:
        raise ValueError("at most 100 modules are allowed")

    clean_modules = []
    seen_ids = set()
    for index, raw in enumerate(modules):
        if not isinstance(raw, dict):
            raise ValueError(f"modules[{index}] must be an object")

        module_id = _bounded_string(raw.get("id", ""), f"modules[{index}].id", 128, required=True)
        if module_id in seen_ids:
            raise ValueError(f"duplicate module id: {module_id}")
        seen_ids.add(module_id)

        # Old persisted records did not contain pair_id.  Treat their id as
        # the pair id so clients can migrate them without losing data.
        pair_id = _bounded_string(raw.get("pair_id", module_id), f"modules[{index}].pair_id", 128, required=True)
        module_type = raw.get("type")
        if module_type not in ("batch", "single"):
            raise ValueError(f"modules[{index}].type must be batch or single")
        sim_type = raw.get("sim_type", "production")
        if sim_type not in ("production", "test"):
            raise ValueError(f"modules[{index}].sim_type must be production or test")

        clean = {
            "id": module_id,
            "pair_id": pair_id,
            "type": module_type,
            "sim_type": sim_type,
            "game_name": _bounded_string(raw.get("game_name", ""), f"modules[{index}].game_name", 256),
            "override_spin_settings": _boolean_value(
                raw.get("override_spin_settings", False),
                f"modules[{index}].override_spin_settings",
            ),
            "interval_count": _positive_int(raw.get("interval_count"), f"modules[{index}].interval_count"),
        }
        if module_type == "batch":
            clean["total_spins"] = _positive_int(raw.get("total_spins"), f"modules[{index}].total_spins")
            selected_nodes = raw.get("selected_nodes", [])
            if not isinstance(selected_nodes, list) or len(selected_nodes) > 100:
                raise ValueError(f"modules[{index}].selected_nodes must be an array with at most 100 entries")
            clean["selected_nodes"] = [
                _bounded_string(addr, f"modules[{index}].selected_nodes", 256, required=True)
                for addr in selected_nodes
            ]
        else:
            clean["spins"] = _positive_int(raw.get("spins"), f"modules[{index}].spins")
            clean["selected_node"] = _bounded_string(
                raw.get("selected_node", ""), f"modules[{index}].selected_node", 256
            )
        clean_modules.append(clean)

    return {"version": 1, "modules": clean_modules}


def _write_dynamic_start_modules(payload: dict) -> None:
    """Atomically replace the dynamic module JSON file. Caller holds lock."""
    directory = os.path.dirname(DYNAMIC_START_MODULES_PATH)
    os.makedirs(directory, exist_ok=True)
    temp_path = f"{DYNAMIC_START_MODULES_PATH}.{uuid.uuid4().hex}.tmp"
    try:
        with open(temp_path, "w", encoding="utf-8") as stream:
            _json.dump(payload, stream, ensure_ascii=False, indent=2)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp_path, DYNAMIC_START_MODULES_PATH)
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)


def _load_dynamic_start_modules() -> dict:
    """Load and validate persisted dynamic modules, creating an empty file."""
    with _dynamic_start_modules_lock:
        if not os.path.isfile(DYNAMIC_START_MODULES_PATH):
            payload = {"version": 1, "modules": []}
            _write_dynamic_start_modules(payload)
            return payload
        with open(DYNAMIC_START_MODULES_PATH, "r", encoding="utf-8") as stream:
            raw_payload = _json.load(stream)
        clean_payload = _sanitize_dynamic_start_modules(raw_payload)
        if clean_payload != raw_payload:
            _write_dynamic_start_modules(clean_payload)
        return clean_payload


def _save_dynamic_start_modules(payload) -> dict:
    """Validate and atomically persist dynamic module configuration."""
    clean_payload = _sanitize_dynamic_start_modules(payload)
    with _dynamic_start_modules_lock:
        _write_dynamic_start_modules(clean_payload)
    return clean_payload


# ---------------------------------------------------------------------------
# Retry helper
# ---------------------------------------------------------------------------
MAX_RETRIES = 3
RETRY_INTERVAL = 5  # seconds
_last_saved_status = "idle"
_has_been_running = False
_saved_model_keys: set = set()

# Minimum seconds between incremental history saves while a simulation is
# running. Previously history_store.save_current() was only invoked when a
# *new* model key first appeared, so an already-running model's progress
# (e.g. spin_count climbing from 100,000 to 400,000) was never re-saved --
# History would show a stale snapshot from whenever that model was first
# seen, not the latest data shown live in Status & Results. Throttling by
# time (rather than saving on every /status poll) keeps History reasonably
# fresh without adding disk I/O on every 2s poll tick over a many-hour run.
HISTORY_SAVE_INTERVAL = 10  # seconds
_last_history_save_time = 0.0


def start_worker_with_retry(
    worker_addr: str,
    spins: int,
    job_id: str,
    game_name: str = "",
    interval_count: int | None = None,
    sim_type: str = "production",
    override_spin_settings: bool = True,
) -> dict:
    """Send POST /start to a worker with retry logic.

    Returns dict with keys: node, success, retries, error (optional).
    """
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            response = _worker_session.post(
                f"http://{worker_addr}/start",
                json={
                    "spins": spins,
                    "job_id": job_id,
                    "game_name": game_name,
                    "interval_count": interval_count,
                    "sim_type": sim_type,
                    "override_spin_settings": override_spin_settings,
                },
                timeout=10,
            )
            if response.status_code == 200:
                return {
                    "node": worker_addr,
                    "success": True,
                    "retries": attempt - 1,
                }
            if response.status_code == 409:
                detail = response.json() if response.text else {}
                return {
                    "node": worker_addr,
                    "success": False,
                    "retries": attempt - 1,
                    "error": "Task already running on worker"
                    + (f" (job: {detail['job_id']})" if detail.get("job_id") else "")
                    + ", stop it first",
                }
        except http_requests.RequestException as exc:
            if attempt < MAX_RETRIES:
                time.sleep(RETRY_INTERVAL)
            else:
                return {
                    "node": worker_addr,
                    "success": False,
                    "retries": attempt,
                    "error": str(exc),
                }
    return {
        "node": worker_addr,
        "success": False,
        "retries": MAX_RETRIES,
        "error": "Max retries exceeded",
    }


# ---------------------------------------------------------------------------
# Auth helpers
# ---------------------------------------------------------------------------
import hashlib
import json as json_module

USERS_PATH = os.path.join(_base_dir, "iam", "users.json")

# Active sessions: {username: session_token} - only one active session per user
_active_sessions: dict[str, str] = {}


def _load_users():
    if not os.path.isfile(USERS_PATH):
        return []
    with open(USERS_PATH, "r", encoding="utf-8") as f:
        return json_module.load(f)


def _save_users(users):
    with open(USERS_PATH, "w", encoding="utf-8") as f:
        json_module.dump(users, f, ensure_ascii=False, indent=2)


def _md5(text):
    return hashlib.md5(text.encode()).hexdigest()


@app.before_request
def require_login():
    """Require login for all routes except auth and static."""
    allowed_prefixes = ('/auth/', '/static/', '/login')
    if any(request.path.startswith(p) for p in allowed_prefixes):
        return
    if not session.get('logged_in'):
        return redirect('/login')
    # Check if this session is still the active one (single device enforcement)
    username = session.get('username')
    token = session.get('token')
    if username and token and _active_sessions.get(username) != token:
        # Another device logged in with this account
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
            # Generate unique session token
            token = str(uuid.uuid4())
            _active_sessions[username] = token
            session['logged_in'] = True
            session['username'] = username
            session['role'] = u.get("role", "worker")
            session['token'] = token
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
            # Support multiple authorities (comma-separated), compute union
            authority_names = [a.strip() for a in authority_str.split(",") if a.strip()]
            menus_set = set()
            for auth_name in authority_names:
                for a in authorities:
                    if a["authority"] == auth_name:
                        menus_set.update(a.get("menus", []))
                        break
            all_menus_order = ["Home", "Workers", "Config", "History", "MD5", "SHA1", "Plugin", "CICD", "Play", "IAM", "Family"]
            menus = [m for m in all_menus_order if m in menus_set]
            for m in menus_set:
                if m not in menus:
                    menus.append(m)
            return jsonify({"status": "ok", "username": username, "role": role, "menus": menus})
    return jsonify({"error": "Invalid username or password"}), 401


@app.route("/auth/register", methods=["POST"])
def auth_register():
    data = request.get_json(force=True)
    admin_user = data.get("admin_username", "")
    admin_pass = data.get("admin_password", "")
    new_user = data.get("username", "")
    new_pass = data.get("password", "")

    users = _load_users()
    # Verify admin credentials
    admin_ok = False
    for u in users:
        if u["username"] == admin_user and u["password"] == _md5(admin_pass) and u["role"] == "admin":
            admin_ok = True
            break
    if not admin_ok:
        return jsonify({"error": "Admin authentication failed"}), 403

    # Check if user exists
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


@app.route("/auth/logout", methods=["POST"])
def auth_logout():
    session.clear()
    return jsonify({"status": "ok"})


@app.route("/auth/me", methods=["GET"])
def auth_me():
    """Return current logged-in user info."""
    if session.get('logged_in'):
        username = session.get('username')
        token = session.get('token')
        # Check if session was kicked by another login
        if username and token and _active_sessions.get(username) != token:
            session.clear()
            return jsonify({"error": "Session expired (logged in elsewhere)"}), 401
        return jsonify({"username": username, "role": session.get('role')})
    return jsonify({"error": "not logged in"}), 401


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.route("/")
def index():
    """Web 控制面板首页。"""
    return render_template("index.html")


@app.route("/games", methods=["GET"])
def list_games():
    """List games from JSON filenames in ``data/machine``.

    JSON contents are intentionally not opened or parsed.  For example,
    ``BingoSeven.json`` is exposed as ``BingoSeven``.
    """
    if not os.path.isdir(MACHINE_DATA_DIR):
        return jsonify({"games": []})

    try:
        with os.scandir(MACHINE_DATA_DIR) as entries:
            games = [
                os.path.splitext(entry.name)[0]
                for entry in entries
                if entry.is_file() and entry.name.lower().endswith(".json")
            ]
    except OSError as exc:
        logger.warning("Unable to scan machine data directory %s: %s", MACHINE_DATA_DIR, exc)
        return jsonify({"games": []})

    return jsonify({"games": sorted(games, key=str.casefold)})


@app.route("/start", methods=["POST"])
def start():
    """批量启动分布式模拟。

    请求体: {"total_spins": int, "mode"?: "vcpu"|"percentage", "game_name": str, "selected_nodes"?: [str]}
    """
    data = request.get_json(force=True)
    total_spins = data.get("total_spins")
    mode = data.get("mode", config.get_allocation_mode())
    game_name = data.get("game_name", "")
    interval_count = data.get("interval_count")
    sim_type = data.get("sim_type", "production")
    selected_nodes = data.get("selected_nodes")  # None means all
    try:
        override_spin_settings = _boolean_value(
            data.get("override_spin_settings", True), "override_spin_settings"
        )
    except ValueError as exc:
        return jsonify({"status": "error", "error": str(exc)}), 400

    if not game_name:
        return jsonify({"status": "error", "error": "game_name is required"}), 400

    nodes = config.get_nodes()

    # 如果指定了 selected_nodes，只对选中的节点进行分片和启动
    if selected_nodes:
        nodes = [n for n in nodes if n["addr"] in selected_nodes]
        if not nodes:
            return jsonify({"status": "error", "error": "No valid nodes selected"}), 400

    job_id = str(uuid.uuid4())

    # Task splitting
    try:
        if mode == "percentage":
            allocation = splitter.split_percentage(total_spins, nodes)
        else:
            allocation = splitter.split_vcpu(total_spins, nodes)
    except ValueError as exc:
        return jsonify({"status": "error", "error": str(exc)}), 400

    # Round up each node's spins to be a multiple of intervalCount
    # (simulator only runs full intervals)
    if interval_count and interval_count > 0:
        for addr in allocation:
            raw = allocation[addr]
            if raw > 0:
                allocation[addr] = math.ceil(raw / interval_count) * interval_count

    results = []

    # Start master local simulator (only if selected)
    master_spins = allocation.get("master", 0)
    if master_spins > 0:
        try:
            started = sim_runner.start(
                master_spins,
                job_id,
                game_name,
                interval_count,
                sim_type,
                override_spin_settings,
            )
            results.append({
                "node": "master",
                "success": started,
                "retries": 0,
            })
        except RuntimeError as exc:
            results.append({
                "node": "master",
                "success": False,
                "retries": 0,
                "error": str(exc),
            })

    # Start workers with retry (only selected ones)
    worker_addrs = [n["addr"] for n in nodes if n["addr"] != "master"]
    for addr in worker_addrs:
        spins = allocation.get(addr, 0)
        if spins > 0:
            result = start_worker_with_retry(
                addr,
                spins,
                job_id,
                game_name,
                interval_count,
                sim_type,
                override_spin_settings,
            )
            results.append(result)

    # Start poller
    poller.start(worker_addrs)

    all_ok = all(r.get("success") for r in results)
    if all_ok:
        global _has_been_running
        _has_been_running = True
    return jsonify({
        "status": "success" if all_ok else "partial_failure",
        "job_id": job_id,
        "results": results,
    })


@app.route("/status", methods=["GET"])
def status():
    """获取汇总进度/结果，实时按 model 跨节点汇总，保留历史快照。"""
    snapshot = poller.get_snapshot()
    nodes_data = snapshot.get("nodes", {})

    # If poller hasn't collected yet, get master status directly
    if not nodes_data:
        nodes_data = {"master(local)": sim_runner.get_status()}

    statuses = []
    nodes_info = []
    # {model_name: [{"latest": {...}, "history": [...]} from each node]}
    all_model_results: dict[str, list[dict]] = {}

    for name, info in nodes_data.items():
        node_status = info.get("status", "idle")
        statuses.append(node_status)

        if name.startswith("master"):
            addr = "master"
        else:
            addr = name.replace("worker(", "").rstrip(")")

        nodes_info.append({
            "addr": addr,
            "name": name,
            "status": node_status,
            "progress": info.get("progress"),
            "models_completed": info.get("models_completed", 0),
            "models_total": info.get("models_total", 0),
        })

        model_results = info.get("model_results", {})
        for model_name, model_data in model_results.items():
            if model_name not in all_model_results:
                all_model_results[model_name] = []
            all_model_results[model_name].append(model_data)

    # Determine overall status
    if all(s == "completed" for s in statuses) and statuses:
        overall_status = "completed"
    elif any(s == "error" for s in statuses):
        overall_status = "partial_error"
    elif any(s == "running" for s in statuses):
        overall_status = "running"
    else:
        overall_status = "idle"

    # Aggregate per-model across nodes (latest + cumulative history)
    aggregated_models = {}
    for model_name, node_data_list in all_model_results.items():
        # Aggregate latest values
        agg_latest = {
            "spin_count": 0, "total_won": 0, "base_won": 0,
            "base_spent": 0, "eb_won": 0, "eb_spent": 0, "total_spent": 0,
            "node_count": len(node_data_list),
        }

        for nd in node_data_list:
            latest = nd.get("latest", {}) if isinstance(nd, dict) and "latest" in nd else nd
            for field in ["spin_count", "total_won", "base_won", "base_spent", "eb_won", "eb_spent", "total_spent"]:
                agg_latest[field] += latest.get(field, 0)

        # Calculate RTP for latest
        agg_latest["total_rtp"] = agg_latest["total_won"] / agg_latest["total_spent"] if agg_latest["total_spent"] > 0 else 0
        agg_latest["base_rtp"] = agg_latest["base_won"] / agg_latest["base_spent"] if agg_latest["base_spent"] > 0 else 0
        agg_latest["eb_rtp"] = agg_latest["eb_won"] / agg_latest["eb_spent"] if agg_latest["eb_spent"] > 0 else 0

        # Build cumulative history:
        # Collect all history snapshots from all nodes, tagged with node index
        # Then replay in order of spin_count, accumulating each node's latest
        all_events = []  # [(spin_count, node_idx, snapshot)]
        node_latest_at = []  # per-node: latest snapshot seen so far

        for ni, nd in enumerate(node_data_list):
            history = nd.get("history", []) if isinstance(nd, dict) and "history" in nd else []
            node_latest_at.append({})
            for snap in history:
                sc = snap.get("spin_count", 0)
                all_events.append((sc, ni, snap))

        # Sort by spin_count, then by node index for stability
        all_events.sort(key=lambda x: (x[0], x[1]))

        # Replay: for each event, update that node's latest, then sum all nodes
        history_list = []
        seen_totals = set()
        for sc, ni, snap in all_events:
            node_latest_at[ni] = snap
            # Sum all nodes' current latest
            agg = {
                "spin_count": 0, "total_won": 0, "base_won": 0,
                "base_spent": 0, "eb_won": 0, "eb_spent": 0, "total_spent": 0,
            }
            for nl in node_latest_at:
                for field in ["spin_count", "total_won", "base_won", "base_spent", "eb_won", "eb_spent", "total_spent"]:
                    agg[field] += nl.get(field, 0)
            # Deduplicate by total spin_count
            total_sc = agg["spin_count"]
            if total_sc in seen_totals:
                # Update the last entry with same total
                if history_list and history_list[-1]["spin_count"] == total_sc:
                    history_list[-1] = agg
                continue
            seen_totals.add(total_sc)
            agg["total_rtp"] = agg["total_won"] / agg["total_spent"] if agg["total_spent"] > 0 else 0
            agg["base_rtp"] = agg["base_won"] / agg["base_spent"] if agg["base_spent"] > 0 else 0
            agg["eb_rtp"] = agg["eb_won"] / agg["eb_spent"] if agg["eb_spent"] > 0 else 0
            history_list.append(agg)

        # If latest has newer data than last history entry, append it
        if history_list:
            last_hist_sc = history_list[-1].get("spin_count", 0)
            latest_sc = agg_latest.get("spin_count", 0)
            if latest_sc > last_hist_sc:
                history_list.append({
                    "spin_count": latest_sc,
                    "total_won": agg_latest["total_won"],
                    "base_won": agg_latest["base_won"],
                    "base_spent": agg_latest["base_spent"],
                    "eb_won": agg_latest["eb_won"],
                    "eb_spent": agg_latest["eb_spent"],
                    "total_spent": agg_latest["total_spent"],
                    "total_rtp": agg_latest["total_rtp"],
                    "base_rtp": agg_latest["base_rtp"],
                    "eb_rtp": agg_latest["eb_rtp"],
                })

        aggregated_models[model_name] = {
            "latest": agg_latest,
            "history": history_list,
        }

    response: dict = {
        "overall_status": overall_status,
        "nodes": nodes_info,
        "model_results": aggregated_models,
    }

    # Persist results incrementally so History reflects the latest progress,
    # not just whatever was on disk the first time each model appeared.
    global _last_saved_status, _has_been_running, _saved_model_keys
    global _last_history_save_time
    if overall_status == "running":
        _has_been_running = True

    if aggregated_models and _has_been_running:
        current_keys = set(aggregated_models.keys())
        new_keys = current_keys - _saved_model_keys
        now = time.time()
        due_for_refresh = (
            now - _last_history_save_time >= HISTORY_SAVE_INTERVAL
        )
        # Save when a new model first appears (so it's captured right
        # away) OR periodically while running (so spin_count/RTP progress
        # on already-tracked models is kept up to date on disk).
        if new_keys or due_for_refresh:
            try:
                history_store.save_current(aggregated_models)
                _saved_model_keys = current_keys.copy()
                _last_history_save_time = now
            except Exception:
                pass

    # On transition to stopped/completed/idle: write one final snapshot
    # with the latest aggregated_models (the run may have stopped between
    # two periodic saves, e.g. user hit Stop right after a save), then
    # reset tracking for the next run.
    if overall_status in ("completed", "stopped", "idle") and _last_saved_status == "running":
        if aggregated_models:
            try:
                history_store.save_current(aggregated_models)
            except Exception:
                pass
        _has_been_running = False
        _saved_model_keys = set()
        _last_history_save_time = 0.0
        history_store.finalize_current()

    _last_saved_status = overall_status

    return jsonify(response)


@app.route("/start-master", methods=["POST"])
def start_master():
    """单独启动 Master 本地模拟器。

    请求体: {"spins": int, "game_name": str}
    """
    data = request.get_json(force=True)
    spins = data.get("spins")
    game_name = data.get("game_name", "")
    interval_count = data.get("interval_count")
    sim_type = data.get("sim_type", "production")
    try:
        override_spin_settings = _boolean_value(
            data.get("override_spin_settings", True), "override_spin_settings"
        )
    except ValueError as exc:
        return jsonify({"status": "error", "message": str(exc)}), 400
    job_id = str(uuid.uuid4())

    if not game_name:
        return jsonify({"status": "error", "message": "game_name is required"}), 400

    try:
        started = sim_runner.start(
            spins,
            job_id,
            game_name,
            interval_count,
            sim_type,
            override_spin_settings,
        )
    except RuntimeError as exc:
        return jsonify({"status": "error", "message": str(exc)}), 500

    if not started:
        return jsonify({
            "status": "error",
            "message": "Master simulator already running",
        }), 409

    # Ensure poller is running to collect status
    poller.start([w["addr"] for w in config.workers])

    global _has_been_running
    _has_been_running = True

    return jsonify({
        "status": "started",
        "message": f"Master simulator started with {spins} spins",
    })


@app.route("/start-worker", methods=["POST"])
def start_worker():
    """单独启动指定 Worker。

    请求体: {"worker_addr": "ip:port", "spins": int, "game_name": str}
    Worker 不在列表返回 404。
    """
    data = request.get_json(force=True)
    worker_addr = data.get("worker_addr")
    spins = data.get("spins")
    game_name = data.get("game_name", "")
    interval_count = data.get("interval_count")
    sim_type = data.get("sim_type", "production")
    try:
        override_spin_settings = _boolean_value(
            data.get("override_spin_settings", True), "override_spin_settings"
        )
    except ValueError as exc:
        return jsonify({"status": "error", "error": str(exc)}), 400
    job_id = str(uuid.uuid4())

    # Check worker exists in config
    known_addrs = [w["addr"] for w in config.workers]
    if worker_addr not in known_addrs:
        return jsonify({
            "error": "Worker not found",
            "addr": worker_addr,
        }), 404

    result = start_worker_with_retry(
        worker_addr,
        spins,
        job_id,
        game_name,
        interval_count,
        sim_type,
        override_spin_settings,
    )

    # Ensure poller is running to collect status
    poller.start([w["addr"] for w in config.workers])

    return jsonify({"status": "ok" if result["success"] else "error", "message": result})


@app.route("/stop-master", methods=["POST"])
def stop_master():
    """停止 Master 本地模拟器。"""
    stopped = sim_runner.stop()
    if stopped:
        return jsonify({"status": "stopped", "message": "Master simulator stopped"})
    return jsonify({"status": "error", "message": "No running task to stop"}), 400


@app.route("/clear-results", methods=["POST"])
def clear_results():
    """清除当前 Per-Model Results 记录。"""
    global _last_saved_status, _has_been_running
    sim_runner.clear_results()
    poller.clear_snapshot()
    _last_saved_status = "idle"
    _has_been_running = False
    _saved_model_keys = set()
    history_store.finalize_current()
    return jsonify({"status": "ok", "message": "Results cleared"})


@app.route("/stop-worker", methods=["POST"])
def stop_worker():
    """停止指定 Worker 的模拟器。

    请求体: {"worker_addr": "ip:port"}
    """
    data = request.get_json(force=True)
    worker_addr = data.get("worker_addr")

    known_addrs = [w["addr"] for w in config.workers]
    if worker_addr not in known_addrs:
        return jsonify({"error": "Worker not found", "addr": worker_addr}), 404

    try:
        r = _worker_session.post(f"http://{worker_addr}/stop", timeout=10)
        return jsonify(r.json()), r.status_code
    except http_requests.RequestException as exc:
        return jsonify({"status": "error", "message": str(exc)}), 500


@app.route("/logs/worker", methods=["GET"])
def worker_logs():
    """获取指定 Worker 的模拟器日志。

    查询参数: ?addr=ip:port&since=0
    """
    addr = request.args.get("addr", "")
    since = request.args.get("since", 0, type=int)

    if not addr:
        return jsonify({"error": "addr is required"}), 400

    try:
        r = _worker_session.get(f"http://{addr}/logs", params={"since": since}, timeout=5)
        return jsonify(r.json())
    except http_requests.RequestException as exc:
        return jsonify({"lines": [f"[ERROR] 无法连接 {addr}: {exc}"], "total": 0})


@app.route("/add_worker", methods=["POST"])
def add_worker():
    """新增 Worker 节点。

    请求体: {"addr": "ip:port", "vcpu"?: int}
    """
    data = request.get_json(force=True)
    addr = data.get("addr")
    vcpu = data.get("vcpu", 1)
    alias = data.get("alias", "")

    try:
        nodes = config.add_worker(addr, vcpu, alias)
    except WorkerExistsError as exc:
        return jsonify({"error": str(exc), "addr": addr}), exc.status_code

    return jsonify({"workers": nodes})


@app.route("/edit_worker", methods=["POST"])
def edit_worker():
    """Edit an existing Worker node.

    Request body: {"old_addr": "ip:port", "addr": "ip:port", "vcpu": int, "alias": str}
    """
    data = request.get_json(force=True)
    old_addr = data.get("old_addr", "")
    new_addr = data.get("addr", "")
    vcpu = data.get("vcpu", 1)
    alias = data.get("alias", "")

    if not old_addr:
        return jsonify({"error": "old_addr required"}), 400

    # Find and update the worker
    found = False
    for w in config._workers:
        if w["addr"] == old_addr:
            w["addr"] = new_addr or old_addr
            w["vcpu"] = vcpu
            w["alias"] = alias
            found = True
            break

    if not found:
        return jsonify({"error": "Worker not found", "addr": old_addr}), 404

    config._save()
    return jsonify({"workers": config.get_nodes()})


@app.route("/del_worker", methods=["POST"])
def del_worker():
    """删除 Worker 节点。

    请求体: {"addr": "ip:port"}
    """
    data = request.get_json(force=True)
    addr = data.get("addr")

    try:
        nodes = config.remove_worker(addr)
    except WorkerNotFoundError as exc:
        return jsonify({"error": str(exc), "addr": addr}), exc.status_code

    return jsonify({"workers": nodes})


@app.route("/config/poll-interval", methods=["POST"])
def set_poll_interval():
    """修改轮询间隔。

    请求体: {"interval": float}
    """
    data = request.get_json(force=True)
    interval = data.get("interval")
    config.set_poll_interval(interval)
    poller.set_interval(interval)
    return jsonify({"interval": interval})


@app.route("/config/allocation-mode", methods=["POST"])
def set_allocation_mode():
    """切换分配模式。

    请求体: {"mode": "vcpu"|"percentage"}
    """
    data = request.get_json(force=True)
    mode = data.get("mode")
    config.set_allocation_mode(mode)
    return jsonify({"mode": mode})


@app.route("/config/percentages", methods=["POST"])
def set_percentages():
    """设置百分比分配。

    请求体: {"percentages": {"node_addr": float, ...}}
    """
    data = request.get_json(force=True)
    percentages = data.get("percentages", {})
    config.set_percentages(percentages)
    return jsonify({"percentages": percentages})


@app.route("/config/nodes", methods=["GET"])
def get_nodes():
    """获取当前所有节点配置（含 Master）。"""
    return jsonify({
        "nodes": config.get_nodes(),
        "allocation_mode": config.get_allocation_mode(),
        "poll_interval": config.get_poll_interval(),
        "sysinfo_refresh_interval": _raw_config.get("sysinfo_refresh_interval", 5),
        "cpu_healthy_threshold": _raw_config.get("cpu_healthy_threshold", 90),
    })


@app.route("/config/dynamic-start-modules", methods=["GET"])
def get_dynamic_start_modules():
    """Return persisted dynamic Batch/Single Start module pairs."""
    try:
        return jsonify(_load_dynamic_start_modules())
    except (OSError, ValueError, _json.JSONDecodeError) as exc:
        logger.exception("Unable to load dynamic start modules")
        return jsonify({"error": str(exc)}), 500


@app.route("/config/dynamic-start-modules", methods=["PUT"])
def put_dynamic_start_modules():
    """Validate and atomically persist dynamic Start module pairs."""
    try:
        payload = request.get_json(force=True)
        return jsonify(_save_dynamic_start_modules(payload))
    except (ValueError, _json.JSONDecodeError) as exc:
        return jsonify({"error": str(exc)}), 400
    except OSError as exc:
        logger.exception("Unable to save dynamic start modules")
        return jsonify({"error": str(exc)}), 500


@app.route("/config/quick-access-toolbar", methods=["GET"])
def get_quick_access_toolbar():
    """获取 Quick Access Toolbar 配置项。"""
    # Re-read config to pick up any changes
    items = []
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            cfg = _json.load(f)
        items = cfg.get("quick_access_toolbar", [])
    except Exception:
        items = _raw_config.get("quick_access_toolbar", [])
    return jsonify({"items": items})


@app.route("/config/footer-links", methods=["GET"])
def get_footer_links():
    """获取底部友情链接配置。"""
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            cfg = _json.load(f)
        links = cfg.get("footer_links", [])
    except Exception:
        links = _raw_config.get("footer_links", [])
    return jsonify({"links": links})


@app.route("/logs", methods=["GET"])
def logs():
    """获取 Master 本地模拟器的 run.bat 输出日志。

    查询参数: ?since=0 (从第几行开始，用于增量获取)
    """
    since = request.args.get("since", 0, type=int)
    return jsonify(sim_runner.get_logs(since))


@app.route("/poller/log", methods=["GET"])
def poller_log():
    """获取 Master 轮询各 Worker /status 的请求/响应记录。

    用于在 Operation Log 中展示 Master 实际发出的轮询请求与收到的
    原始响应（或错误），便于排查 running->stopped 误判问题是 Worker
    返回了非 running 状态，还是网络请求本身失败/超时。

    查询参数: ?since=0 (从第几条记录开始，用于增量获取)
    """
    since = request.args.get("since", 0, type=int)
    return jsonify(poller.get_poll_log(since))


@app.route("/sync", methods=["POST"])
def sync():
    """执行预处理清理 + 局域网共享目录文件同步到指定或所有 Worker。

    请求体: {"worker_addr"?: "ip:port", "game_name"?: str}
    """
    data = request.get_json(force=True)
    target_addr = data.get("worker_addr")
    game_name = data.get("game_name", "")

    # Pre-processing: clean simulation results
    if game_name:
        game_dir = os.path.join("math", game_name)
        file_sync.clean_simulation_results(game_dir)

    workers = config.workers

    if target_addr:
        # Sync to specific worker
        for w in workers:
            if w["addr"] == target_addr:
                worker = w
                break
        if worker is None:
            return jsonify({
                "error": "Worker not found",
                "addr": target_addr,
            }), 404

        result = file_sync.sync_to_worker(
            worker["addr"],
            worker.get("shared_dir", ""),
            worker.get("username"),
            worker.get("password"),
        )
        if result["success"]:
            return jsonify({"status": "success", "message": f"Synced to {target_addr}"})
        return jsonify({
            "status": "error",
            "message": result.get("error", "Sync failed"),
        }), 500
    else:
        # Sync to all workers
        result = file_sync.sync_to_all_workers(workers)
        all_ok = all(r["success"] for r in result["results"].values())
        return jsonify({
            "status": "success" if all_ok else "partial_failure",
            "message": "Sync completed",
            "details": result["results"],
        })


@app.route("/history/list", methods=["GET"])
def history_list():
    """List all saved simulation runs."""
    return jsonify({"runs": history_store.list_runs()})


@app.route("/history/load", methods=["GET"])
def history_load():
    """Load a specific run's data.

    Query param: ?filename=20260421_120000.json
    """
    filename = request.args.get("filename", "")
    if not filename:
        return jsonify({"error": "filename required"}), 400
    data = history_store.load_run(filename)
    if data is None:
        return jsonify({"error": "not found"}), 404
    return jsonify(data)


@app.route("/history/query", methods=["GET"])
def history_query():
    """Query runs by model name and/or date range.

    Query params: ?model=AmericanChampion&start=2026-04-01&end=2026-04-30
    """
    model_name = request.args.get("model", "")
    start_date = request.args.get("start", "")
    end_date = request.args.get("end", "")
    results = history_store.query(model_name, start_date, end_date)
    return jsonify({"results": results})


@app.route("/history/export", methods=["POST"])
def history_export():
    """Package selected history files as a zip and send to browser.

    Request body: {"filenames": ["file1.json", ...]}
    """
    import io
    import zipfile
    data = request.get_json(force=True)
    filenames = data.get("filenames", [])

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for fname in filenames:
            fpath = os.path.join(history_store._data_dir, fname)
            if os.path.isfile(fpath):
                zf.write(fpath, fname)

    buf.seek(0)
    from flask import send_file
    return send_file(
        buf,
        mimetype="application/zip",
        as_attachment=True,
        download_name="history_export.zip",
    )


@app.route("/history/delete", methods=["POST"])
def history_delete():
    """Delete history files.

    Request body: {"filenames": ["file1.json", "file2.json"]}
    """
    data = request.get_json(force=True)
    filenames = data.get("filenames", [])
    results = []
    for fname in filenames:
        fpath = os.path.join(history_store._data_dir, fname)
        try:
            if os.path.isfile(fpath):
                os.remove(fpath)
                results.append({"filename": fname, "status": "deleted"})
            else:
                results.append({"filename": fname, "status": "not found"})
        except OSError as exc:
            results.append({"filename": fname, "status": "error", "error": str(exc)})
    return jsonify({"results": results})


@app.route("/history/save", methods=["POST"])
def history_save():
    """Manually save current aggregated results to history."""
    # Get current status data
    snapshot = poller.get_snapshot()
    nodes_data = snapshot.get("nodes", {})
    all_model_results: dict[str, list[dict]] = {}
    for name, info in nodes_data.items():
        model_results = info.get("model_results", {})
        for model_name, model_data in model_results.items():
            if model_name not in all_model_results:
                all_model_results[model_name] = []
            all_model_results[model_name].append(model_data)

    if not all_model_results:
        return jsonify({"error": "No data to save"}), 400

    filename = history_store.save_run(all_model_results)
    return jsonify({"status": "saved", "filename": filename})


@app.route("/files/local/browse", methods=["GET"])
def local_browse():
    """Browse local directory contents using absolute paths.

    Query param: ?path=absolute/path (defaults to production_dir)
    Special: ?path=__drives__ lists all drive letters (Windows)
    """
    browse_path = request.args.get("path", "")

    # List all drives
    if browse_path == "__drives__":
        import string
        drives = []
        for letter in string.ascii_uppercase:
            drive = f"{letter}:/"
            if os.path.isdir(drive):
                drives.append({
                    "name": f"{letter}:",
                    "type": "dir",
                    "size": 0,
                    "full_path": drive,
                })
        return jsonify({"path": "My Computer", "parent": "", "entries": drives})

    if not browse_path:
        browse_path = config.production_dir
    if not browse_path:
        return jsonify({"error": "production_dir not configured"}), 400

    full_path = os.path.normpath(browse_path)
    if not os.path.isdir(full_path):
        return jsonify({"error": "Directory not found"}), 404

    parent = os.path.dirname(full_path)
    # If at drive root (e.g. E:\), parent goes to drive list
    if parent == full_path:
        parent = "__drives__"
    else:
        parent = parent.replace("\\", "/")

    entries = []
    for name in sorted(os.listdir(full_path)):
        fp = os.path.join(full_path, name)
        entries.append({
            "name": name,
            "type": "dir" if os.path.isdir(fp) else "file",
            "size": os.path.getsize(fp) if os.path.isfile(fp) else 0,
            "full_path": fp.replace("\\", "/"),
        })

    return jsonify({
        "path": full_path.replace("\\", "/"),
        "parent": parent,
        "entries": entries,
    })


@app.route("/files/local/write", methods=["POST"])
def local_write():
    """Write content to a local file.

    Request body: {"path": "absolute/path", "content": "file content"}
    """
    data = request.get_json(force=True)
    file_path = data.get("path", "")
    content = data.get("content", "")
    full_path = os.path.normpath(file_path)
    try:
        with open(full_path, "w", encoding="utf-8") as f:
            f.write(content)
        return jsonify({"status": "ok", "path": file_path})
    except OSError as exc:
        return jsonify({"error": str(exc)}), 500


@app.route("/files/local/delete", methods=["POST"])
def local_delete():
    """Delete local files or directories.

    Request body: {"paths": ["absolute/path1", "absolute/path2"]}
    """
    import shutil
    data = request.get_json(force=True)
    paths = data.get("paths", [])
    results = []
    for p in paths:
        full = os.path.normpath(p)
        try:
            if os.path.isfile(full):
                os.remove(full)
                results.append({"path": p, "status": "deleted"})
            elif os.path.isdir(full):
                shutil.rmtree(full)
                results.append({"path": p, "status": "deleted"})
            else:
                results.append({"path": p, "status": "not found"})
        except OSError as exc:
            results.append({"path": p, "status": "error", "error": str(exc)})
    return jsonify({"results": results})


@app.route("/files/local/mkdir", methods=["POST"])
def local_mkdir():
    """Create a directory locally.

    Request body: {"path": "absolute/path"}
    """
    data = request.get_json(force=True)
    dir_path = data.get("path", "")
    if not dir_path:
        return jsonify({"error": "path is required"}), 400
    full = os.path.normpath(dir_path)
    try:
        os.makedirs(full, exist_ok=True)
        return jsonify({"status": "ok", "path": full.replace("\\", "/")})
    except OSError as exc:
        return jsonify({"error": str(exc)}), 500


@app.route("/files/local/create", methods=["POST"])
def local_create_file():
    """Create an empty file locally.

    Request body: {"path": "absolute/path", "content": ""}
    """
    data = request.get_json(force=True)
    file_path = data.get("path", "")
    content = data.get("content", "")
    if not file_path:
        return jsonify({"error": "path is required"}), 400
    full = os.path.normpath(file_path)
    try:
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "w", encoding="utf-8") as f:
            f.write(content)
        return jsonify({"status": "ok", "path": full.replace("\\", "/")})
    except OSError as exc:
        return jsonify({"error": str(exc)}), 500


@app.route("/files/local/rename", methods=["POST"])
def local_rename():
    """Rename a local file or directory.

    Request body: {"old_path": "absolute/old", "new_path": "absolute/new"}
    """
    data = request.get_json(force=True)
    old_path = os.path.normpath(data.get("old_path", ""))
    new_path = os.path.normpath(data.get("new_path", ""))
    if not old_path or not new_path:
        return jsonify({"error": "old_path and new_path are required"}), 400
    if not os.path.exists(old_path):
        return jsonify({"error": "Source not found"}), 404
    try:
        os.rename(old_path, new_path)
        return jsonify({"status": "ok", "path": new_path.replace("\\", "/")})
    except OSError as exc:
        return jsonify({"error": str(exc)}), 500


@app.route("/files/local/duplicate", methods=["POST"])
def local_duplicate():
    """Duplicate (copy) a local file or directory.

    Request body: {"source": "absolute/path", "dest": "absolute/new_path"}
    """
    import shutil
    data = request.get_json(force=True)
    source = os.path.normpath(data.get("source", ""))
    dest = os.path.normpath(data.get("dest", ""))
    if not source or not dest:
        return jsonify({"error": "source and dest are required"}), 400
    if not os.path.exists(source):
        return jsonify({"error": "Source not found"}), 404
    try:
        if os.path.isdir(source):
            shutil.copytree(source, dest)
        else:
            shutil.copy2(source, dest)
        return jsonify({"status": "ok", "path": dest.replace("\\", "/")})
    except OSError as exc:
        return jsonify({"error": str(exc)}), 500


@app.route("/files/worker/rename", methods=["POST"])
def worker_rename():
    """Rename a file or directory on a remote worker.

    Request body: {"addr": "ip:port", "old_path": "path", "new_path": "path"}
    """
    data = request.get_json(force=True)
    addr = data.get("addr", "")
    if not addr:
        return jsonify({"error": "addr is required"}), 400
    try:
        r = _worker_session.post(f"http://{addr}/files/rename", json={
            "old_path": data.get("old_path", ""),
            "new_path": data.get("new_path", "")
        }, timeout=10)
        return jsonify(r.json()), r.status_code
    except http_requests.RequestException as exc:
        return jsonify({"error": str(exc)}), 500


@app.route("/files/worker/duplicate", methods=["POST"])
def worker_duplicate():
    """Duplicate a file or directory on a remote worker.

    Request body: {"addr": "ip:port", "source": "path", "dest": "path"}
    """
    data = request.get_json(force=True)
    addr = data.get("addr", "")
    if not addr:
        return jsonify({"error": "addr is required"}), 400
    try:
        r = _worker_session.post(f"http://{addr}/files/duplicate", json={
            "source": data.get("source", ""),
            "dest": data.get("dest", "")
        }, timeout=10)
        return jsonify(r.json()), r.status_code
    except http_requests.RequestException as exc:
        return jsonify({"error": str(exc)}), 500


@app.route("/files/worker/mkdir", methods=["POST"])
def worker_mkdir():
    """Create a directory on a remote worker.

    Request body: {"addr": "ip:port", "path": "absolute/path"}
    """
    data = request.get_json(force=True)
    addr = data.get("addr", "")
    dir_path = data.get("path", "")
    if not addr or not dir_path:
        return jsonify({"error": "addr and path are required"}), 400
    try:
        r = _worker_session.post(f"http://{addr}/files/mkdir", json={"path": dir_path}, timeout=10)
        return jsonify(r.json()), r.status_code
    except http_requests.RequestException as exc:
        return jsonify({"error": str(exc)}), 500


@app.route("/files/worker/create", methods=["POST"])
def worker_create_file():
    """Create an empty file on a remote worker.

    Request body: {"addr": "ip:port", "path": "absolute/path", "content": ""}
    """
    data = request.get_json(force=True)
    addr = data.get("addr", "")
    file_path = data.get("path", "")
    content = data.get("content", "")
    if not addr or not file_path:
        return jsonify({"error": "addr and path are required"}), 400
    try:
        r = _worker_session.post(f"http://{addr}/files/write", json={"path": file_path, "content": content}, timeout=10)
        return jsonify(r.json()), r.status_code
    except http_requests.RequestException as exc:
        return jsonify({"error": str(exc)}), 500


@app.route("/bingo/machines", methods=["GET"])
def bingo_machines():
    """List all saved machine pattern lists."""
    path = os.path.join(_base_dir, "data", "machine", "machine_pattern_list.json")
    if not os.path.isfile(path):
        return jsonify({"machines": []})
    with open(path, "r", encoding="utf-8") as f:
        return jsonify({"machines": json_module.load(f)})


@app.route("/bingo/machines", methods=["POST"])
def bingo_machines_save():
    """Save a new machine pattern list."""
    data = request.get_json(force=True)
    machine_id = data.get("machine_id")
    name = data.get("name", "")
    pattern = data.get("pattern", [])
    if not machine_id or not name:
        return jsonify({"error": "machine_id and name are required"}), 400

    path = os.path.join(_base_dir, "data", "machine", "machine_pattern_list.json")
    machines = []
    if os.path.isfile(path):
        with open(path, "r", encoding="utf-8") as f:
            machines = json_module.load(f)

    # Check duplicate
    for m in machines:
        if m["machine_id"] == machine_id:
            m["name"] = name
            m["pattern"] = pattern
            break
    else:
        machines.append({"machine_id": machine_id, "name": name, "pattern": pattern})

    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json_module.dump(machines, f, ensure_ascii=False, indent=2)
    return jsonify({"status": "ok"})


@app.route("/bingo/machines/special", methods=["POST"])
def bingo_machines_special_save():
    """Save a special pattern list to an existing machine."""
    data = request.get_json(force=True)
    machine_id = data.get("machine_id")
    special_name = data.get("special_name", "")
    special_pattern = data.get("special_pattern", [])
    if not machine_id or not special_name:
        return jsonify({"error": "machine_id and special_name are required"}), 400

    path = os.path.join(_base_dir, "data", "machine", "machine_pattern_list.json")
    machines = []
    if os.path.isfile(path):
        with open(path, "r", encoding="utf-8") as f:
            machines = json_module.load(f)

    found = False
    for m in machines:
        if m["machine_id"] == machine_id:
            m[special_name] = special_pattern
            found = True
            break
    if not found:
        return jsonify({"error": f"Machine {machine_id} not found"}), 404

    with open(path, "w", encoding="utf-8") as f:
        json_module.dump(machines, f, ensure_ascii=False, indent=2)
    return jsonify({"status": "ok"})


@app.route("/bingo/machines/delete", methods=["POST"])
def bingo_machines_delete():
    """Delete a machine from the list."""
    data = request.get_json(force=True)
    machine_id = data.get("machine_id")
    if not machine_id:
        return jsonify({"error": "machine_id is required"}), 400

    path = os.path.join(_base_dir, "data", "machine", "machine_pattern_list.json")
    machines = []
    if os.path.isfile(path):
        with open(path, "r", encoding="utf-8") as f:
            machines = json_module.load(f)

    machines = [m for m in machines if m.get("machine_id") != machine_id]
    with open(path, "w", encoding="utf-8") as f:
        json_module.dump(machines, f, ensure_ascii=False, indent=2)
    return jsonify({"status": "ok"})


@app.route("/bingo/machines/special/delete", methods=["POST"])
def bingo_machines_special_delete():
    """Delete a special pattern from a machine."""
    data = request.get_json(force=True)
    machine_id = data.get("machine_id")
    special_name = data.get("special_name", "")
    if not machine_id or not special_name:
        return jsonify({"error": "machine_id and special_name are required"}), 400

    path = os.path.join(_base_dir, "data", "machine", "machine_pattern_list.json")
    machines = []
    if os.path.isfile(path):
        with open(path, "r", encoding="utf-8") as f:
            machines = json_module.load(f)

    for m in machines:
        if m.get("machine_id") == machine_id:
            if special_name in m:
                del m[special_name]
            break

    with open(path, "w", encoding="utf-8") as f:
        json_module.dump(machines, f, ensure_ascii=False, indent=2)
    return jsonify({"status": "ok"})


@app.route("/bingo/pattern-combination", methods=["POST"])
def bingo_pattern_combination():
    """Generate all valid pattern override combinations from payable list."""
    data = request.get_json(force=True)
    payables = data.get("payables", [])

    if not payables or not isinstance(payables, list):
        return jsonify({"error": "payables must be a non-empty array"}), 400

    # Sort payables by value descending
    payables_sorted = sorted(payables, key=lambda p: p.get("value", 0), reverse=True)

    # Parse formats into integer bitmasks for fast OR/subset operations
    fmt_len = len(payables_sorted[0].get("format", ""))
    for p in payables_sorted:
        fmt = p.get("format", "")
        if len(fmt) != fmt_len:
            return jsonify({"error": f"All formats must have same length. Expected {fmt_len}, got {len(fmt)} for {p.get('alias')}"}), 400
        p["_mask"] = int(fmt, 2)
        p["_required"] = fmt.count("1")

    # Find the bingo pattern (all 1s, type=1)
    bingo_mask = (1 << fmt_len) - 1

    # Generate combinations using iterative approach
    # A valid combination: OR of multiple patterns where the combined format
    # does NOT equal or contain any single pattern with higher value than the combination sum
    results = []

    # First, add each single pattern as a valid combination
    for p in payables_sorted:
        results.append({
            "id": -1,
            "name": p["name"],
            "alias": p["alias"] + ",",
            "format": p["format"],
            "required": str(p["_required"]),
            "value": p["value"],
            "weight": 0.00
        })

    # Now find multi-pattern combinations
    # We need to find sets of patterns where:
    # 1. Their OR doesn't fully contain a higher-value single pattern that isn't part of the set
    # 2. No pattern in the set is a subset of another in the set
    # 3. The combined format is not equal to any single pattern's format
    from itertools import combinations as iter_combinations

    # Build list of non-bingo patterns for combination
    non_bingo = [p for p in payables_sorted if p["_mask"] != bingo_mask]

    # Limit to reasonable depth (2-5 patterns per combo)
    max_depth = min(6, len(non_bingo))

    for size in range(2, max_depth + 1):
        for combo in iter_combinations(range(len(non_bingo)), size):
            patterns = [non_bingo[i] for i in combo]

            # Check no pattern is subset of another in this combo
            masks = [p["_mask"] for p in patterns]
            skip = False
            for i in range(len(masks)):
                for j in range(len(masks)):
                    if i != j and (masks[i] & masks[j]) == masks[i]:
                        skip = True
                        break
                if skip:
                    break
            if skip:
                continue

            # Compute OR of all formats
            combined_mask = 0
            for m in masks:
                combined_mask |= m
            combined_required = bin(combined_mask).count("1")

            # Check if combined equals bingo
            if combined_mask == bingo_mask:
                continue

            # Check: combined format must not fully contain any single pattern
            # with higher value than the sum of this combo
            combo_value = sum(p["value"] for p in patterns)
            is_valid = True
            for p in payables_sorted:
                if p["_mask"] == bingo_mask:
                    continue
                # Skip patterns that are part of this combo
                if p in patterns:
                    continue
                # If combined fully contains this pattern AND this pattern's value >= combo_value
                if (combined_mask & p["_mask"]) == p["_mask"] and p["value"] >= combo_value:
                    is_valid = False
                    break
            if not is_valid:
                continue

            # Check: combined format must not equal any single pattern's format
            is_duplicate = False
            for p in payables_sorted:
                if p["_mask"] == combined_mask:
                    is_duplicate = True
                    break
            if is_duplicate:
                continue

            # Format the combined mask back to string
            combined_fmt = bin(combined_mask)[2:].zfill(fmt_len)

            # Build name and alias
            names = ",".join(p["name"] for p in patterns) + ","
            aliases = ",".join(p["alias"] for p in patterns) + ","

            results.append({
                "id": -1,
                "name": names,
                "alias": aliases,
                "format": combined_fmt,
                "required": str(combined_required),
                "value": combo_value,
                "weight": 0.00
            })

    # Sort by value descending, then by required descending
    results.sort(key=lambda r: (-r["value"], -int(r["required"])))

    # Remove duplicates (same format)
    seen_formats = set()
    unique_results = []
    for r in results:
        if r["format"] not in seen_formats:
            seen_formats.add(r["format"])
            unique_results.append(r)

    return jsonify({"status": "ok", "combinations": {"default": unique_results}, "count": len(unique_results)})


@app.route("/bingo/generate", methods=["POST"])
def bingo_generate():
    """Generate bingo card sets."""
    import random
    data = request.get_json(force=True)
    num_per_card = int(data.get("num_per_card", 0))
    max_cards = int(data.get("max_cards", 0))
    card_size = int(data.get("card_size", 0))
    min_num = int(data.get("min_card_number", 0))
    max_num = int(data.get("max_card_number", 0))
    equal_position = data.get("equal_position", [])

    # Server-side validation
    if num_per_card < 1:
        return jsonify({"error": "num_per_card must be a positive integer"}), 400
    if max_cards < 1:
        return jsonify({"error": "max_cards must be a positive integer"}), 400
    if card_size < 1 or card_size > 10000:
        return jsonify({"error": "card_size must be between 1 and 10000"}), 400
    if min_num < 0:
        return jsonify({"error": "min_card_number must be 0 or greater"}), 400
    if max_num < 1:
        return jsonify({"error": "max_card_number must be a positive integer"}), 400
    if min_num >= max_num:
        return jsonify({"error": "min_card_number must be less than max_card_number"}), 400

    total_pos = num_per_card * max_cards
    numbers = list(range(min_num, max_num + 1))

    # Validate equal_position if provided
    if equal_position:
        if not isinstance(equal_position, list):
            return jsonify({"error": "equal_position must be an array of arrays"}), 400
        for idx, group in enumerate(equal_position):
            if not isinstance(group, list):
                return jsonify({"error": f"equal_position[{idx}] must be an array"}), 400
            for val in group:
                if not isinstance(val, int) or val < 0 or val >= total_pos:
                    return jsonify({"error": f"equal_position[{idx}] contains invalid value {val}, must be in [0, {total_pos - 1}]"}), 400

    total_pos = num_per_card * max_cards
    numbers = list(range(min_num, max_num + 1))

    if not equal_position:
        # Case 1: No equal positions, numbers >= total_pos
        if len(numbers) < total_pos:
            return jsonify({"error": f"Not enough numbers ({len(numbers)}) for {total_pos} positions. Provide equal_position."}), 400
        cards = []
        for i in range(card_size):
            random.shuffle(numbers)
            cards.append(numbers[:total_pos][:])
        return jsonify({"status": "ok", "cards": cards, "card_size": card_size, "positions_per_set": total_pos})
    else:
        # Case 2/3: With equal positions
        # Build position-to-group mapping
        pos_to_group = {}
        for group in equal_position:
            for pos in group:
                pos_to_group[pos] = group

        cards = []
        for i in range(card_size):
            card = [0] * total_pos
            random.shuffle(numbers)
            number_idx = 0
            for j in range(total_pos):
                if card[j] > 0:
                    continue  # Already filled by equal position
                if number_idx >= len(numbers):
                    break
                card[j] = numbers[number_idx]
                # Fill equal positions with same number
                if j in pos_to_group:
                    for eq_pos in pos_to_group[j]:
                        if eq_pos < total_pos and eq_pos != j:
                            card[eq_pos] = numbers[number_idx]
                number_idx += 1
            cards.append(card)
        return jsonify({"status": "ok", "cards": cards, "card_size": card_size, "positions_per_set": total_pos})


def _is_remote_addr(addr):
    """True if addr refers to a remote worker node (not master/local)."""
    return bool(addr) and addr != "master"


def _worker_proxy_post(addr, path, json_body=None, timeout=30, stream=False):
    """POST to a worker's Flask app and return its (data_or_response, status).

    When stream=True, returns the raw requests.Response for streaming binary
    content (e.g. zip download) back to the browser.
    """
    try:
        r = _worker_session.post(f"http://{addr}{path}", json=json_body, timeout=timeout, stream=stream)
        if stream:
            return r, r.status_code
        try:
            return r.json(), r.status_code
        except ValueError:
            return {"error": f"Worker returned non-JSON (status {r.status_code})"}, 500
    except http_requests.RequestException as exc:
        return {"error": str(exc)}, 500


@app.route("/files/batch-delete-file-check", methods=["POST"])
def batch_delete_file_check():
    """Recursively find all files matching a glob/wildcard pattern.

    Request body: {
        "pattern": "CalacaBingo*.txt",
        "target_dirs": ["dir1", "dir2"],
        "exclude_dirs": ["ex1"],
        "addr": "master" | "ip:port"
    }
    """
    import fnmatch
    data = request.get_json(force=True)
    addr = data.get("addr", "master").strip() or "master"
    pattern = data.get("pattern", "").strip()
    target_dirs = data.get("target_dirs", [])
    exclude_dirs = data.get("exclude_dirs", [])

    if not pattern:
        return jsonify({"error": "file pattern is required"}), 400
    if not target_dirs:
        return jsonify({"error": "at least one target directory is required"}), 400

    if _is_remote_addr(addr):
        body, status = _worker_proxy_post(addr, "/files/batch-search", {
            "mode": "glob", "pattern": pattern, "target_dirs": target_dirs, "exclude_dirs": exclude_dirs
        })
        return jsonify(body), status

    # Normalize exclude dirs for comparison
    exclude_normalized = [os.path.normpath(d.strip()).lower() for d in exclude_dirs if d.strip()]

    found = []

    for td in target_dirs:
        td = os.path.normpath(td.strip())
        if not os.path.isdir(td):
            continue
        for root, dirs, files in os.walk(td, followlinks=True):
            # Check if current root is under an excluded directory
            root_norm = os.path.normpath(root).lower()
            skip = False
            for ex in exclude_normalized:
                if root_norm == ex or root_norm.startswith(ex + os.sep):
                    skip = True
                    break
            if skip:
                continue
            for f in files:
                if fnmatch.fnmatch(f, pattern):
                    found.append(os.path.join(root, f).replace("\\", "/"))

    return jsonify({"status": "ok", "found": found, "count": len(found)})


def _batch_check_core(addr, sources, target_dirs, exclude_dirs):
    """Recursively find all files matching the source filename(s), on one node.

    Shared by /files/batch-check (single node) and
    /files/batch-multi-check (multiple nodes, looped by the caller).

    Target Directories may use wildcard (``*``/``?``) patterns (e.g.
    ``E:/.../SimC*/math/Game/configuration``); they are resolved to literal
    existing directories first (see _resolve_glob_dirs_core), which also
    means a directory pattern that only makes sense for a DIFFERENT
    selected node (multi-node panels send one combined target_dirs list
    across all nodes) simply resolves to nothing on this node instead of
    causing a hard error.

    Returns: (body_dict, http_status)
    """
    # Get all filenames to search for. Source files always live on the master
    # (that's where the user picked them from); only the basename is searched
    # for on the target node's filesystem.
    filenames = set()
    for s in sources:
        s = s.strip()
        if s:
            filenames.add(os.path.basename(s))

    if not filenames:
        return {"error": "no valid source files provided"}, 400

    resolved_dirs, err_body, status = _resolve_glob_dirs_core(addr, target_dirs, exclude_dirs)
    if err_body is not None:
        return err_body, status
    if not resolved_dirs:
        return {"status": "ok", "found": [], "count": 0}, 200

    if _is_remote_addr(addr):
        return _worker_proxy_post(addr, "/files/batch-search", {
            "mode": "exact", "names": list(filenames),
            "target_dirs": resolved_dirs, "exclude_dirs": exclude_dirs
        })

    # Normalize exclude dirs for comparison
    exclude_normalized = [os.path.normpath(d.strip()).lower() for d in exclude_dirs if d.strip()]

    found = []

    for td in resolved_dirs:
        td = os.path.normpath(td.strip())
        if not os.path.isdir(td):
            continue
        for root, dirs, files in os.walk(td, followlinks=True):
            # Check if current root is under an excluded directory
            root_norm = os.path.normpath(root).lower()
            skip = False
            for ex in exclude_normalized:
                if root_norm == ex or root_norm.startswith(ex + os.sep):
                    skip = True
                    break
            if skip:
                continue
            for f in files:
                if f in filenames:
                    found.append(os.path.join(root, f).replace("\\", "/"))

    return {"status": "ok", "found": found, "count": len(found)}, 200


@app.route("/files/batch-check", methods=["POST"])
def batch_check():
    """Recursively find all files matching the source filename(s).

    Request body: {
        "sources": ["path1", "path2"],  // multiple sources (new)
        "source": "path",               // single source (backward compat)
        "target_dirs": ["dir1", "dir2"],
        "exclude_dirs": ["ex1"],
        "addr": "master" | "ip:port"
    }
    """
    data = request.get_json(force=True)
    addr = data.get("addr", "master").strip() or "master"
    sources = data.get("sources", [])
    source = data.get("source", "").strip()
    target_dirs = data.get("target_dirs", [])
    exclude_dirs = data.get("exclude_dirs", [])
    # Backward compat: support single source
    if not sources and source:
        sources = [source]
    # Backward compat: support single target_dir
    if not target_dirs and data.get("target_dir"):
        target_dirs = [data.get("target_dir", "").strip()]

    if not sources:
        return jsonify({"error": "source file path is required"}), 400
    if not target_dirs:
        return jsonify({"error": "at least one target directory is required"}), 400

    body, status = _batch_check_core(addr, sources, target_dirs, exclude_dirs)
    return jsonify(body), status


@app.route("/files/batch-multi-check", methods=["POST"])
def batch_multi_check():
    """Recursively find all files matching the source filename(s), across MULTIPLE nodes.

    Request body: {
        "sources": [...], "target_dirs": [...], "exclude_dirs": [...],
        "addrs": ["master", "ip:port", ...]
    }
    Returns: {"status": "ok", "results": {addr: {"found":[...],"count":n} | {"error":...}}}
    """
    data = request.get_json(force=True)
    addrs = data.get("addrs", [])
    sources = data.get("sources", [])
    target_dirs = data.get("target_dirs", [])
    exclude_dirs = data.get("exclude_dirs", [])

    if not addrs:
        return jsonify({"error": "at least one node is required"}), 400
    if not sources:
        return jsonify({"error": "source file path is required"}), 400
    if not target_dirs:
        return jsonify({"error": "at least one target directory is required"}), 400

    results = {}
    for raw_addr in addrs:
        addr = (raw_addr or "master").strip() or "master"
        body, _status = _batch_check_core(addr, sources, target_dirs, exclude_dirs)
        results[addr] = body

    return jsonify({"status": "ok", "results": results})


def _batch_override_core(addr, sources, target_dirs, exclude_dirs):
    """Recursively find and replace files matching source filename(s), on one node.

    Shared by /files/batch-override (single node) and
    /files/batch-multi-override (multiple nodes, looped by the caller).

    Target Directories may use wildcard (``*``/``?``) patterns and/or be a
    combined list spanning multiple nodes (multi-node panel); resolved to
    this node's literal existing directories up front via
    _resolve_glob_dirs_core, so a pattern/dir belonging to a different node
    resolves to nothing here instead of raising "Directory not found".

    Returns: (body_dict, http_status)
    """
    import shutil

    resolved_dirs, err_body, status = _resolve_glob_dirs_core(addr, target_dirs, exclude_dirs)
    if err_body is not None:
        return err_body, status
    if not resolved_dirs:
        return {
            "status": "ok", "replaced": [],
            "errors": [f"No matching target directories found on {addr}"],
            "count": 0,
        }, 200
    target_dirs = resolved_dirs

    if _is_remote_addr(addr):
        # Source File paths are interpreted relative to the SELECTED NODE's
        # filesystem, same as Target/Exclude Directories -- not always the
        # master. Two cases are supported per source path:
        #   1. The path exists on the master's local disk: it is uploaded to
        #      a scratch dir on the worker first, then used as the override
        #      source (lets you push a file from master onto remote workers).
        #   2. The path does NOT exist on master (e.g. it is actually a path
        #      on the worker itself, as when source and target both live on
        #      the same remote node): it is passed through unchanged and the
        #      worker validates/uses it directly on its own filesystem.
        remote_scratch = f"__kirobatch_override_{uuid.uuid4().hex[:8]}"
        remote_sources = []
        upload_errors = []
        for s in sources:
            s = s.strip()
            if not s:
                continue
            s_norm = os.path.normpath(s)
            if os.path.isfile(s_norm):
                # Case 1: exists on master -- stage it onto the worker.
                basename = os.path.basename(s_norm)
                try:
                    with open(s_norm, "rb") as f:
                        files = {"file": (basename, f)}
                        r = _worker_session.post(
                            f"http://{addr}/files/upload",
                            data={"path": remote_scratch},
                            files=files,
                            timeout=30,
                        )
                    if r.ok:
                        remote_sources.append(r.json().get("path", ""))
                    else:
                        upload_errors.append(f"{basename} - upload failed ({r.status_code})")
                except http_requests.RequestException as exc:
                    upload_errors.append(f"{basename} - {str(exc)}")
            else:
                # Case 2: not on master -- assume it is already a valid path
                # on the worker itself; let the worker validate it.
                remote_sources.append(s)

        if not remote_sources:
            return {"error": "; ".join(upload_errors) or "no valid source files provided"}, 400

        body, status = _worker_proxy_post(addr, "/files/batch-override", {
            "sources": remote_sources, "target_dirs": target_dirs, "exclude_dirs": exclude_dirs
        })
        if isinstance(body, dict) and upload_errors:
            body["errors"] = upload_errors + (body.get("errors") or [])
        return body, status

    # Validate and build source map: filename -> full path
    source_map = {}
    source_errors = []
    for s in sources:
        s = s.strip()
        if not s:
            continue
        s_norm = os.path.normpath(s)
        if not os.path.isfile(s_norm):
            source_errors.append(f"Source file not found: {s}")
            continue
        source_map[os.path.basename(s_norm)] = s_norm

    if not source_map:
        error_msg = "; ".join(source_errors) if source_errors else "no valid source files provided"
        return {"error": error_msg}, 400

    # Normalize exclude dirs
    exclude_normalized = [os.path.normpath(d.strip()).lower() for d in exclude_dirs if d.strip()]

    replaced = []
    errors = list(source_errors)  # Include source file not found errors

    for td in target_dirs:
        td = os.path.normpath(td.strip())
        if not os.path.isdir(td):
            errors.append(f"Directory not found: {td}")
            continue
        for root, dirs, files in os.walk(td, followlinks=True):
            # Check if current root is under an excluded directory
            root_norm = os.path.normpath(root).lower()
            skip = False
            for ex in exclude_normalized:
                if root_norm == ex or root_norm.startswith(ex + os.sep):
                    skip = True
                    break
            if skip:
                continue
            for f in files:
                if f in source_map:
                    target_path = os.path.join(root, f)
                    if os.path.normpath(target_path) == source_map[f]:
                        continue
                    try:
                        shutil.copy2(source_map[f], target_path)
                        replaced.append(target_path.replace("\\", "/"))
                    except Exception as exc:
                        errors.append(f"{target_path.replace(chr(92), '/')} - {str(exc)}")

    return {"status": "ok", "replaced": replaced, "errors": errors, "count": len(replaced)}, 200


@app.route("/files/batch-override", methods=["POST"])
def batch_override():
    """Recursively find and replace files matching the source filename(s).

    Request body: {
        "sources": ["path1", "path2"],  // multiple sources (new), always local to master
        "source": "path",               // single source (backward compat)
        "target_dirs": ["dir1"],
        "exclude_dirs": ["ex1"],
        "addr": "master" | "ip:port"
    }
    """
    data = request.get_json(force=True)
    addr = data.get("addr", "master").strip() or "master"
    sources = data.get("sources", [])
    source = data.get("source", "").strip()
    target_dirs = data.get("target_dirs", [])
    exclude_dirs = data.get("exclude_dirs", [])
    # Backward compat: support single source
    if not sources and source:
        sources = [source]
    # Backward compat
    if not target_dirs and data.get("target_dir"):
        target_dirs = [data.get("target_dir", "").strip()]

    if not sources:
        return jsonify({"error": "source file path is required"}), 400
    if not target_dirs:
        return jsonify({"error": "at least one target directory is required"}), 400

    body, status = _batch_override_core(addr, sources, target_dirs, exclude_dirs)
    return jsonify(body), status


@app.route("/files/batch-multi-override", methods=["POST"])
def batch_multi_override():
    """Recursively find and replace files matching source filename(s), across MULTIPLE nodes.

    Request body: {
        "sources": [...], "target_dirs": [...], "exclude_dirs": [...],
        "addrs": ["master", "ip:port", ...]
    }
    Returns: {"status": "ok", "results": {addr: {"replaced":[...],"errors":[...]} | {"error":...}}}
    """
    data = request.get_json(force=True)
    addrs = data.get("addrs", [])
    sources = data.get("sources", [])
    target_dirs = data.get("target_dirs", [])
    exclude_dirs = data.get("exclude_dirs", [])

    if not addrs:
        return jsonify({"error": "at least one node is required"}), 400
    if not sources:
        return jsonify({"error": "source file path is required"}), 400
    if not target_dirs:
        return jsonify({"error": "at least one target directory is required"}), 400

    results = {}
    for raw_addr in addrs:
        addr = (raw_addr or "master").strip() or "master"
        body, _status = _batch_override_core(addr, sources, target_dirs, exclude_dirs)
        results[addr] = body

    return jsonify({"status": "ok", "results": results})


@app.route("/files/batch-delete", methods=["POST"])
def batch_delete():
    """Delete a list of files.

    Request body: {"files": ["/full/path/to/file1", ...], "addr": "master" | "ip:port"}
    """
    data = request.get_json(force=True)
    addr = data.get("addr", "master").strip() or "master"
    files = data.get("files", [])

    if not files:
        return jsonify({"error": "no files provided for deletion"}), 400

    if _is_remote_addr(addr):
        body, status = _worker_proxy_post(addr, "/files/batch-delete-files", {"files": files})
        return jsonify(body), status

    deleted = []
    errors = []

    for file_path in files:
        file_path = file_path.strip()
        if not file_path:
            continue
        file_path_norm = os.path.normpath(file_path)
        if not os.path.isfile(file_path_norm):
            errors.append(f"File not found: {file_path}")
            continue
        try:
            os.remove(file_path_norm)
            deleted.append(file_path_norm.replace("\\", "/"))
        except Exception as exc:
            errors.append(f"{file_path_norm.replace(chr(92), '/')} - {str(exc)}")

    return jsonify({"status": "ok", "deleted": deleted, "errors": errors, "count": len(deleted)})


# ---------------------------------------------------------------------------
# Batch Edit File (properties file key=value editing)
# ---------------------------------------------------------------------------

@app.route("/files/batch-edit-check", methods=["POST"])
def batch_edit_check():
    """Recursively find all files matching the given filename.

    Request body: {"filename": "name.ext", "target_dirs": ["dir1"], "exclude_dirs": ["ex1"], "addr": "master" | "ip:port"}
    """
    data = request.get_json(force=True)
    addr = data.get("addr", "master").strip() or "master"
    filename = data.get("filename", "").strip()
    target_dirs = data.get("target_dirs", [])
    exclude_dirs = data.get("exclude_dirs", [])

    if not filename:
        return jsonify({"error": "filename is required"}), 400
    if not target_dirs:
        return jsonify({"error": "at least one target directory is required"}), 400

    if _is_remote_addr(addr):
        body, status = _worker_proxy_post(addr, "/files/batch-search", {
            "mode": "exact", "names": [filename], "target_dirs": target_dirs, "exclude_dirs": exclude_dirs
        })
        return jsonify(body), status

    exclude_normalized = [os.path.normpath(d.strip()).lower() for d in exclude_dirs if d.strip()]
    found = []

    for td in target_dirs:
        td = os.path.normpath(td.strip())
        if not os.path.isdir(td):
            continue
        for root, dirs, files in os.walk(td, followlinks=True):
            root_norm = os.path.normpath(root).lower()
            skip = False
            for ex in exclude_normalized:
                if root_norm == ex or root_norm.startswith(ex + os.sep):
                    skip = True
                    break
            if skip:
                continue
            for f in files:
                if f == filename:
                    found.append(os.path.join(root, f).replace("\\", "/"))

    return jsonify({"status": "ok", "found": found, "count": len(found)})


@app.route("/files/batch-edit-apply", methods=["POST"])
def batch_edit_apply():
    """Batch edit .properties files: update existing keys or append new ones.

    Request body: {
        "filename": "stresstest.properties",
        "contents": ["WildEastGameIds=200", "openCardAmount=1"],
        "target_dirs": ["D:\\tools2"],
        "exclude_dirs": [],
        "addr": "master" | "ip:port"
    }
    """
    data = request.get_json(force=True)
    addr = data.get("addr", "master").strip() or "master"
    filename = data.get("filename", "").strip()
    contents = data.get("contents", [])
    target_dirs = data.get("target_dirs", [])
    exclude_dirs = data.get("exclude_dirs", [])

    if not filename:
        return jsonify({"error": "filename is required"}), 400
    if not contents:
        return jsonify({"error": "at least one content entry is required"}), 400
    if not target_dirs:
        return jsonify({"error": "at least one target directory is required"}), 400
    if not filename.endswith(".properties"):
        return jsonify({"error": "Batch Edit currently only supports .properties files"}), 400

    if _is_remote_addr(addr):
        body, status = _worker_proxy_post(addr, "/files/batch-edit-apply", {
            "filename": filename, "contents": contents, "target_dirs": target_dirs, "exclude_dirs": exclude_dirs
        })
        return jsonify(body), status

    # Parse contents into key=value pairs
    kv_pairs = []
    for item in contents:
        item = item.strip()
        if "=" in item:
            key, value = item.split("=", 1)
            kv_pairs.append((key.strip(), value.strip()))
        else:
            # Treat as key with empty value
            kv_pairs.append((item.strip(), ""))

    if not kv_pairs:
        return jsonify({"error": "no valid key=value pairs found in contents"}), 400

    # Find all matching files
    exclude_normalized = [os.path.normpath(d.strip()).lower() for d in exclude_dirs if d.strip()]
    found_files = []

    for td in target_dirs:
        td = os.path.normpath(td.strip())
        if not os.path.isdir(td):
            continue
        for root, dirs, files in os.walk(td, followlinks=True):
            root_norm = os.path.normpath(root).lower()
            skip = False
            for ex in exclude_normalized:
                if root_norm == ex or root_norm.startswith(ex + os.sep):
                    skip = True
                    break
            if skip:
                continue
            for f in files:
                if f == filename:
                    found_files.append(os.path.join(root, f))

    updated = []
    errors = []

    for file_path in found_files:
        try:
            # Read current content
            with open(file_path, "r", encoding="utf-8") as fh:
                lines = fh.readlines()

            # Track which keys have been updated
            keys_updated = set()
            new_lines = []

            for line in lines:
                stripped = line.rstrip("\n").rstrip("\r")
                matched = False
                for key, value in kv_pairs:
                    # Check if line starts with the key (handle key= or key =)
                    if stripped.startswith(key) and "=" in stripped:
                        line_key = stripped.split("=", 1)[0].strip()
                        if line_key == key:
                            new_lines.append(f"{key}={value}\n")
                            keys_updated.add(key)
                            matched = True
                            break
                if not matched:
                    new_lines.append(line if line.endswith("\n") else line + "\n")

            # Append keys that were not found in the file
            for key, value in kv_pairs:
                if key not in keys_updated:
                    # Ensure there's a newline before appending
                    if new_lines and not new_lines[-1].endswith("\n"):
                        new_lines[-1] += "\n"
                    new_lines.append(f"{key}={value}\n")

            # Write back
            with open(file_path, "w", encoding="utf-8") as fh:
                fh.writelines(new_lines)

            updated.append(file_path.replace("\\", "/"))
        except Exception as exc:
            errors.append(f"{file_path.replace(chr(92), '/')} - {str(exc)}")

    return jsonify({"status": "ok", "updated": updated, "errors": errors, "count": len(updated)})


@app.route("/files/batch-edit-read", methods=["POST"])
def batch_edit_read():
    """Read the content of a file for preview/editing.

    Request body: {"path": "/full/path/to/file", "addr": "master" | "ip:port"}
    """
    data = request.get_json(force=True)
    addr = data.get("addr", "master").strip() or "master"
    file_path = data.get("path", "").strip()

    if not file_path:
        return jsonify({"error": "path is required"}), 400

    if _is_remote_addr(addr):
        # /files/read on the worker is a GET endpoint; proxy via query params.
        try:
            r = _worker_session.get(f"http://{addr}/files/read", params={"path": file_path}, timeout=10)
            try:
                return jsonify(r.json()), r.status_code
            except ValueError:
                return jsonify({"error": "Worker returned non-JSON"}), 500
        except http_requests.RequestException as exc:
            return jsonify({"error": str(exc)}), 500

    file_path = os.path.normpath(file_path)
    if not os.path.isfile(file_path):
        return jsonify({"error": f"File not found: {file_path}"}), 404

    try:
        with open(file_path, "r", encoding="utf-8") as fh:
            content = fh.read()
        return jsonify({"status": "ok", "content": content})
    except UnicodeDecodeError:
        # Try latin-1 as fallback
        try:
            with open(file_path, "r", encoding="latin-1") as fh:
                content = fh.read()
            return jsonify({"status": "ok", "content": content})
        except Exception as exc:
            return jsonify({"error": f"Cannot read file (binary?): {str(exc)}"}), 400
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@app.route("/files/batch-edit-save", methods=["POST"])
def batch_edit_save():
    """Save edited content back to a file.

    Request body: {"path": "/full/path/to/file", "content": "new content", "addr": "master" | "ip:port"}
    """
    data = request.get_json(force=True)
    addr = data.get("addr", "master").strip() or "master"
    file_path = data.get("path", "").strip()
    content = data.get("content", "")

    if not file_path:
        return jsonify({"error": "path is required"}), 400

    if _is_remote_addr(addr):
        body, status = _worker_proxy_post(addr, "/files/write", {"path": file_path, "content": content})
        return jsonify(body), status

    file_path = os.path.normpath(file_path)
    if not os.path.isfile(file_path):
        return jsonify({"error": f"File not found: {file_path}"}), 404

    try:
        with open(file_path, "w", encoding="utf-8") as fh:
            fh.write(content)
        return jsonify({"status": "ok", "message": "File saved successfully"})
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


# ---------------------------------------------------------------------------
# Shared directory-pattern resolution (glob-aware, per-node)
# ---------------------------------------------------------------------------

def _resolve_glob_dirs_core(addr, dir_patterns, exclude_dirs):
    """Resolve directory glob patterns to literal, existing directories on one node.

    Shared by Batch Upload/Override/Download's Target Directories handling.
    Target Directories may contain wildcard (``*``/``?``) segments (e.g.
    ``E:/.../SimC*/math/Game/configuration``) AND, in the multi-node panels,
    a single combined list covering every selected node even though each
    node's production_dir root differs (or doesn't exist at all on other
    nodes/platforms). Resolving each node's applicable, EXISTING directories
    up front -- instead of matching file-search/copy logic against the raw
    unresolved patterns everywhere else -- means:
      1. Wildcard patterns actually expand to real directories (os.path.isdir
         on a literal "*" string is always False, so without this step glob
         patterns silently matched nothing).
      2. A directory that belongs to a DIFFERENT selected node (not this
         one) is simply absent from the resolved list, rather than causing
         a hard "Directory not found" error for this node's request.

    Returns: (found_dirs, error_body_or_None, http_status)
    """
    import glob

    if _is_remote_addr(addr):
        body, status = _worker_proxy_post(addr, "/files/batch-search", {
            "mode": "dir_glob", "dir_patterns": dir_patterns, "exclude_dirs": exclude_dirs
        })
        if status != 200 or not isinstance(body, dict):
            err = body if isinstance(body, dict) else {
                "error": f"resolve directories failed (status {status})"
            }
            return [], err, status
        return body.get("found", []), None, 200

    exclude_normalized = [os.path.normpath(d.strip()).lower() for d in exclude_dirs if d.strip()]
    found = []

    for td in dir_patterns:
        td = td.strip()
        if not td:
            continue
        # Use glob to expand wildcard patterns; treat as a literal path
        # otherwise (glob.glob would return [] for a literal nonexistent
        # path just the same as os.path.isdir would report False below).
        matched_dirs = glob.glob(td) if ("*" in td or "?" in td) else [td]

        for d in matched_dirs:
            d_norm = os.path.normpath(d)
            if not os.path.isdir(d_norm):
                continue
            # Check exclusion
            d_lower = d_norm.lower()
            skip = False
            for ex in exclude_normalized:
                if d_lower == ex or d_lower.startswith(ex + os.sep):
                    skip = True
                    break
            if skip:
                continue
            found.append(d_norm.replace("\\", "/"))

    # Remove duplicates and sort
    return sorted(set(found)), None, 200


# ---------------------------------------------------------------------------
# Batch Upload File (glob pattern directory matching + file copy)
# ---------------------------------------------------------------------------

def _batch_up_check_core(addr, src_files, target_dirs, exclude_dirs):
    """Find directories matching glob patterns for batch upload, on one node.

    Shared by /files/batch-up-check (single node) and
    /files/batch-multi-up-check (multiple nodes, looped by the caller).

    Returns: (body_dict, http_status)
    """
    found, err_body, status = _resolve_glob_dirs_core(addr, target_dirs, exclude_dirs)
    if err_body is not None:
        return err_body, status
    return {"status": "ok", "found": found, "count": len(found)}, 200


@app.route("/files/batch-up-check", methods=["POST"])
def batch_up_check():
    """Find directories matching glob patterns for batch upload.

    Target directories support * wildcard patterns (glob).
    Request body: {
        "src_files": ["VBWildBallLogic.jar", "VBWildEastBingoLogic.jar"],
        "target_dirs": ["E:/python/workSpace/temp/ShowBingoSim/*/simulator/B2BGameSimulator/lib"],
        "exclude_dirs": [],
        "addr": "master" | "ip:port"
    }
    """
    data = request.get_json(force=True)
    addr = data.get("addr", "master").strip() or "master"
    src_files = data.get("src_files", [])
    target_dirs = data.get("target_dirs", [])
    exclude_dirs = data.get("exclude_dirs", [])

    if not src_files:
        return jsonify({"error": "at least one source file is required"}), 400
    if not target_dirs:
        return jsonify({"error": "at least one target directory is required"}), 400

    body, status = _batch_up_check_core(addr, src_files, target_dirs, exclude_dirs)
    return jsonify(body), status


@app.route("/files/batch-multi-up-check", methods=["POST"])
def batch_multi_up_check():
    """Find directories matching glob patterns for batch upload, across MULTIPLE nodes.

    Selected nodes are expected to share an identical production_dir
    subdirectory structure, so the same target_dirs/exclude_dirs patterns
    are applied to every selected node; each node is still searched
    independently (glob results can differ per node, e.g. different drive
    letters or partially-synced directories).

    Request body: {
        "src_files": [...], "target_dirs": [...], "exclude_dirs": [...],
        "addrs": ["master", "ip:port", ...]
    }
    Returns: {"status": "ok", "results": {addr: {"found":[...],"count":n} | {"error":...}}}
    """
    data = request.get_json(force=True)
    addrs = data.get("addrs", [])
    src_files = data.get("src_files", [])
    target_dirs = data.get("target_dirs", [])
    exclude_dirs = data.get("exclude_dirs", [])

    if not addrs:
        return jsonify({"error": "at least one node is required"}), 400
    if not src_files:
        return jsonify({"error": "at least one source file is required"}), 400
    if not target_dirs:
        return jsonify({"error": "at least one target directory is required"}), 400

    results = {}
    for raw_addr in addrs:
        addr = (raw_addr or "master").strip() or "master"
        body, _status = _batch_up_check_core(addr, src_files, target_dirs, exclude_dirs)
        results[addr] = body

    return jsonify({"status": "ok", "results": results})


def _batch_up_upload_core(addr, src_files, target_dirs):
    """Copy source files to all selected target directories, on one node.

    Shared by /files/batch-up-upload (single node) and
    /files/batch-multi-up-upload (multiple nodes, looped by the caller).

    Returns: (body_dict, http_status)
    """
    import shutil

    if _is_remote_addr(addr):
        # Source File paths are interpreted relative to the SELECTED NODE's
        # filesystem, same as Target Directories. Two cases per source path:
        #   1. Exists on master's local disk: stage it onto the worker via
        #      upload (lets you push a file from master onto a worker).
        #   2. Does NOT exist on master (e.g. it is actually a path on the
        #      worker itself, when source and target both live on the same
        #      remote node): pass it through unchanged, worker validates it.
        remote_scratch = f"__kirobatch_upload_{uuid.uuid4().hex[:8]}"
        remote_sources = []
        errors = []
        for src in src_files:
            src = src.strip()
            if not src:
                continue
            src_path = os.path.normpath(src)
            if os.path.isfile(src_path):
                try:
                    with open(src_path, "rb") as f:
                        files = {"file": (os.path.basename(src_path), f)}
                        r = _worker_session.post(
                            f"http://{addr}/files/upload",
                            data={"path": remote_scratch},
                            files=files,
                            timeout=30,
                        )
                    if r.ok:
                        remote_sources.append(r.json().get("path", ""))
                    else:
                        errors.append(f"{os.path.basename(src_path)} - upload failed ({r.status_code})")
                except http_requests.RequestException as exc:
                    errors.append(f"{os.path.basename(src_path)} - {str(exc)}")
            else:
                remote_sources.append(src)

        if not remote_sources:
            return {"error": "; ".join(errors) or "no valid source files provided"}, 400

        body, status = _worker_proxy_post(addr, "/files/batch-up-upload", {
            "src_files": remote_sources, "target_dirs": target_dirs
        })
        if isinstance(body, dict) and errors:
            body["errors"] = errors + (body.get("errors") or [])
        return body, status

    copied = []
    errors = []

    for src in src_files:
        src = src.strip()
        if not src:
            continue

        # Determine if src is a full path or just a filename
        src_path = os.path.normpath(src)
        if not os.path.isfile(src_path):
            errors.append(f"Source file not found: {src}")
            continue

        filename = os.path.basename(src_path)

        for td in target_dirs:
            td_norm = os.path.normpath(td.strip())
            if not os.path.isdir(td_norm):
                errors.append(f"Target directory not found: {td}")
                continue
            dest_path = os.path.join(td_norm, filename)
            try:
                shutil.copy2(src_path, dest_path)
                copied.append(dest_path.replace("\\", "/"))
            except Exception as exc:
                errors.append(f"{dest_path.replace(chr(92), '/')} - {str(exc)}")

    return {"status": "ok", "copied": copied, "errors": errors, "count": len(copied)}, 200


@app.route("/files/batch-up-upload", methods=["POST"])
def batch_up_upload():
    """Copy source files to all selected target directories.

    For each source file name, search the system for that file (using the same
    name in the working directory or provided path), then copy it to each
    selected target directory.

    Request body: {
        "src_files": ["VBWildBallLogic.jar", "VBWildEastBingoLogic.jar"],  // always local to master
        "target_dirs": ["E:/path/to/dir1", "E:/path/to/dir2"],
        "addr": "master" | "ip:port"
    }
    """
    data = request.get_json(force=True)
    addr = data.get("addr", "master").strip() or "master"
    src_files = data.get("src_files", [])
    target_dirs = data.get("target_dirs", [])

    if not src_files:
        return jsonify({"error": "at least one source file is required"}), 400
    if not target_dirs:
        return jsonify({"error": "at least one target directory is required"}), 400

    body, status = _batch_up_upload_core(addr, src_files, target_dirs)
    return jsonify(body), status


@app.route("/files/batch-multi-up-upload", methods=["POST"])
def batch_multi_up_upload():
    """Copy source files to target directories on MULTIPLE selected nodes.

    Each node's production_dir/simulator_dir subdirectory structure is
    assumed identical, so the same target directory glob patterns are
    re-expanded independently per node (mirroring /files/batch-up-check)
    before uploading, since actual matching directories can still differ
    slightly per node (e.g. partially synced trees). A node with zero
    matching directories is reported as an error for that node rather
    than failing the whole request.

    Runs sequentially per selected node (source files are always read from
    master's local disk). A failure on one node does not stop the rest.

    Request body: {
        "src_files": [...], "target_dirs": [...], "exclude_dirs": [...],
        "addrs": ["master", "ip:port", ...]
    }
    Returns: {"status": "ok", "results": {addr: {"copied":[...],"errors":[...]} | {"error":...}}}
    """
    data = request.get_json(force=True)
    addrs = data.get("addrs", [])
    src_files = data.get("src_files", [])
    target_dirs = data.get("target_dirs", [])
    exclude_dirs = data.get("exclude_dirs", [])

    if not addrs:
        return jsonify({"error": "at least one node is required"}), 400
    if not src_files:
        return jsonify({"error": "at least one source file is required"}), 400
    if not target_dirs:
        return jsonify({"error": "at least one target directory is required"}), 400

    results = {}
    for raw_addr in addrs:
        addr = (raw_addr or "master").strip() or "master"
        check_body, check_status = _batch_up_check_core(addr, src_files, target_dirs, exclude_dirs)
        if check_status != 200 or not isinstance(check_body, dict):
            results[addr] = check_body if isinstance(check_body, dict) else {
                "error": f"check failed (status {check_status})"
            }
            continue
        found_dirs = check_body.get("found", [])
        if not found_dirs:
            results[addr] = {"error": "no matching target directories found"}
            continue
        body, _status = _batch_up_upload_core(addr, src_files, found_dirs)
        results[addr] = body

    return jsonify({"status": "ok", "results": results})


# ---------------------------------------------------------------------------
# Batch Download File (wildcard search + zip download)
# ---------------------------------------------------------------------------

def _batch_dl_check_core(addr, filename, target_dirs, exclude_dirs):
    """Recursively find files matching the given filename, on one node.

    Shared by /files/batch-dl-check (single node) and
    /files/batch-multi-dl-check (multiple nodes, looped by the caller).

    Target Directories may use wildcard (``*``/``?``) patterns and/or be a
    combined list spanning multiple nodes (multi-node panel); resolved to
    this node's literal existing directories up front via
    _resolve_glob_dirs_core.

    Returns: (body_dict, http_status)
    """
    import fnmatch

    resolved_dirs, err_body, status = _resolve_glob_dirs_core(addr, target_dirs, exclude_dirs)
    if err_body is not None:
        return err_body, status
    if not resolved_dirs:
        return {"status": "ok", "found": [], "count": 0}, 200

    use_wildcard = "*" in filename or "?" in filename

    if _is_remote_addr(addr):
        return _worker_proxy_post(addr, "/files/batch-search", {
            "mode": "glob" if use_wildcard else "exact",
            "pattern": filename,
            "names": [filename],
            "target_dirs": resolved_dirs, "exclude_dirs": exclude_dirs
        })

    exclude_normalized = [os.path.normpath(d.strip()).lower() for d in exclude_dirs if d.strip()]
    found = []

    for td in resolved_dirs:
        td = os.path.normpath(td.strip())
        if not os.path.isdir(td):
            continue
        for root, dirs, files in os.walk(td, followlinks=True):
            root_norm = os.path.normpath(root).lower()
            skip = False
            for ex in exclude_normalized:
                if root_norm == ex or root_norm.startswith(ex + os.sep):
                    skip = True
                    break
            if skip:
                continue
            for f in files:
                if use_wildcard:
                    if fnmatch.fnmatch(f, filename):
                        found.append(os.path.join(root, f).replace("\\", "/"))
                else:
                    if f == filename:
                        found.append(os.path.join(root, f).replace("\\", "/"))

    return {"status": "ok", "found": found, "count": len(found)}, 200


@app.route("/files/batch-dl-check", methods=["POST"])
def batch_dl_check():
    """Recursively find files matching the given filename (supports * wildcard).

    Request body: {"filename": "CalacaBingo*.txt", "target_dirs": ["dir1"], "exclude_dirs": ["ex1"], "addr": "master" | "ip:port"}
    """
    data = request.get_json(force=True)
    addr = data.get("addr", "master").strip() or "master"
    filename = data.get("filename", "").strip()
    target_dirs = data.get("target_dirs", [])
    exclude_dirs = data.get("exclude_dirs", [])

    if not filename:
        return jsonify({"error": "filename is required"}), 400
    if not target_dirs:
        return jsonify({"error": "at least one target directory is required"}), 400

    body, status = _batch_dl_check_core(addr, filename, target_dirs, exclude_dirs)
    return jsonify(body), status


@app.route("/files/batch-multi-dl-check", methods=["POST"])
def batch_multi_dl_check():
    """Recursively find files matching the given filename, across MULTIPLE nodes.

    Request body: {
        "filename": "...", "target_dirs": [...], "exclude_dirs": [...],
        "addrs": ["master", "ip:port", ...]
    }
    Returns: {"status": "ok", "results": {addr: {"found":[...],"count":n} | {"error":...}}}
    """
    data = request.get_json(force=True)
    addrs = data.get("addrs", [])
    filename = data.get("filename", "").strip()
    target_dirs = data.get("target_dirs", [])
    exclude_dirs = data.get("exclude_dirs", [])

    if not addrs:
        return jsonify({"error": "at least one node is required"}), 400
    if not filename:
        return jsonify({"error": "filename is required"}), 400
    if not target_dirs:
        return jsonify({"error": "at least one target directory is required"}), 400

    results = {}
    for raw_addr in addrs:
        addr = (raw_addr or "master").strip() or "master"
        body, _status = _batch_dl_check_core(addr, filename, target_dirs, exclude_dirs)
        results[addr] = body

    return jsonify({"status": "ok", "results": results})


def _sanitize_node_folder_name(addr: str) -> str:
    """Turn a node address into a filesystem/zip-path-safe folder name."""
    return (addr or "master").replace(":", "_").replace("\\", "_").replace("/", "_")


def _filter_target_dirs_for_files(target_dirs, files):
    """Return only the target_dirs that are an ancestor of at least one file.

    In multi-node batch download, `target_dirs` is a COMBINED list covering
    ALL selected nodes (e.g. Master's "E:/python/.../ShowBingoSim" AND a
    Linux worker's "/home/ubuntu/temp/sim.../temp"). Forwarding the whole
    combined list to a single node is wrong: that node's own
    /files/batch-dl-download endpoint picks target_dirs[0] as its zip
    staging base directory, and if some OTHER node's path happens to be
    first, it doesn't exist on this node at all -- causing
    "Target directory not found" even though this node's own files were
    found successfully during Check.

    Pure string comparison (no os.path) is used deliberately: `files` are
    already-found paths using forward slashes, but they may describe a
    remote Linux filesystem while master itself runs on Windows, so
    platform-dependent path functions (os.path.normpath/os.sep) would give
    wrong answers for the other platform's paths.
    """
    if not files:
        return []
    normalized_files = [f.replace("\\", "/").lower() for f in files]
    relevant = []
    for td in target_dirs:
        td_norm = td.strip().replace("\\", "/").rstrip("/").lower()
        if not td_norm:
            continue
        for f in normalized_files:
            if f == td_norm or f.startswith(td_norm + "/"):
                relevant.append(td)
                break
    return relevant


def _batch_dl_add_node_to_zip(combined_zf, addr, files, target_dirs, errors):
    """Add one node's selected files into an already-open combined zip.

    Files are placed under a subfolder named after the node (e.g.
    "master/" or "10_10_34_26_5002/"), preserving each file's relative
    path from whichever target directory it matched -- same relative
    layout as the existing single-node download, just namespaced per node
    so multiple nodes' files never collide in the combined zip.

    Any per-file/per-node failure is appended to `errors` (mutated
    in-place) rather than raised, so one bad node/file does not abort the
    whole multi-node download.
    """
    import io
    import zipfile

    node_folder = _sanitize_node_folder_name(addr)

    # target_dirs here is the raw combined list from the request (possibly
    # containing wildcard patterns and/or directories belonging to OTHER
    # selected nodes). Resolve wildcards to this node's literal existing
    # directories first, then keep only the ones that are actually an
    # ancestor of at least one of this node's found files -- both steps
    # are needed: resolving handles glob patterns, filtering handles the
    # combined multi-node list.
    resolved_dirs, _err, _status = _resolve_glob_dirs_core(addr, target_dirs, [])
    node_target_dirs = _filter_target_dirs_for_files(resolved_dirs, files)
    if not node_target_dirs:
        errors.append(f"{addr}: none of the provided target directories match this node's found files")
        return

    if _is_remote_addr(addr):
        r, status = _worker_proxy_post(addr, "/files/batch-dl-download", {
            "files": files, "target_dirs": node_target_dirs
        }, timeout=60, stream=True)
        if status != 200:
            try:
                err_body = r.json()
                errors.append(f"{addr}: {err_body.get('error', 'download failed')}")
            except Exception:
                errors.append(f"{addr}: worker returned status {status}")
            return
        try:
            content = r.content
            inner_zip = zipfile.ZipFile(io.BytesIO(content))
        except Exception as exc:
            errors.append(f"{addr}: invalid zip data from worker - {exc}")
            return
        for name in inner_zip.namelist():
            # Worker's zip entries are prefixed with "temp/" (built via
            # os.path.join, which uses "\\" on Windows workers) -- strip
            # that leading segment regardless of which separator was used,
            # then re-root under this node's folder in the combined zip.
            name_normalized = name.replace("\\", "/")
            rel = name_normalized.split("/", 1)[1] if "/" in name_normalized else name_normalized
            try:
                combined_zf.writestr(f"{node_folder}/{rel}", inner_zip.read(name))
            except Exception as exc:
                errors.append(f"{addr}: {name} - {exc}")
        return

    # Local (master) files: write directly into the combined zip, no
    # intermediate temp folder needed since we already have a live
    # ZipFile handle.
    for file_path in files:
        file_path_norm = os.path.normpath(file_path)
        if not os.path.isfile(file_path_norm):
            errors.append(f"{addr}: File not found: {file_path}")
            continue

        rel_path = None
        for td in node_target_dirs:
            td_norm = os.path.normpath(td.strip())
            if file_path_norm.lower().startswith(td_norm.lower() + os.sep):
                rel_path = os.path.relpath(file_path_norm, td_norm)
                break
        if rel_path is None:
            rel_path = os.path.basename(file_path_norm)

        arcname = f"{node_folder}/{rel_path.replace(chr(92), '/')}"
        try:
            combined_zf.write(file_path_norm, arcname)
        except Exception as exc:
            errors.append(f"{addr}: {file_path} - {exc}")


@app.route("/files/batch-multi-dl-download", methods=["POST"])
def batch_multi_dl_download():
    """Download files from MULTIPLE selected nodes as a single combined zip.

    Each node's files are placed under a subfolder named after that node
    (e.g. "master/", "10.10.34.26_5002/") inside one zip, so selecting N
    nodes results in ONE download instead of N separate manual downloads.

    Request body: {
        "target_dirs": ["dir1"],
        "addrs": ["master", "ip:port", ...],
        "per_node_files": {"master": ["/full/path/1", ...], "ip:port": [...]}
    }
    """
    import io
    import zipfile
    from flask import send_file

    data = request.get_json(force=True)
    addrs = data.get("addrs", [])
    target_dirs = data.get("target_dirs", [])
    per_node_files = data.get("per_node_files", {})

    if not addrs:
        return jsonify({"error": "at least one node is required"}), 400
    if not target_dirs:
        return jsonify({"error": "at least one target directory is required"}), 400
    if not per_node_files or not any(per_node_files.values()):
        return jsonify({"error": "no files selected for any node"}), 400

    errors = []
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as combined_zf:
        for raw_addr in addrs:
            addr = (raw_addr or "master").strip() or "master"
            files = per_node_files.get(addr) or per_node_files.get(raw_addr) or []
            if not files:
                continue
            _batch_dl_add_node_to_zip(combined_zf, addr, files, target_dirs, errors)
        if errors:
            combined_zf.writestr("errors.txt", "\n".join(errors))

    if len(buf.getvalue()) == 0:
        return jsonify({"error": "; ".join(errors) or "no files were downloaded"}), 500

    buf.seek(0)
    return send_file(
        buf,
        mimetype="application/zip",
        as_attachment=True,
        download_name="batch_multi_download.zip",
    )


@app.route("/files/batch-dl-download", methods=["POST"])
def batch_dl_download():
    """Create a zip of selected files preserving relative directory structure.

    The zip is created under a 'temp' folder in the first target directory,
    preserving the relative paths from that target directory.

    Request body: {"files": ["/full/path/to/file1", ...], "target_dirs": ["dir1"], "addr": "master" | "ip:port"}
    """
    import shutil
    import zipfile
    from flask import send_file, Response

    data = request.get_json(force=True)
    addr = data.get("addr", "master").strip() or "master"
    files = data.get("files", [])
    target_dirs = data.get("target_dirs", [])

    if not files:
        return jsonify({"error": "no files selected"}), 400
    if not target_dirs:
        return jsonify({"error": "at least one target directory is required"}), 400

    if _is_remote_addr(addr):
        r, status = _worker_proxy_post(addr, "/files/batch-dl-download", {
            "files": files, "target_dirs": target_dirs
        }, timeout=60, stream=True)
        if status != 200:
            try:
                return jsonify(r.json()), status
            except Exception:
                return jsonify({"error": f"Worker returned {status}"}), status
        return Response(
            r.iter_content(chunk_size=8192),
            headers={"Content-Disposition": "attachment; filename=temp.zip",
                     "Content-Type": r.headers.get("Content-Type", "application/zip")}
        )

    # Use the first target directory as the base for temp folder
    base_dir = os.path.normpath(target_dirs[0].strip())
    if not os.path.isdir(base_dir):
        return jsonify({"error": f"Target directory not found: {base_dir}"}), 404

    temp_dir = os.path.join(base_dir, "temp")
    zip_path = os.path.join(base_dir, "temp.zip")

    # Remove existing temp folder and zip
    if os.path.exists(temp_dir):
        shutil.rmtree(temp_dir)
    if os.path.exists(zip_path):
        os.remove(zip_path)

    # Create temp folder and copy files preserving relative structure
    os.makedirs(temp_dir, exist_ok=True)

    errors = []
    for file_path in files:
        file_path_norm = os.path.normpath(file_path)
        if not os.path.isfile(file_path_norm):
            errors.append(f"File not found: {file_path}")
            continue

        # Determine relative path from the matching target directory
        rel_path = None
        for td in target_dirs:
            td_norm = os.path.normpath(td.strip())
            if file_path_norm.lower().startswith(td_norm.lower() + os.sep):
                rel_path = os.path.relpath(file_path_norm, td_norm)
                break

        if rel_path is None:
            # Fallback: use filename only
            rel_path = os.path.basename(file_path_norm)

        dest_path = os.path.join(temp_dir, rel_path)
        dest_dir = os.path.dirname(dest_path)
        os.makedirs(dest_dir, exist_ok=True)

        try:
            shutil.copy2(file_path_norm, dest_path)
        except Exception as exc:
            errors.append(f"{file_path} - {str(exc)}")

    # Create zip file
    try:
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for root, dirs, zip_files in os.walk(temp_dir):
                for f in zip_files:
                    abs_path = os.path.join(root, f)
                    arc_name = os.path.join("temp", os.path.relpath(abs_path, temp_dir))
                    zf.write(abs_path, arc_name)
    except Exception as exc:
        return jsonify({"error": f"Failed to create zip: {str(exc)}"}), 500

    # Clean up temp folder (keep zip for download)
    shutil.rmtree(temp_dir, ignore_errors=True)

    if not os.path.isfile(zip_path):
        return jsonify({"error": "Failed to create zip file"}), 500

    return send_file(zip_path, as_attachment=True, download_name="temp.zip")


@app.route("/files/local/download", methods=["GET"])
def local_download():
    """Download a local file."""
    from flask import send_file
    file_path = request.args.get("path", "")
    full_path = os.path.normpath(file_path)
    if not os.path.isfile(full_path):
        return jsonify({"error": "File not found"}), 404
    return send_file(full_path, as_attachment=True)


@app.route("/files/worker/download", methods=["GET"])
def worker_download():
    """Download a file from a remote worker (proxy)."""
    addr = request.args.get("addr", "")
    file_path = request.args.get("path", "")
    if not addr or not file_path:
        return jsonify({"error": "addr and path are required"}), 400
    try:
        # Try /files/download first (new endpoint)
        r = _worker_session.get(f"http://{addr}/files/download", params={"path": file_path}, timeout=30, stream=True)
        if r.status_code == 200:
            from flask import Response
            filename = os.path.basename(file_path)
            headers = {"Content-Disposition": f"attachment; filename={filename}"}
            if r.headers.get("Content-Type"):
                headers["Content-Type"] = r.headers["Content-Type"]
            return Response(r.iter_content(chunk_size=8192), headers=headers)
        # Fallback: use /files/read for text files (older workers)
        r2 = _worker_session.get(f"http://{addr}/files/read", params={"path": file_path}, timeout=30)
        if r2.status_code == 200:
            data = r2.json()
            content = data.get("content", "")
            from flask import Response
            filename = os.path.basename(file_path)
            return Response(
                content.encode("utf-8"),
                headers={
                    "Content-Disposition": f"attachment; filename={filename}",
                    "Content-Type": "application/octet-stream",
                }
            )
        return jsonify({"error": f"Worker returned {r.status_code}"}), r.status_code
    except http_requests.RequestException as exc:
        return jsonify({"error": str(exc)}), 500


@app.route("/files/local/read", methods=["GET"])
def local_read():
    """Read a local file content for preview or transfer.

    Query param: ?path=absolute/path&preview=1 (preview returns JSON with content)
    """
    from flask import send_file
    file_path = request.args.get("path", "")
    preview = request.args.get("preview", "")
    full_path = os.path.normpath(file_path)
    if not os.path.isfile(full_path):
        return jsonify({"error": "File not found"}), 404
    if preview:
        try:
            with open(full_path, "r", encoding="utf-8") as f:
                content = f.read(100000)
            return jsonify({"path": file_path, "content": content, "size": os.path.getsize(full_path)})
        except Exception as exc:
            return jsonify({"error": str(exc)}), 500
    return send_file(full_path, as_attachment=True)


@app.route("/files/production-dir", methods=["GET"])
def files_production_dir():
    """Return a single node's resolved production_dir path.

    Used by the Batch Upload/Override/Download File "multi-node" panels to
    auto-fill Target Directories with each selected node's production_dir
    root -- nodes share an identical subdirectory structure BELOW that
    root, but the root itself (drive letter on Windows, or an entirely
    different path on Linux workers) differs per node, so it cannot be
    hardcoded on the frontend.

    Query param: ?addr=master | ip:port

    Returns: {"addr": ..., "production_dir": "..."}  or  {"error": "..."}
    """
    addr = request.args.get("addr", "master").strip() or "master"

    if not _is_remote_addr(addr):
        prod_dir = config.production_dir
        if not prod_dir:
            return jsonify({"error": "production_dir not configured for master"}), 400
        return jsonify({"addr": addr, "production_dir": prod_dir.replace("\\", "/")})

    # Remote worker: reuse its /files/browse with an empty path, which
    # resolves to (and returns) the worker's own PRODUCTION_DIR without
    # requiring a dedicated endpoint on the worker side.
    try:
        r = _worker_session.get(
            f"http://{addr}/files/browse", params={"path": ""}, timeout=10
        )
        try:
            data = r.json()
        except ValueError:
            return jsonify({"error": f"Worker returned non-JSON (status {r.status_code})"}), 500
        if not r.ok:
            return jsonify(data), r.status_code
        prod_dir = data.get("path", "")
        if not prod_dir:
            return jsonify({"error": "Worker did not return a production_dir path"}), 500
        return jsonify({"addr": addr, "production_dir": prod_dir})
    except http_requests.RequestException as exc:
        return jsonify({"error": str(exc)}), 500


@app.route("/files/worker/browse", methods=["GET"])
def worker_browse():
    """Proxy: browse a worker's directory (absolute path).

    Query params: ?addr=ip:port&path=absolute/path (empty = worker's production_dir)
    """
    addr = request.args.get("addr", "")
    browse_path = request.args.get("path", "")
    if not addr:
        return jsonify({"error": "addr required"}), 400
    try:
        r = _worker_session.get(
            f"http://{addr}/files/browse",
            params={"path": browse_path}, timeout=10
        )
        try:
            data = r.json()
        except ValueError:
            return jsonify({"error": f"Worker returned non-JSON (status {r.status_code})"}), 500
        return jsonify(data), r.status_code
    except http_requests.RequestException as exc:
        return jsonify({"error": str(exc)}), 500


@app.route("/files/master/upload", methods=["POST"])
def master_upload():
    """Upload a file from the browser to the master filesystem.

    Form data: target_dir (absolute path on master)
    File: file (multipart file upload)
    """
    target_dir = request.form.get("target_dir", "")
    if not target_dir:
        return jsonify({"error": "target_dir required"}), 400

    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400

    uploaded = request.files["file"]
    if not uploaded.filename:
        return jsonify({"error": "Empty filename"}), 400

    # Ensure target directory exists
    os.makedirs(target_dir, exist_ok=True)
    dest_path = os.path.join(target_dir, uploaded.filename)
    try:
        uploaded.save(dest_path)
        return jsonify({"status": "ok", "path": dest_path})
    except OSError as exc:
        return jsonify({"error": str(exc)}), 500


@app.route("/files/remote/upload-browser", methods=["POST"])
def remote_upload_browser():
    """Upload a file from the browser to a remote worker.

    Form data: addr, target_dir (absolute path on worker)
    File: file (multipart file upload)
    """
    addr = request.form.get("addr", "")
    target_dir = request.form.get("target_dir", "")

    if not addr:
        return jsonify({"error": "addr required"}), 400

    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400

    uploaded = request.files["file"]
    if not uploaded.filename:
        return jsonify({"error": "Empty filename"}), 400

    try:
        files = {"file": (uploaded.filename, uploaded.stream,
                          uploaded.content_type)}
        r = _worker_session.post(
            f"http://{addr}/files/upload",
            data={"path": target_dir},
            files=files,
            timeout=60,
        )
        return jsonify(r.json()), r.status_code
    except http_requests.RequestException as exc:
        return jsonify({"error": str(exc)}), 500


@app.route("/files/worker/upload", methods=["POST"])
def worker_upload():
    """Upload a local file to a worker.

    Form data: addr, rel_dir (target dir on worker), local_path (absolute path on master)
    """
    addr = request.form.get("addr", "")
    rel_dir = request.form.get("rel_dir", "")
    local_path = request.form.get("local_path", "")

    if not addr or not local_path:
        return jsonify({"error": "addr and local_path required"}), 400

    full_local = os.path.normpath(local_path)
    if not os.path.isfile(full_local):
        return jsonify({"error": "Local file not found"}), 404

    try:
        with open(full_local, "rb") as f:
            files = {"file": (os.path.basename(full_local), f)}
            r = _worker_session.post(
                f"http://{addr}/files/upload",
                data={"path": rel_dir},
                files=files,
                timeout=30,
            )
        return jsonify(r.json()), r.status_code
    except http_requests.RequestException as exc:
        return jsonify({"error": str(exc)}), 500


@app.route("/files/worker/read", methods=["GET"])
def worker_read():
    """Proxy: read a file on a worker for preview.

    Query params: ?addr=ip:port&path=absolute/path
    """
    addr = request.args.get("addr", "")
    file_path = request.args.get("path", "")
    if not addr or not file_path:
        return jsonify({"error": "addr and path required"}), 400
    try:
        r = _worker_session.get(
            f"http://{addr}/files/read",
            params={"path": file_path}, timeout=10
        )
        try:
            return jsonify(r.json()), r.status_code
        except ValueError:
            return jsonify({"error": "Worker returned non-JSON"}), 500
    except http_requests.RequestException as exc:
        return jsonify({"error": str(exc)}), 500


@app.route("/files/worker/write", methods=["POST"])
def worker_write():
    """Proxy: write file content on a worker.

    Request body: {"addr": "ip:port", "path": "absolute/path", "content": "..."}
    """
    data = request.get_json(force=True)
    addr = data.get("addr", "")
    file_path = data.get("path", "")
    content = data.get("content", "")
    if not addr or not file_path:
        return jsonify({"error": "addr and path required"}), 400
    try:
        r = _worker_session.post(
            f"http://{addr}/files/write",
            json={"path": file_path, "content": content},
            timeout=10,
        )
        return jsonify(r.json()), r.status_code
    except http_requests.RequestException as exc:
        return jsonify({"error": str(exc)}), 500


@app.route("/files/worker/delete", methods=["POST"])
def worker_delete():
    """Proxy: delete files on a worker.

    Request body: {"addr": "ip:port", "paths": ["abs/path1", ...]}
    """
    data = request.get_json(force=True)
    addr = data.get("addr", "")
    paths = data.get("paths", [])
    if not addr or not paths:
        return jsonify({"error": "addr and paths required"}), 400
    try:
        r = _worker_session.post(
            f"http://{addr}/files/delete",
            json={"paths": paths},
            timeout=10,
        )
        return jsonify(r.json()), r.status_code
    except http_requests.RequestException as exc:
        return jsonify({"error": str(exc)}), 500


@app.route("/sha1/history", methods=["GET"])
def sha1_history():
    """List all saved SHA1 computation results."""
    import json as jm
    sha1_dir = os.path.join(_base_dir, "sha1")
    if not os.path.isdir(sha1_dir):
        return jsonify({"records": []})
    records = []
    for fname in sorted(os.listdir(sha1_dir), reverse=True):
        if not fname.endswith('.json'):
            continue
        fpath = os.path.join(sha1_dir, fname)
        try:
            with open(fpath, "r", encoding="utf-8") as f:
                data = jm.load(f)
            # Extract timestamp from filename: sha1_YYYYMMDD_HHMMSS.json
            ts_part = fname.replace("sha1_", "").replace(".json", "")
            records.append({
                "filename": fname,
                "directory": data.get("directory", ""),
                "timestamp": ts_part,
                "file_count": len(data.get("results", [])),
            })
        except Exception:
            continue
    return jsonify({"records": records})


@app.route("/sha1/load", methods=["GET"])
def sha1_load():
    """Load a specific SHA1 result file.

    Query param: ?filename=sha1_20260518_063456.json
    """
    import json as jm
    filename = request.args.get("filename", "")
    sha1_dir = os.path.join(_base_dir, "sha1")
    fpath = os.path.join(sha1_dir, filename)
    if not os.path.isfile(fpath):
        return jsonify({"error": "File not found"}), 404
    with open(fpath, "r", encoding="utf-8") as f:
        return jsonify(jm.load(f))


@app.route("/sha1/compute", methods=["POST"])
def sha1_compute():
    """Compute SHA1 for all JSON files in a directory, or extract SHA1 from a PDF.

    Request body: {"path": "absolute/path/to/directory_or_pdf"}
    If path points to a .pdf file, extract SHA1 entries from the PDF content.
    Returns: {"results": [{"filename": str, "sha1": str}], "saved_to": str, "source": "directory"|"pdf"}
    """
    import hashlib as hl
    data = request.get_json(force=True)
    dir_path = data.get("path", "").strip()

    if not dir_path:
        return jsonify({"error": "Path is required"}), 400

    # Remove invisible Unicode characters (e.g. \u202a, \u200b from copy-paste)
    import re as _re
    dir_path = _re.sub(r'[\u200b\u200c\u200d\u200e\u200f\u202a\u202b\u202c\u202d\u202e\ufeff\u2060\u2061\u2062\u2063\u2064\u2066\u2067\u2068\u2069\u00a0]', '', dir_path)
    dir_path = dir_path.strip()

    # Normalize path for Windows compatibility
    dir_path = os.path.normpath(dir_path)

    # Check if path is a PDF file
    if dir_path.lower().endswith('.pdf'):
        if os.path.isfile(dir_path):
            return _compute_sha1_from_pdf(dir_path)
        else:
            return jsonify({"error": f"PDF file not found: {dir_path}"}), 404

    if not os.path.isdir(dir_path):
        return jsonify({"error": f"Directory not found: {dir_path}"}), 404

    results = []
    for root, dirs, files in os.walk(dir_path):
        dirs.sort()
        for fname in sorted(files):
            if not fname.lower().endswith('.json'):
                continue
            fpath = os.path.join(root, fname)
            rel_dir = os.path.relpath(root, dir_path)
            if rel_dir == '.':
                rel_dir = ''
            sha1 = hl.sha1(open(fpath, 'rb').read()).hexdigest().upper()
            results.append({"filename": fname, "subdir": rel_dir.replace("\\", "/"), "sha1": sha1})

    # Save results
    sha1_dir = os.path.join(_base_dir, "sha1")
    os.makedirs(sha1_dir, exist_ok=True)
    from datetime import datetime, timezone
    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    save_name = f"sha1_{ts}.json"
    save_path = os.path.join(sha1_dir, save_name)
    import json as jm
    with open(save_path, "w", encoding="utf-8") as f:
        jm.dump({"directory": dir_path, "results": results}, f, indent=2)

    return jsonify({"results": results, "saved_to": save_name, "source": "directory"})


def _compute_sha1_from_pdf(pdf_path: str):
    """Extract SHA1 entries from a PDF file.

    Looks for lines matching pattern: filename.json,SHA-1,<hex_hash>
    """
    import json as jm
    from datetime import datetime, timezone

    try:
        import pypdf
    except ImportError:
        try:
            import PyPDF2 as pypdf
        except ImportError:
            return jsonify({"error": "PDF library not installed. Please install pypdf: pip install pypdf"}), 500

    try:
        text = ""
        with open(pdf_path, "rb") as f:
            reader = pypdf.PdfReader(f)
            for page in reader.pages:
                page_text = page.extract_text()
                if page_text:
                    text += page_text + "\n"
    except Exception as exc:
        return jsonify({"error": f"Failed to read PDF: {exc}"}), 500

    # Parse SHA1 entries from PDF text
    # PDF contains a table with columns: File Name, Version, Location, Function, Digital Signature Type, Digital Signature
    # After text extraction, columns may be separated by spaces, tabs, or other whitespace
    import re
    results = []

    # Pattern 1: filename.json/jar followed by SHA-1 and a 40-char hex string
    # Handles comma-separated: filename.json,SHA-1,HEXHASH
    # Handles space-separated (from table extraction): filename.json ... SHA-1 ... HEXHASH
    pattern = re.compile(
        r'([A-Za-z0-9_\-\.]+\.(?:json|jar))\s*[,\s]\s*(?:N/A|v[\d\.]+)?\s*[,\s]\s*(?:Server|Client)?\s*[,\s]\s*(?:Game\s*(?:Configuration|Logic))?\s*[,\s]\s*SHA-?1\s*[,\s]\s*([0-9A-Fa-f]{40})',
        re.IGNORECASE
    )
    for match in pattern.finditer(text):
        filename = match.group(1)
        sha1_hash = match.group(2).upper()
        results.append({"filename": filename, "sha1": sha1_hash})

    # If pattern 1 didn't match, try a simpler pattern
    if not results:
        # Simpler: just find filename followed eventually by SHA-1 and hex hash on same line or nearby
        pattern2 = re.compile(
            r'([A-Za-z0-9_\-\.]+\.(?:json|jar))\b.*?SHA-?1\s*[,\s]*([0-9A-Fa-f]{40})',
            re.IGNORECASE
        )
        for match in pattern2.finditer(text):
            filename = match.group(1)
            sha1_hash = match.group(2).upper()
            results.append({"filename": filename, "sha1": sha1_hash})

    # If still no results, try finding SHA-1 hash near filenames across lines
    if not results:
        # Find all filenames and all hashes, then pair them by order
        filenames = re.findall(r'([A-Za-z0-9_\-\.]+\.(?:json|jar))\b', text)
        hashes = re.findall(r'\b([0-9A-Fa-f]{40})\b', text)
        if filenames and hashes and len(filenames) == len(hashes):
            for fname, h in zip(filenames, hashes):
                results.append({"filename": fname, "sha1": h.upper()})

    if not results:
        # Return extracted text snippet for debugging
        text_preview = text[:500].replace('\n', '\\n') if text else "(empty)"
        return jsonify({"error": f"No SHA1 entries found in PDF. Extracted text preview: {text_preview}"}), 400

    # Save results
    sha1_dir = os.path.join(_base_dir, "sha1")
    os.makedirs(sha1_dir, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    save_name = f"sha1_{ts}.json"
    save_path = os.path.join(sha1_dir, save_name)
    with open(save_path, "w", encoding="utf-8") as f:
        jm.dump({"directory": pdf_path, "results": results}, f, indent=2)

    return jsonify({"results": results, "saved_to": save_name, "source": "pdf"})


@app.route("/family/images", methods=["GET"])
def family_images():
    """List all images in static/family directory."""
    family_dir = os.path.join(app.static_folder, "family")
    if not os.path.isdir(family_dir):
        return jsonify({"images": []})
    images = [f for f in os.listdir(family_dir)
              if f.lower().endswith(('.png', '.jpg', '.jpeg', '.gif', '.webp'))]
    return jsonify({"images": images})


@app.route("/history/page")
def history_page():
    """Render the history replay page."""
    return render_template("history.html")


@app.route("/workers/health", methods=["GET"])
def workers_health():
    """Check if each worker is online by pinging /status."""
    results = {}
    for w in config.workers:
        addr = w["addr"]
        try:
            r = _worker_session.get(f"http://{addr}/status", timeout=2)
            results[addr] = r.status_code == 200
        except Exception:
            results[addr] = False
    return jsonify(results)


# ---------------------------------------------------------------------------
# Launcher proxy (start/stop worker.exe on a remote worker machine)
# ---------------------------------------------------------------------------
def _launcher_addr(worker_addr: str) -> str:
    """Derive the launcher's address from a worker's addr (same host, launcher_port)."""
    host = worker_addr.split(":")[0]
    launcher_port = _raw_config.get("launcher_port", 5099)
    return f"{host}:{launcher_port}"


def _launcher_headers() -> dict:
    """Build request headers for calling the launcher, including auth token if configured."""
    token = _raw_config.get("launcher_auth_token", "")
    return {"X-Launcher-Token": token} if token else {}


@app.route("/workers/launcher-status", methods=["GET"])
def launcher_status():
    """Query whether worker.exe is currently running on a remote worker, via its Launcher."""
    addr = request.args.get("addr", "")
    if not addr or addr == "master":
        return jsonify({"error": "addr (worker addr) is required"}), 400
    launcher_addr = _launcher_addr(addr)
    try:
        r = _worker_session.get(
            f"http://{launcher_addr}/launcher/status",
            headers=_launcher_headers(),
            timeout=5,
        )
        try:
            return jsonify(r.json()), r.status_code
        except ValueError:
            return jsonify({"error": "Launcher returned non-JSON"}), 502
    except http_requests.ConnectionError:
        return jsonify({"error": f"Cannot reach launcher at {launcher_addr}. Is it running?"}), 503
    except http_requests.Timeout:
        return jsonify({"error": f"Connection to launcher {launcher_addr} timed out"}), 504
    except http_requests.RequestException as exc:
        return jsonify({"error": str(exc)}), 500


@app.route("/workers/launcher-start", methods=["POST"])
def launcher_start_worker():
    """Ask the Launcher on a remote worker machine to start worker.exe."""
    data = request.get_json(force=True)
    addr = data.get("addr", "")
    if not addr or addr == "master":
        return jsonify({"error": "addr (worker addr) is required"}), 400
    launcher_addr = _launcher_addr(addr)
    try:
        r = _worker_session.post(
            f"http://{launcher_addr}/launcher/start-worker",
            headers=_launcher_headers(),
            timeout=15,
        )
        try:
            return jsonify(r.json()), r.status_code
        except ValueError:
            return jsonify({"error": "Launcher returned non-JSON"}), 502
    except http_requests.ConnectionError:
        return jsonify({"error": f"Cannot reach launcher at {launcher_addr}. Is it running?"}), 503
    except http_requests.Timeout:
        return jsonify({"error": f"Connection to launcher {launcher_addr} timed out"}), 504
    except http_requests.RequestException as exc:
        return jsonify({"error": str(exc)}), 500


@app.route("/workers/launcher-stop", methods=["POST"])
def launcher_stop_worker():
    """Ask the Launcher on a remote worker machine to stop worker.exe."""
    data = request.get_json(force=True)
    addr = data.get("addr", "")
    if not addr or addr == "master":
        return jsonify({"error": "addr (worker addr) is required"}), 400
    launcher_addr = _launcher_addr(addr)
    try:
        r = _worker_session.post(
            f"http://{launcher_addr}/launcher/stop-worker",
            headers=_launcher_headers(),
            timeout=15,
        )
        try:
            return jsonify(r.json()), r.status_code
        except ValueError:
            return jsonify({"error": "Launcher returned non-JSON"}), 502
    except http_requests.ConnectionError:
        return jsonify({"error": f"Cannot reach launcher at {launcher_addr}. Is it running?"}), 503
    except http_requests.Timeout:
        return jsonify({"error": f"Connection to launcher {launcher_addr} timed out"}), 504
    except http_requests.RequestException as exc:
        return jsonify({"error": str(exc)}), 500


@app.route("/sysinfo", methods=["GET"])
def master_sysinfo():
    """Return master's local system info."""
    try:
        import psutil
    except ImportError:
        return jsonify({"error": "psutil not installed"}), 500
    cpu_pct = psutil.cpu_percent(interval=0.5)
    mem = psutil.virtual_memory()
    return jsonify({
        "cpu_percent": cpu_pct,
        "cpu_count": psutil.cpu_count(),
        "mem_total_mb": round(mem.total / 1024 / 1024),
        "mem_used_mb": round(mem.used / 1024 / 1024),
        "mem_percent": mem.percent,
    })


@app.route("/files/worker/sysinfo", methods=["GET"])
def worker_sysinfo_proxy():
    """Proxy sysinfo request to a worker."""
    addr = request.args.get("addr", "")
    if not addr:
        return jsonify({"error": "addr is required"}), 400
    try:
        r = _worker_session.get(f"http://{addr}/sysinfo", timeout=5)
        if r.status_code == 200:
            try:
                return jsonify(r.json()), 200
            except ValueError:
                return jsonify({"error": f"Worker {addr} returned invalid response"}), 502
        else:
            return jsonify({"error": f"Worker {addr} returned status {r.status_code}"}), r.status_code
    except http_requests.ConnectionError:
        return jsonify({"error": f"Cannot connect to worker {addr}. Is it running?"}), 503
    except http_requests.Timeout:
        return jsonify({"error": f"Connection to {addr} timed out"}), 504
    except http_requests.RequestException as exc:
        return jsonify({"error": str(exc)}), 500


@app.route("/sysinfo/all", methods=["GET"])
def all_sysinfo():
    """Collect system info from master + all workers."""
    import psutil
    results = {}
    # Master local
    cpu_pct = psutil.cpu_percent(interval=0.5)
    mem = psutil.virtual_memory()
    results["master"] = {
        "cpu_percent": cpu_pct,
        "cpu_count": psutil.cpu_count(),
        "mem_total_mb": round(mem.total / 1024 / 1024),
        "mem_used_mb": round(mem.used / 1024 / 1024),
        "mem_percent": mem.percent,
    }
    # Workers
    for w in config.workers:
        addr = w["addr"]
        try:
            r = _worker_session.get(f"http://{addr}/sysinfo", timeout=3)
            results[addr] = r.json()
        except Exception as exc:
            results[addr] = {"error": str(exc)}
    return jsonify(results)


# ---------------------------------------------------------------------------
# CICD Module
# ---------------------------------------------------------------------------
CICD_VIEW_PATH = os.path.join(_base_dir, "cicd", "user_cicd_view.json")
CICD_SETTING_PATH = os.path.join(_base_dir, "cicd", "user_cicd_setting.json")
CICD_CONFIG_PATH = os.path.join(_base_dir, "cicd", "config.json")
CICD_LOGS_DIR = os.path.join(_base_dir, "cicd", "logs")


def _load_cicd_config():
    """Load CICD global config (max_builds, max_days)."""
    if not os.path.isfile(CICD_CONFIG_PATH):
        return {"max_builds": 50, "max_days": 30}
    with open(CICD_CONFIG_PATH, "r", encoding="utf-8") as f:
        return json_module.load(f)


def _get_cicd_username():
    """Get current logged-in username for CICD per-user data."""
    return session.get("username", "admin")


def _load_cicd_all():
    """Load the full user_cicd_view.json array."""
    if not os.path.isfile(CICD_VIEW_PATH):
        return []
    with open(CICD_VIEW_PATH, "r", encoding="utf-8") as f:
        return json_module.load(f)


def _save_cicd_all(data):
    os.makedirs(os.path.dirname(CICD_VIEW_PATH), exist_ok=True)
    with open(CICD_VIEW_PATH, "w", encoding="utf-8") as f:
        json_module.dump(data, f, ensure_ascii=False, indent=2)


def _load_cicd():
    """Load CICD data for current user. Returns {"views": [], "items": []}."""
    username = _get_cicd_username()
    all_data = _load_cicd_all()
    for entry in all_data:
        if entry.get("username") == username:
            return {"views": entry.get("views", []), "items": entry.get("items", [])}
    return {"views": [], "items": []}


def _save_cicd(data):
    """Save CICD data for current user."""
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
    """Load all user settings."""
    if not os.path.isfile(CICD_SETTING_PATH):
        return []
    with open(CICD_SETTING_PATH, "r", encoding="utf-8") as f:
        return json_module.load(f)


def _save_cicd_settings(data):
    os.makedirs(os.path.dirname(CICD_SETTING_PATH), exist_ok=True)
    with open(CICD_SETTING_PATH, "w", encoding="utf-8") as f:
        json_module.dump(data, f, ensure_ascii=False, indent=2)


def _get_user_settings():
    """Get settings for current user."""
    username = _get_cicd_username()
    all_settings = _load_cicd_settings()
    for entry in all_settings:
        if entry.get("username") == username:
            return entry.get("setting", {})
    return {}


def _save_user_settings(setting):
    """Save settings for current user."""
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
    """Save a build's console log to an individual file."""
    log_dir = os.path.join(CICD_LOGS_DIR, username, item_name)
    os.makedirs(log_dir, exist_ok=True)
    log_path = os.path.join(log_dir, f"build_{build_number}.log")
    with open(log_path, "w", encoding="utf-8") as f:
        f.write(log_content)


def _load_build_log(username, item_name, build_number):
    """Load a build's console log from file."""
    log_path = os.path.join(CICD_LOGS_DIR, username, item_name, f"build_{build_number}.log")
    if os.path.isfile(log_path):
        with open(log_path, "r", encoding="utf-8") as f:
            return f.read()
    return None


def _cleanup_old_builds(username):
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
            # Remove builds older than max_days
            filtered = []
            for b in history:
                ts = b.get("timestamp", "")
                if ts:
                    try:
                        build_time = datetime.strptime(ts, "%Y-%m-%d %H:%M:%S")
                        if build_time < cutoff_date:
                            # Delete the log file too
                            log_path = os.path.join(CICD_LOGS_DIR, username, item["name"], f"build_{b['number']}.log")
                            if os.path.isfile(log_path):
                                os.remove(log_path)
                            continue
                    except ValueError:
                        pass
                filtered.append(b)
            # Keep only max_builds most recent
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


@app.route("/cicd/views", methods=["GET"])
def cicd_list_views():
    """List all CICD views."""
    data = _load_cicd()
    return jsonify({"views": data.get("views", [])})


@app.route("/cicd/views", methods=["POST"])
def cicd_create_view():
    """Create a new CICD view."""
    req = request.get_json(force=True)
    name = req.get("name", "").strip()
    parent = req.get("parent", "")  # parent view name, empty = top-level
    if not name:
        return jsonify({"error": "View name is required"}), 400
    data = _load_cicd()
    # Check duplicate
    for v in data["views"]:
        if v["name"] == name and v.get("parent", "") == parent:
            return jsonify({"error": "View already exists"}), 409
    data["views"].append({"name": name, "parent": parent, "items": req.get("items", [])})
    _save_cicd(data)
    return jsonify({"status": "ok", "views": data["views"]})


@app.route("/cicd/views/update", methods=["POST"])
def cicd_update_view():
    """Update a view (e.g. add/remove items)."""
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


@app.route("/cicd/views/delete", methods=["POST"])
def cicd_delete_view():
    """Delete a view."""
    req = request.get_json(force=True)
    name = req.get("name", "").strip()
    parent = req.get("parent", "")
    data = _load_cicd()
    data["views"] = [v for v in data["views"] if not (v["name"] == name and v.get("parent", "") == parent)]
    _save_cicd(data)
    return jsonify({"status": "ok"})


@app.route("/cicd/items", methods=["GET"])
def cicd_list_items():
    """List all CICD items, optionally filtered by parent view."""
    parent = request.args.get("parent", "")
    data = _load_cicd()
    items = data.get("items", [])
    if parent:
        # Filter items belonging to this parent view
        view = None
        for v in data.get("views", []):
            if v["name"] == parent:
                view = v
                break
        if view:
            view_item_names = view.get("items", [])
            items = [i for i in items if i["name"] in view_item_names]
    return jsonify({"items": items})


@app.route("/cicd/items", methods=["POST"])
def cicd_create_item():
    """Create a new CICD item (freestyle project)."""
    req = request.get_json(force=True)
    name = req.get("name", "").strip()
    item_type = req.get("type", "freestyle")
    parent_view = req.get("parent_view", "")
    if not name:
        return jsonify({"error": "Item name is required"}), 400
    data = _load_cicd()
    # Check duplicate
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
    # If parent_view specified, add to that view's items list
    if parent_view:
        for v in data["views"]:
            if v["name"] == parent_view:
                if name not in v.get("items", []):
                    v.setdefault("items", []).append(name)
                break
    _save_cicd(data)
    return jsonify({"status": "ok", "item": item})


@app.route("/cicd/items/get", methods=["GET"])
def cicd_get_item():
    """Get a single CICD item by name."""
    name = request.args.get("name", "")
    parent_view = request.args.get("parent_view", "")
    data = _load_cicd()
    # Try exact match first
    for i in data["items"]:
        if i["name"] == name and i.get("parent_view", "") == parent_view:
            return jsonify({"item": i})
    # Fallback: match by name only
    for i in data["items"]:
        if i["name"] == name:
            return jsonify({"item": i})
    return jsonify({"error": "Item not found"}), 404


@app.route("/cicd/items/update", methods=["POST"])
def cicd_update_item():
    """Update a CICD item configuration."""
    req = request.get_json(force=True)
    name = req.get("name", "").strip()
    parent_view = req.get("parent_view", "")

    # Validate dangerous commands in build_steps and post_build
    dangerous_patterns = ["rm -rf", "rm -r", "rmdir /s", "del /f", "format ", "mkfs.", "dd if="]
    for steps_key in ["build_steps", "post_build"]:
        steps = req.get(steps_key, [])
        for step in steps:
            if step.get("type") == "ssh":
                cmd = step.get("config", {}).get("exec_command", "").strip()
                if cmd:
                    # Check each line independently
                    for line in cmd.splitlines():
                        line_lower = line.strip().lower()
                        if not line_lower:
                            continue
                        # Check if line is exactly "rm" or starts with "rm " or "rm;"
                        if line_lower == "rm" or line_lower.startswith("rm ") or line_lower.startswith("rm;"):
                            return jsonify({"error": f"Dangerous command 'rm' detected in {steps_key}. Forbidden for safety."}), 400
                        for dp in dangerous_patterns:
                            if dp in line_lower:
                                return jsonify({"error": f"Dangerous command '{dp.strip()}' detected in {steps_key}. Forbidden for safety."}), 400
                        # Also check commands chained with && or ; or |
                        parts = line_lower.replace("&&", ";").replace("|", ";").split(";")
                        for part in parts:
                            part = part.strip()
                            if part == "rm" or part.startswith("rm "):
                                return jsonify({"error": f"Dangerous command 'rm' detected in {steps_key}. Forbidden for safety."}), 400

    data = _load_cicd()
    found = False
    # Try exact match first (name + parent_view)
    for i in data["items"]:
        if i["name"] == name and i.get("parent_view", "") == parent_view:
            for key in ["enabled", "description", "scm", "triggers", "environment", "build_steps", "post_build", "parameters", "trigger_token"]:
                if key in req:
                    i[key] = req[key]
            found = True
            break
    # Fallback: match by name only
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


@app.route("/cicd/items/delete", methods=["POST"])
def cicd_delete_item():
    """Delete a CICD item."""
    req = request.get_json(force=True)
    name = req.get("name", "").strip()
    parent_view = req.get("parent_view", "")
    data = _load_cicd()
    data["items"] = [i for i in data["items"] if not (i["name"] == name and i.get("parent_view", "") == parent_view)]
    # Remove from views
    for v in data["views"]:
        if name in v.get("items", []):
            v["items"].remove(name)
    _save_cicd(data)
    return jsonify({"status": "ok"})


@app.route("/cicd/items/run", methods=["POST"])
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
    # Try exact match first
    for i in data["items"]:
        if i["name"] == name and i.get("parent_view", "") == parent_view:
            item = i
            break
    # Fallback: match by name only
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
            # Send files or execute commands over SSH
            ssh_config = step.get("config", {})
            server_name = ssh_config.get("hostname", "")  # This is actually the SSH server name from settings
            remote_dir = ssh_config.get("remote_directory", "")
            exec_command = ssh_config.get("exec_command", "")
            source_files = ssh_config.get("source_files", "")

            # Look up SSH server details from user settings
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

            # Global disable_exec overrides everything
            if global_disable_exec and exec_command:
                results.append({"step": step_type, "success": False, "output": "Exec commands are disabled globally in settings (Disable exec is checked). Build failed."})
                continue

            # Check for dangerous commands
            if exec_command:
                dangerous_patterns = ["rm -rf", "rm -r", "rmdir /s", "del /f", "format ", "mkfs.", "dd if="]
                is_dangerous = False
                for line in exec_command.splitlines():
                    line_lower = line.strip().lower()
                    if not line_lower:
                        continue
                    if line_lower == "rm" or line_lower.startswith("rm ") or line_lower.startswith("rm;"):
                        is_dangerous = True
                        break
                    for dp in dangerous_patterns:
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
            # Use server-local key if configured, otherwise use global key
            srv_key_path = server_info.get("key_path", "")
            srv_key_content = server_info.get("key_content", "")
            srv_passphrase = server_info.get("passphrase", "")
            key_path = srv_key_path if srv_key_path else ssh_key_config.get("path_to_key", "")
            key_content = srv_key_content if srv_key_content else ssh_key_config.get("key_content", "")
            passphrase = srv_passphrase if srv_passphrase else ssh_key_config.get("passphrase", "")
            # Use server remote_directory as default if step doesn't specify one
            if not remote_dir:
                remote_dir = server_info.get("remote_directory", "")

            try:
                import io as _io
                client = paramiko.SSHClient()
                client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
                connect_kwargs = {"hostname": hostname, "port": port, "username": username, "timeout": 30}
                # Priority: key_content > key_path > agent
                if key_content:
                    # Load private key from string content
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

                # Transfer files if specified
                if source_files:
                    sftp = client.open_sftp()
                    for src in source_files.split(","):
                        src = src.strip()
                        if src and os.path.isfile(src):
                            remote_path = remote_dir.rstrip("/") + "/" + os.path.basename(src) if remote_dir else os.path.basename(src)
                            sftp.put(src, remote_path)
                            output_lines.append(f"Transferred: {src} -> {remote_path}")
                    sftp.close()

                # Execute command if specified
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

    # Record build history
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

    # Save console log to individual file
    username = _get_cicd_username()
    log_lines = []
    log_lines.append(f"Started by user {username}")
    log_lines.append(f"Running as SYSTEM")
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
            log_lines.append(f"SSH: Disconnecting configuration ...")
            log_lines.append("")
    log_lines.append(f"Finished: {'SUCCESS' if all_success else 'UNSTABLE'}")
    _save_build_log(username, name, build_number, "\n".join(log_lines))

    return jsonify({"status": "ok" if all_success else "error", "build": build_record})


@app.route("/cicd/build-log", methods=["GET"])
def cicd_build_log():
    """Get console log for a specific build."""
    item_name = request.args.get("item", "")
    build_number = request.args.get("build", 0, type=int)
    username = _get_cicd_username()
    log = _load_build_log(username, item_name, build_number)
    if log is None:
        return jsonify({"error": "Log not found"}), 404
    return jsonify({"log": log})


@app.route("/cicd/nodes", methods=["GET"])
def cicd_nodes():
    """Get available nodes (master + workers) for CICD SSH targets."""
    nodes = [{"name": "master(local)", "addr": "master"}]
    for w in config.workers:
        alias = w.get("alias", "")
        name = alias if alias else w["addr"]
        nodes.append({"name": name, "addr": w["addr"]})
    return jsonify({"nodes": nodes})


@app.route("/cicd/nodes/health", methods=["GET"])
def cicd_nodes_health():
    """Check health of all nodes for SSH server dropdown."""
    health = {"master": True}  # master is always available
    for w in config.workers:
        addr = w["addr"]
        try:
            r = _worker_session.get(f"http://{addr}/status", timeout=2)
            health[addr] = r.status_code == 200
        except Exception:
            health[addr] = False
    return jsonify({"health": health})


@app.route("/cicd/settings", methods=["GET"])
def cicd_get_settings():
    """Get CICD settings for current user."""
    setting = _get_user_settings()
    return jsonify({"setting": setting})


@app.route("/cicd/settings", methods=["POST"])
def cicd_save_settings():
    """Save CICD settings for current user."""
    req = request.get_json(force=True)
    setting = req.get("setting", {})
    _save_user_settings(setting)
    return jsonify({"status": "ok"})


@app.route("/cicd/settings/ssh-servers", methods=["GET"])
def cicd_get_ssh_servers():
    """Get SSH servers list from current user's settings."""
    setting = _get_user_settings()
    servers = setting.get("ssh_servers", [])
    return jsonify({"ssh_servers": servers})


@app.route("/cicd/settings/test-ssh", methods=["POST"])
def cicd_test_ssh():
    """Test SSH connection to a server."""
    try:
        import paramiko
    except ImportError:
        return jsonify({"error": "paramiko not installed"}), 500

    req = request.get_json(force=True)
    hostname = req.get("hostname", "")
    port = int(req.get("port", 22))
    username = req.get("username", "")

    # Get SSH key from user settings
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


# ---------------------------------------------------------------------------
# Play Module (Game Lobby + WebSocket Proxy to Java Server)
# ---------------------------------------------------------------------------
PLAY_MAIN_PATH = os.path.join(_base_dir, "data", "machine", "main.json")
_ws_connections = {}  # {session_token: websocket_connection}


def _load_play_config():
    if not os.path.isfile(PLAY_MAIN_PATH):
        return {"machine_settings": {"authorization": "", "machines": []}}
    with open(PLAY_MAIN_PATH, "r", encoding="utf-8") as f:
        return json_module.load(f)


@app.route("/play/auth", methods=["GET"])
def play_auth_get():
    """Get current authorization token and currency from main.json."""
    config_data = _load_play_config()
    settings = config_data.get("machine_settings", {})
    return jsonify({
        "authorization": settings.get("authorization", ""),
        "currency": settings.get("currency", ""),
    })


@app.route("/play/auth", methods=["POST"])
def play_auth_update():
    """Update authorization token and/or currency in main.json."""
    data = request.get_json(force=True)
    token = data.get("authorization", "").strip()
    currency = data.get("currency", "").strip()

    if not token and not currency:
        return jsonify({"error": "authorization or currency is required"}), 400

    config_data = _load_play_config()
    if "machine_settings" not in config_data:
        config_data["machine_settings"] = {}

    if token:
        config_data["machine_settings"]["authorization"] = token
        # Also update connection_url for each machine that uses authorization param
        machines = config_data["machine_settings"].get("machines", [])
        for m in machines:
            conn_url = m.get("connection_url", "")
            if "authorization=" in conn_url:
                import re as _re
                m["connection_url"] = _re.sub(
                    r'authorization=[^&]*',
                    'authorization=' + token,
                    conn_url
                )

    if currency:
        config_data["machine_settings"]["currency"] = currency

    with open(PLAY_MAIN_PATH, "w", encoding="utf-8") as f:
        json_module.dump(config_data, f, ensure_ascii=False, indent=2)
    return jsonify({"success": True})


@app.route("/play/machines", methods=["GET"])
def play_machines():
    """Get list of machines for the game lobby."""
    config_data = _load_play_config()
    machines = config_data.get("machine_settings", {}).get("machines", [])
    return jsonify({"machines": machines})


@app.route("/play/machine-config", methods=["GET"])
def play_machine_config():
    """Get machine config (patterns, card info) from config_file."""
    machine_id = request.args.get("machine_id", 0, type=int)
    config_data = _load_play_config()
    machines = config_data.get("machine_settings", {}).get("machines", [])
    machine = None
    for m in machines:
        if m.get("machine_id") == machine_id:
            machine = m
            break
    if not machine:
        return jsonify({"error": "Machine not found"}), 404

    config_file = machine.get("config_file", "")
    if not config_file:
        return jsonify({"error": "No config_file specified"}), 400

    config_path = os.path.join(_base_dir, "data", "machine", config_file)
    if not os.path.isfile(config_path):
        return jsonify({"error": f"Config file not found: {config_file}"}), 404

    with open(config_path, "r", encoding="utf-8") as f:
        machine_config = json_module.load(f)
    return jsonify({"config": machine_config})


@app.route("/play/login", methods=["POST"])
def play_login():
    """Return machine config for client-side WebSocket connection.

    Browser connects directly to Java server via WebSocket.
    This endpoint only returns connection_url, auth, machine config.
    """
    data = request.get_json(force=True)
    machine_id = data.get("machine_id")

    config_data = _load_play_config()
    settings = config_data.get("machine_settings", {})
    auth_token = settings.get("authorization", "")
    currency = settings.get("currency", "coins")
    machines = settings.get("machines", [])

    machine = None
    for m in machines:
        if m.get("machine_id") == machine_id:
            machine = m
            break
    if not machine:
        return jsonify({"error": f"Machine {machine_id} not found"}), 404
    if not machine.get("enabled"):
        return jsonify({"error": "Machine is not enabled"}), 403

    # Build connection URL with auth token override
    conn_url = machine.get("connection_url", "")
    if auth_token and "authorization=" in conn_url:
        import re
        conn_url = re.sub(r'authorization=[^&]*', f'authorization={auth_token}', conn_url)

    # Load machine config file
    machine_config = {}
    config_file = machine.get("config_file", "")
    if config_file:
        config_path = os.path.join(_base_dir, "data", "machine", config_file)
        if os.path.isfile(config_path):
            with open(config_path, "r", encoding="utf-8") as f:
                machine_config = json_module.load(f)

    return jsonify({
        "status": "ok",
        "connection_url": conn_url,
        "authorization": auth_token,
        "currency": currency,
        "machine_id": machine_id,
        "machine_type": machine.get("type", "bingo"),
        "machine_name": machine.get("name", ""),
        "machine_entry": machine,
        "config": machine_config
    })


@app.route("/play/send", methods=["POST"])
def play_send():
    """Send a generic command to an active WebSocket connection (slot games)."""
    data = request.get_json(force=True)
    session_token = data.get("session_token", "")
    cmd = data.get("cmd", {})

    if not session_token or session_token not in _ws_connections:
        return jsonify({"error": "No active session. Please login first."}), 400

    ws = _ws_connections[session_token]
    try:
        ws.send(json_module.dumps(cmd))
        response = ws.recv()
        return jsonify({"status": "ok", "response": json_module.loads(response)})
    except Exception as exc:
        try:
            ws.close()
        except Exception:
            pass
        del _ws_connections[session_token]
        return jsonify({"error": f"Send failed: {str(exc)}"}), 500


@app.route("/play/bingo/spin", methods=["POST"])
def play_bingo_spin():
    """Send bingo spin (solicitajogada) command."""
    data = request.get_json(force=True)
    session_token = data.get("session_token", "")
    if not session_token or session_token not in _ws_connections:
        return jsonify({"error": "No active session."}), 400

    play_cfg = _load_play_config()
    currency = play_cfg.get("machine_settings", {}).get("currency", "coins")

    cmd = {
        "cmd": "solicitajogada",
        "session_token": session_token,
        "game_id": data.get("game_id"),
        "currency": currency,
        "opt_id": data.get("opt_id", ""),
        "username": data.get("username", ""),
        "aposta": data.get("aposta", 0.01),
        "card_idx": data.get("card_idx", [1, 2, 3, 4]),
        "bonus_unique_id": "",
        "is_bonus": False,
        "target_pattern_ids": [],
        "target_feature_ids": [],
        "payload_data": "[{'key':'value'}]"
    }

    ws = _ws_connections[session_token]
    try:
        ws.send(json_module.dumps(cmd))
        # Read responses, skip async messages (Jackpot_update etc.) until we get the spin result
        for _ in range(10):
            response = ws.recv()
            resp_data = json_module.loads(response)
            if resp_data.get("cmd") == "solicitajogada" or "balls" in resp_data or "finalizou" in resp_data:
                return jsonify({"status": "ok", "response": resp_data})
            # Skip async messages like Jackpot_update
        return jsonify({"status": "ok", "response": resp_data})
    except Exception as exc:
        try:
            ws.close()
        except Exception:
            pass
        del _ws_connections[session_token]
        return jsonify({"error": f"Spin failed: {str(exc)}"}), 500


@app.route("/play/bingo/roundover", methods=["POST"])
def play_bingo_roundover():
    """Send bingo round over (finalizajogada) command."""
    data = request.get_json(force=True)
    session_token = data.get("session_token", "")
    if not session_token or session_token not in _ws_connections:
        return jsonify({"error": "No active session."}), 400

    play_cfg = _load_play_config()
    currency = play_cfg.get("machine_settings", {}).get("currency", "coins")

    cmd = {
        "cmd": "finalizajogada",
        "session_token": session_token,
        "game_id": data.get("game_id"),
        "currency": currency,
        "opt_id": data.get("opt_id", ""),
        "username": data.get("username", ""),
        "bonus_unique_id": "",
        "is_bonus": False,
        "finalizar": True,
        "payload_data": "[{'key':'value'}]"
    }

    ws = _ws_connections[session_token]
    try:
        ws.send(json_module.dumps(cmd))
        for _ in range(10):
            response = ws.recv()
            resp_data = json_module.loads(response)
            if resp_data.get("cmd") == "finalizajogada" or "letra" in resp_data:
                return jsonify({"status": "ok", "response": resp_data})
        return jsonify({"status": "ok", "response": resp_data})
    except Exception as exc:
        try:
            ws.close()
        except Exception:
            pass
        del _ws_connections[session_token]
        return jsonify({"error": f"Round over failed: {str(exc)}"}), 500


@app.route("/play/bingo/buyeb", methods=["POST"])
def play_bingo_buyeb():
    """Send bingo buy extra ball command."""
    data = request.get_json(force=True)
    session_token = data.get("session_token", "")
    if not session_token or session_token not in _ws_connections:
        return jsonify({"error": "No active session."}), 400

    play_cfg = _load_play_config()
    currency = play_cfg.get("machine_settings", {}).get("currency", "coins")

    cmd = {
        "cmd": "solicitajogada",
        "session_token": session_token,
        "game_id": data.get("game_id"),
        "currency": currency,
        "opt_id": data.get("opt_id", ""),
        "username": data.get("username", ""),
        "bonus_unique_id": "",
        "is_bonus": False,
        "payload_data": "[{'key':'value'}]"
    }

    ws = _ws_connections[session_token]
    try:
        ws.send(json_module.dumps(cmd))
        for _ in range(10):
            response = ws.recv()
            resp_data = json_module.loads(response)
            if resp_data.get("cmd") == "solicitajogada" or "extra" in resp_data or "has_extra_ball" in resp_data:
                return jsonify({"status": "ok", "response": resp_data})
        return jsonify({"status": "ok", "response": resp_data})
    except Exception as exc:
        try:
            ws.close()
        except Exception:
            pass
        del _ws_connections[session_token]
        return jsonify({"error": f"Buy EB failed: {str(exc)}"}), 500


@app.route("/play/disconnect", methods=["POST"])
def play_disconnect():
    """Close an active WebSocket connection."""
    data = request.get_json(force=True)
    session_token = data.get("session_token", "")

    if session_token in _ws_connections:
        try:
            _ws_connections[session_token].close()
        except Exception:
            pass
        del _ws_connections[session_token]
    return jsonify({"status": "ok"})


# ---------------------------------------------------------------------------
# IAM Routes
# ---------------------------------------------------------------------------
ROLE_PATH = os.path.join(_base_dir, "iam", "role.json")
AUTHORITY_PATH = os.path.join(_base_dir, "iam", "authority.json")
RESOURCES_PATH = os.path.join(_base_dir, "iam", "resources.json")


def _load_roles():
    if not os.path.isfile(ROLE_PATH):
        return []
    with open(ROLE_PATH, "r", encoding="utf-8") as f:
        return json_module.load(f)


def _load_authorities():
    if not os.path.isfile(AUTHORITY_PATH):
        return []
    with open(AUTHORITY_PATH, "r", encoding="utf-8") as f:
        return json_module.load(f)


def _load_resources():
    if not os.path.isfile(RESOURCES_PATH):
        return ["Home", "Workers", "Config", "History", "MD5", "SHA1", "Plugin", "CICD", "Play", "IAM", "Family"]
    with open(RESOURCES_PATH, "r", encoding="utf-8") as f:
        return json_module.load(f)


def _save_resources(resources):
    with open(RESOURCES_PATH, "w", encoding="utf-8") as f:
        json_module.dump(resources, f, ensure_ascii=False, indent=2)


@app.route("/iam/users", methods=["GET"])
def iam_users():
    """Get all users (without password hash)."""
    users = _load_users()
    return jsonify({"users": [{"username": u["username"], "role": u["role"]} for u in users]})


@app.route("/iam/users/update", methods=["POST"])
def iam_users_update():
    """Update a user's password and/or role.

    Request body: {"username": str, "password"?: str, "role"?: str}
    """
    data = request.get_json(force=True)
    target_username = data.get("username", "")
    new_password = data.get("password", "")
    new_role = data.get("role", "")

    if not target_username:
        return jsonify({"error": "username is required"}), 400

    # Prevent changing admin's role
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

    # If the user's role changed and they are currently logged in, update their session role
    if new_role and session.get('username') == target_username:
        session['role'] = new_role

    return jsonify({"status": "ok"})


@app.route("/iam/users/delete", methods=["POST"])
def iam_users_delete():
    """Delete a user.

    Request body: {"username": str}
    """
    data = request.get_json(force=True)
    target_username = data.get("username", "")

    if not target_username:
        return jsonify({"error": "username is required"}), 400

    # Prevent deleting admin
    if target_username == "admin":
        return jsonify({"error": "Cannot delete admin user"}), 403

    users = _load_users()
    new_users = [u for u in users if u["username"] != target_username]
    if len(new_users) == len(users):
        return jsonify({"error": "User not found"}), 404

    _save_users(new_users)
    return jsonify({"status": "ok"})


@app.route("/iam/users/create", methods=["POST"])
def iam_users_create():
    """Create a new user.

    Request body: {"username": str, "password": str, "role": str}
    """
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


@app.route("/iam/roles", methods=["GET"])
def iam_roles():
    """Get all roles."""
    roles = _load_roles()
    return jsonify({"roles": roles})


@app.route("/iam/roles/update", methods=["POST"])
def iam_roles_update():
    """Update a role's authorities (supports multiple authorities).

    Request body: {"role": str, "authorities": [str, ...]}
    """
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
            # Store as comma-separated string for backward compat, or as the first authority
            # Actually store as a list joined by comma
            r["authority"] = ",".join(new_authorities)
            found = True
            break

    if not found:
        return jsonify({"error": "Role not found"}), 404

    with open(ROLE_PATH, "w", encoding="utf-8") as f:
        json_module.dump(roles, f, ensure_ascii=False, indent=2)

    return jsonify({"status": "ok"})


@app.route("/iam/roles/create", methods=["POST"])
def iam_roles_create():
    """Create a new role.

    Request body: {"role": str, "authority": str}
    """
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
        json_module.dump(roles, f, ensure_ascii=False, indent=2)

    return jsonify({"status": "ok"})


@app.route("/iam/roles/delete", methods=["POST"])
def iam_roles_delete():
    """Delete a role.

    Request body: {"role": str}
    """
    data = request.get_json(force=True)
    role_name = data.get("role", "").strip()

    if not role_name:
        return jsonify({"error": "role name is required"}), 400

    if role_name == "admin":
        return jsonify({"error": "Cannot delete admin role"}), 403

    # Check if any user references this role
    users = _load_users()
    referencing_users = [u["username"] for u in users if u.get("role") == role_name]
    if referencing_users:
        return jsonify({"error": f"Cannot delete: role '{role_name}' is referenced by user(s): {', '.join(referencing_users)}"}), 409

    roles = _load_roles()
    new_roles = [r for r in roles if r["role"] != role_name]
    if len(new_roles) == len(roles):
        return jsonify({"error": "Role not found"}), 404

    with open(ROLE_PATH, "w", encoding="utf-8") as f:
        json_module.dump(new_roles, f, ensure_ascii=False, indent=2)

    return jsonify({"status": "ok"})


@app.route("/iam/authorities", methods=["GET"])
def iam_authorities():
    """Get all authorities."""
    authorities = _load_authorities()
    return jsonify({"authorities": authorities})


@app.route("/iam/authorities/update", methods=["POST"])
def iam_authorities_update():
    """Update an authority's menus.

    Request body: {"authority": str, "menus": [str, ...]}
    """
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
        json_module.dump(authorities, f, ensure_ascii=False, indent=2)

    return jsonify({"status": "ok"})


@app.route("/iam/authorities/create", methods=["POST"])
def iam_authorities_create():
    """Create a new authority.

    Request body: {"authority": str, "menus": [str, ...]}
    """
    data = request.get_json(force=True)
    authority_name = data.get("authority", "")
    menus = data.get("menus", [])

    if not authority_name:
        return jsonify({"error": "authority name is required"}), 400

    authorities = _load_authorities()
    # Check duplicate
    for a in authorities:
        if a["authority"] == authority_name:
            return jsonify({"error": "Authority already exists"}), 409

    authorities.append({"authority": authority_name, "menus": menus})

    with open(AUTHORITY_PATH, "w", encoding="utf-8") as f:
        json_module.dump(authorities, f, ensure_ascii=False, indent=2)

    return jsonify({"status": "ok"})


@app.route("/iam/authorities/delete", methods=["POST"])
def iam_authorities_delete():
    """Delete an authority.

    Request body: {"authority": str}
    """
    data = request.get_json(force=True)
    authority_name = data.get("authority", "").strip()

    if not authority_name:
        return jsonify({"error": "authority name is required"}), 400

    if authority_name == "administrator_privileges":
        return jsonify({"error": "Cannot delete administrator_privileges"}), 403

    # Check if any role references this authority
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
        json_module.dump(new_authorities, f, ensure_ascii=False, indent=2)

    return jsonify({"status": "ok"})


@app.route("/iam/resources", methods=["GET"])
def iam_resources():
    """Get all resources."""
    resources = _load_resources()
    return jsonify({"resources": resources})


@app.route("/iam/resources/create", methods=["POST"])
def iam_resources_create():
    """Create a new resource.

    Request body: {"resource": str}
    """
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


@app.route("/iam/resources/delete", methods=["POST"])
def iam_resources_delete():
    """Delete a resource.

    Request body: {"resource": str}
    """
    data = request.get_json(force=True)
    resource_name = data.get("resource", "").strip()

    if not resource_name:
        return jsonify({"error": "resource name is required"}), 400

    # Check if any authority references this resource
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


@app.route("/iam/resources/rename", methods=["POST"])
def iam_resources_rename():
    """Rename a resource.

    Request body: {"old_name": str, "new_name": str}
    """
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

    # Rename in resources list
    idx = resources.index(old_name)
    resources[idx] = new_name
    _save_resources(resources)

    # Rename in all authorities' menus
    authorities = _load_authorities()
    changed = False
    for a in authorities:
        if old_name in a.get("menus", []):
            menu_idx = a["menus"].index(old_name)
            a["menus"][menu_idx] = new_name
            changed = True
    if changed:
        with open(AUTHORITY_PATH, "w", encoding="utf-8") as f:
            json_module.dump(authorities, f, ensure_ascii=False, indent=2)

    return jsonify({"status": "ok"})


@app.route("/iam/menus", methods=["GET"])
def iam_menus():
    """Get the menu list for the current logged-in user based on their role.

    Supports multiple authorities per role (comma-separated). Computes the
    union of all menus from all assigned authorities.
    """
    username = session.get('username')
    role = session.get('role')
    if not username or not role:
        return jsonify({"error": "not logged in"}), 401

    roles = _load_roles()
    authorities = _load_authorities()

    # Find authority(ies) for this role
    authority_str = ""
    for r in roles:
        if r["role"] == role:
            authority_str = r["authority"]
            break

    # Support multiple authorities (comma-separated)
    authority_names = [a.strip() for a in authority_str.split(",") if a.strip()]

    # Compute union of menus from all authorities
    menus_set = set()
    for auth_name in authority_names:
        for a in authorities:
            if a["authority"] == auth_name:
                menus_set.update(a.get("menus", []))
                break

    # Maintain a stable order based on the full menu list
    all_menus_order = ["Home", "Workers", "Config", "History", "MD5", "SHA1", "Plugin", "CICD", "Play", "IAM", "Family", "Settings"]
    menus = [m for m in all_menus_order if m in menus_set]
    # Add any custom menus not in the predefined order
    for m in menus_set:
        if m not in menus:
            menus.append(m)

    return jsonify({"menus": menus, "role": role, "authority": authority_str})


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Master Simulator Control Panel")
    parser.add_argument("--port", "-p", type=int, default=PORT, help=f"Port to listen on (default: {PORT})")
    args = parser.parse_args()
    run_port = args.port
    print(f"Master listening on 0.0.0.0:{run_port}")
    app.run(host="0.0.0.0", port=run_port, threaded=True)
