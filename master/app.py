"""Master Flask 主应用与路由。

提供 Web 控制面板、批量/单独启动模拟、进度查询、
Worker 动态管理、配置修改、文件同步等 HTTP 端点。
"""

import logging
import math
import os
import sys
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

# Read port from config.json, fallback to env var, then default 5000
import json as _json
_raw_config = {}
if os.path.isfile(CONFIG_PATH):
    with open(CONFIG_PATH, "r", encoding="utf-8") as _cf:
        _raw_config = _json.load(_cf)
PORT = int(os.environ.get("MASTER_PORT", _raw_config.get("port", 5000)))

# ---------------------------------------------------------------------------
# Application & component initialisation
# ---------------------------------------------------------------------------
app = Flask(__name__,
            template_folder=os.path.join(_bundle_dir, 'templates'),
            static_folder=os.path.join(_bundle_dir, 'static'))
app.secret_key = os.environ.get("SECRET_KEY", "simulator-cluster-secret-2026")

# Static files cache: 7 days (images, JS, CSS won't re-download on every visit)
app.config['SEND_FILE_MAX_AGE_DEFAULT'] = 604800

config = ClusterConfig(CONFIG_PATH)
splitter = TaskSplitter()
merger = ResultMerger()
progress_store = ProgressStore(config.progress_save_dir)
history_store = HistoryStore(os.path.join(_base_dir, "data"))
sim_runner = SimulatorRunner(config.simulator_dir, config.production_dir)
file_sync = FileSync(config.simulator_dir, "")
poller = ProgressPoller(
    interval=config.get_poll_interval(),
    master_status_fn=sim_runner.get_status,
    progress_store=progress_store,
)

# ---------------------------------------------------------------------------
# Retry helper
# ---------------------------------------------------------------------------
MAX_RETRIES = 3
RETRY_INTERVAL = 5  # seconds
_last_saved_status = "idle"
_has_been_running = False
_saved_model_keys: set = set()


