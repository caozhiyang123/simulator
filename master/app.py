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

# ---------------------------------------------------------------------------
# Service layer
# ---------------------------------------------------------------------------
from services.worker_client import WorkerClient
from services.run_coordinator import RunCoordinator
from services.file_service import FileService

worker_client = WorkerClient(_worker_session)
run_coordinator = RunCoordinator(history_store, poller, sim_runner)
file_service = FileService(config.production_dir)

# ---------------------------------------------------------------------------
# Blueprint registration
# ---------------------------------------------------------------------------
from blueprints.auth import auth_bp, init_auth, require_login, _load_users, _save_users, _md5
from blueprints.iam import iam_bp, init_iam, _load_roles, _load_authorities
from blueprints.history import history_bp, init_history
from blueprints.cicd import cicd_bp, init_cicd, cleanup_old_builds
from blueprints.simulations import simulations_bp, init_simulations
from blueprints.workers import workers_bp, init_workers
from blueprints.files import files_bp, init_files

init_history(history_store, poller)
init_cicd(_base_dir, config=config, worker_session=_worker_session)
init_auth(_base_dir, load_roles_fn=_load_roles, load_authorities_fn=_load_authorities, cleanup_old_builds_fn=cleanup_old_builds)
init_iam(_base_dir, load_users_fn=_load_users, save_users_fn=_save_users, md5_fn=_md5)
init_simulations(
    config=config, splitter=splitter, sim_runner=sim_runner, poller=poller,
    file_sync=file_sync, worker_client=worker_client, run_coordinator=run_coordinator,
    config_path=CONFIG_PATH, raw_config=_raw_config, machine_data_dir=MACHINE_DATA_DIR,
    dynamic_start_modules_path=DYNAMIC_START_MODULES_PATH,
)
init_workers(config=config, worker_client=worker_client, raw_config=_raw_config)
init_files(config=config, worker_client=worker_client, base_dir=_base_dir, bundle_dir=_bundle_dir, raw_config=_raw_config)

app.register_blueprint(auth_bp)
app.register_blueprint(iam_bp)
app.register_blueprint(history_bp)
app.register_blueprint(cicd_bp)
app.register_blueprint(simulations_bp)
app.register_blueprint(workers_bp)
app.register_blueprint(files_bp)

app.before_request(require_login)



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