def start_worker_with_retry(worker_addr: str, spins: int, job_id: str, game_name: str = "", interval_count: int | None = None, sim_type: str = "production") -> dict:
    """Send POST /start to a worker with retry logic.

    Returns dict with keys: node, success, retries, error (optional).
    """
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            response = http_requests.post(
                f"http://{worker_addr}/start",
                json={"spins": spins, "job_id": job_id, "game_name": game_name, "interval_count": interval_count, "sim_type": sim_type},
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

USERS_PATH = os.path.join(_base_dir, "users.json")

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
            return jsonify({"status": "ok", "username": username, "role": u["role"]})
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
    """列出可用的游戏列表（扫描 simulator_dir/math/ 下的子目录）。"""
    math_dir = os.path.join(config.simulator_dir, "math")
    if not os.path.isdir(math_dir):
        return jsonify({"games": []})
    games = [
        d for d in os.listdir(math_dir)
        if os.path.isdir(os.path.join(math_dir, d))
    ]
    return jsonify({"games": sorted(games)})


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
            started = sim_runner.start(master_spins, job_id, game_name, interval_count, sim_type)
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
            result = start_worker_with_retry(addr, spins, job_id, game_name, interval_count, sim_type)
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

    # Persist results incrementally: save when new models complete
    global _last_saved_status, _has_been_running, _saved_model_keys
    if overall_status == "running":
        _has_been_running = True

    # Save whenever new models appear (deduplicated by model key)
    if aggregated_models and _has_been_running:
        current_keys = set(aggregated_models.keys())
        new_keys = current_keys - _saved_model_keys
        if new_keys:
            try:
                history_store.save_current(aggregated_models)
                _saved_model_keys = current_keys.copy()
            except Exception:
                pass

    # Reset tracking when simulation ends (no save needed, already saved incrementally)
    if overall_status in ("completed", "stopped", "idle") and _last_saved_status == "running":
        _has_been_running = False
        _saved_model_keys = set()
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
    job_id = str(uuid.uuid4())

    if not game_name:
        return jsonify({"status": "error", "message": "game_name is required"}), 400

    try:
        started = sim_runner.start(spins, job_id, game_name, interval_count, sim_type)
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
    job_id = str(uuid.uuid4())

    # Check worker exists in config
    known_addrs = [w["addr"] for w in config.workers]
    if worker_addr not in known_addrs:
        return jsonify({
            "error": "Worker not found",
            "addr": worker_addr,
        }), 404

    result = start_worker_with_retry(worker_addr, spins, job_id, game_name, interval_count, sim_type)

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
        r = http_requests.post(f"http://{worker_addr}/stop", timeout=10)
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
        r = http_requests.get(f"http://{addr}/logs", params={"since": since}, timeout=5)
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


@app.route("/logs", methods=["GET"])
def logs():
    """获取 Master 本地模拟器的 run.bat 输出日志。

    查询参数: ?since=0 (从第几行开始，用于增量获取)
    """
    since = request.args.get("since", 0, type=int)
    return jsonify(sim_runner.get_logs(since))


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
        r = http_requests.post(f"http://{addr}/files/rename", json={
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
        r = http_requests.post(f"http://{addr}/files/duplicate", json={
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
        r = http_requests.post(f"http://{addr}/files/mkdir", json={"path": dir_path}, timeout=10)
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
        r = http_requests.post(f"http://{addr}/files/write", json={"path": file_path, "content": content}, timeout=10)
        return jsonify(r.json()), r.status_code
    except http_requests.RequestException as exc:
        return jsonify({"error": str(exc)}), 500


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


@app.route("/files/batch-check", methods=["POST"])
def batch_check():
    """Recursively find all files matching the source filename.

    Request body: {"source": "path", "target_dirs": ["dir1", "dir2"], "exclude_dirs": ["ex1"]}
    """
    data = request.get_json(force=True)
    source = data.get("source", "").strip()
    target_dirs = data.get("target_dirs", [])
    exclude_dirs = data.get("exclude_dirs", [])
    # Backward compat: support single target_dir
    if not target_dirs and data.get("target_dir"):
        target_dirs = [data.get("target_dir", "").strip()]

    if not source:
        return jsonify({"error": "source file path is required"}), 400
    if not target_dirs:
        return jsonify({"error": "at least one target directory is required"}), 400

    # Normalize exclude dirs for comparison
    exclude_normalized = [os.path.normpath(d.strip()).lower() for d in exclude_dirs if d.strip()]

    filename = os.path.basename(source)
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
                if f == filename:
                    found.append(os.path.join(root, f).replace("\\", "/"))

    return jsonify({"status": "ok", "found": found, "count": len(found)})


@app.route("/files/batch-override", methods=["POST"])
def batch_override():
    """Recursively find and replace files matching the source filename.

    Request body: {"source": "path", "target_dirs": ["dir1"], "exclude_dirs": ["ex1"]}
    """
    import shutil
    data = request.get_json(force=True)
    source = data.get("source", "").strip()
    target_dirs = data.get("target_dirs", [])
    exclude_dirs = data.get("exclude_dirs", [])
    # Backward compat
    if not target_dirs and data.get("target_dir"):
        target_dirs = [data.get("target_dir", "").strip()]

    if not source:
        return jsonify({"error": "source file path is required"}), 400
    if not target_dirs:
        return jsonify({"error": "at least one target directory is required"}), 400

    source = os.path.normpath(source)
    if not os.path.isfile(source):
        return jsonify({"error": f"Source file not found: {source}"}), 404

    # Normalize exclude dirs
    exclude_normalized = [os.path.normpath(d.strip()).lower() for d in exclude_dirs if d.strip()]

    filename = os.path.basename(source)
    replaced = []
    errors = []

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
                if f == filename:
                    target_path = os.path.join(root, f)
                    if os.path.normpath(target_path) == source:
                        continue
                    try:
                        shutil.copy2(source, target_path)
                        replaced.append(target_path.replace("\\", "/"))
                    except Exception as exc:
                        errors.append(f"{target_path.replace(chr(92), '/')} - {str(exc)}")

    return jsonify({"status": "ok", "replaced": replaced, "errors": errors, "count": len(replaced)})


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
        r = http_requests.get(f"http://{addr}/files/download", params={"path": file_path}, timeout=30, stream=True)
        if r.status_code == 200:
            from flask import Response
            filename = os.path.basename(file_path)
            headers = {"Content-Disposition": f"attachment; filename={filename}"}
            if r.headers.get("Content-Type"):
                headers["Content-Type"] = r.headers["Content-Type"]
            return Response(r.iter_content(chunk_size=8192), headers=headers)
        # Fallback: use /files/read for text files (older workers)
        r2 = http_requests.get(f"http://{addr}/files/read", params={"path": file_path}, timeout=30)
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
        r = http_requests.get(
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
        r = http_requests.post(
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
            r = http_requests.post(
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
        r = http_requests.get(
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
        r = http_requests.post(
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
        r = http_requests.post(
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
            r = http_requests.get(f"http://{addr}/status", timeout=2)
            results[addr] = r.status_code == 200
        except Exception:
            results[addr] = False
    return jsonify(results)


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
        r = http_requests.get(f"http://{addr}/sysinfo", timeout=5)
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
            r = http_requests.get(f"http://{addr}/sysinfo", timeout=3)
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
            r = http_requests.get(f"http://{addr}/status", timeout=2)
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
