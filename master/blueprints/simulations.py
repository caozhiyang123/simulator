"""Simulations blueprint – start/stop/status, config, sync, logs."""

import json as _json
import logging
import math
import os
import threading
import uuid

from flask import Blueprint, jsonify, render_template, request

simulations_bp = Blueprint("simulations", __name__)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Dependencies (set via init_simulations)
# ---------------------------------------------------------------------------
_config = None
_splitter = None
_sim_runner = None
_poller = None
_file_sync = None
_worker_client = None
_run_coordinator = None
_config_path: str = ""
_raw_config: dict = {}
_machine_data_dir: str = ""
_dynamic_start_modules_path: str = ""
_dynamic_start_modules_lock = threading.Lock()


def init_simulations(
    *,
    config,
    splitter,
    sim_runner,
    poller,
    file_sync,
    worker_client,
    run_coordinator,
    config_path: str,
    raw_config: dict,
    machine_data_dir: str,
    dynamic_start_modules_path: str,
):
    global _config, _splitter, _sim_runner, _poller, _file_sync
    global _worker_client, _run_coordinator
    global _config_path, _raw_config, _machine_data_dir, _dynamic_start_modules_path
    _config = config
    _splitter = splitter
    _sim_runner = sim_runner
    _poller = poller
    _file_sync = file_sync
    _worker_client = worker_client
    _run_coordinator = run_coordinator
    _config_path = config_path
    _raw_config = raw_config
    _machine_data_dir = machine_data_dir
    _dynamic_start_modules_path = dynamic_start_modules_path


# ---------------------------------------------------------------------------
# Validation helpers
# ---------------------------------------------------------------------------
def _positive_int(value, field_name: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise ValueError(f"{field_name} must be a positive integer")
    return value


def _boolean_value(value, field_name: str) -> bool:
    if not isinstance(value, bool):
        raise ValueError(f"{field_name} must be a boolean")
    return value


def _bounded_string(value, field_name: str, max_length: int, *, required: bool = False) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{field_name} must be a string")
    value = value.strip()
    if required and not value:
        raise ValueError(f"{field_name} is required")
    if len(value) > max_length:
        raise ValueError(f"{field_name} is too long")
    return value


# ---------------------------------------------------------------------------
# Dynamic start modules persistence
# ---------------------------------------------------------------------------
def _sanitize_dynamic_start_modules(payload) -> dict:
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
        pair_id = _bounded_string(raw.get("pair_id", module_id), f"modules[{index}].pair_id", 128, required=True)
        module_type = raw.get("type")
        if module_type not in ("batch", "single"):
            raise ValueError(f"modules[{index}].type must be batch or single")
        sim_type = raw.get("sim_type", "production")
        if sim_type not in ("production", "test"):
            raise ValueError(f"modules[{index}].sim_type must be production or test")
        clean = {
            "id": module_id, "pair_id": pair_id, "type": module_type,
            "sim_type": sim_type,
            "game_name": _bounded_string(raw.get("game_name", ""), f"modules[{index}].game_name", 256),
            "override_spin_settings": _boolean_value(raw.get("override_spin_settings", False), f"modules[{index}].override_spin_settings"),
            "interval_count": _positive_int(raw.get("interval_count"), f"modules[{index}].interval_count"),
        }
        if module_type == "batch":
            clean["total_spins"] = _positive_int(raw.get("total_spins"), f"modules[{index}].total_spins")
            selected_nodes = raw.get("selected_nodes", [])
            if not isinstance(selected_nodes, list) or len(selected_nodes) > 100:
                raise ValueError(f"modules[{index}].selected_nodes must be an array with at most 100 entries")
            clean["selected_nodes"] = [_bounded_string(addr, f"modules[{index}].selected_nodes", 256, required=True) for addr in selected_nodes]
        else:
            clean["spins"] = _positive_int(raw.get("spins"), f"modules[{index}].spins")
            clean["selected_node"] = _bounded_string(raw.get("selected_node", ""), f"modules[{index}].selected_node", 256)
        clean_modules.append(clean)
    return {"version": 1, "modules": clean_modules}


def _write_dynamic_start_modules(payload: dict) -> None:
    directory = os.path.dirname(_dynamic_start_modules_path)
    os.makedirs(directory, exist_ok=True)
    temp_path = f"{_dynamic_start_modules_path}.{uuid.uuid4().hex}.tmp"
    try:
        with open(temp_path, "w", encoding="utf-8") as stream:
            _json.dump(payload, stream, ensure_ascii=False, indent=2)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp_path, _dynamic_start_modules_path)
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)


def _load_dynamic_start_modules() -> dict:
    with _dynamic_start_modules_lock:
        if not os.path.isfile(_dynamic_start_modules_path):
            payload = {"version": 1, "modules": []}
            _write_dynamic_start_modules(payload)
            return payload
        with open(_dynamic_start_modules_path, "r", encoding="utf-8") as stream:
            raw_payload = _json.load(stream)
        clean_payload = _sanitize_dynamic_start_modules(raw_payload)
        if clean_payload != raw_payload:
            _write_dynamic_start_modules(clean_payload)
        return clean_payload


def _save_dynamic_start_modules(payload) -> dict:
    clean_payload = _sanitize_dynamic_start_modules(payload)
    with _dynamic_start_modules_lock:
        _write_dynamic_start_modules(clean_payload)
    return clean_payload


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@simulations_bp.route("/")
def index():
    """Web 控制面板首页。"""
    return render_template("index.html")


@simulations_bp.route("/games", methods=["GET"])
def list_games():
    """List games from JSON filenames in data/machine.

    The response is marked non-cacheable so the browser never reuses a
    stale/empty list (which previously required a full master restart to
    clear before the Game dropdowns would populate).
    """
    games = []
    if os.path.isdir(_machine_data_dir):
        try:
            with os.scandir(_machine_data_dir) as entries:
                games = [
                    os.path.splitext(e.name)[0]
                    for e in entries
                    if e.is_file() and e.name.lower().endswith(".json")
                ]
        except OSError as exc:
            logger.warning(
                "Unable to scan machine data directory %s: %s",
                _machine_data_dir,
                exc,
            )
            games = []

    resp = jsonify({"games": sorted(games, key=str.casefold)})
    resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
    resp.headers["Pragma"] = "no-cache"
    resp.headers["Expires"] = "0"
    return resp


@simulations_bp.route("/start", methods=["POST"])
def start():
    """批量启动分布式模拟。"""
    data = request.get_json(force=True)
    total_spins = data.get("total_spins")
    mode = data.get("mode", _config.get_allocation_mode())
    game_name = data.get("game_name", "")
    interval_count = data.get("interval_count")
    sim_type = data.get("sim_type", "production")
    selected_nodes = data.get("selected_nodes")
    try:
        override_spin_settings = _boolean_value(data.get("override_spin_settings", True), "override_spin_settings")
    except ValueError as exc:
        return jsonify({"status": "error", "error": str(exc)}), 400

    if not game_name:
        return jsonify({"status": "error", "error": "game_name is required"}), 400

    nodes = _config.get_nodes()
    if selected_nodes:
        nodes = [n for n in nodes if n["addr"] in selected_nodes]
        if not nodes:
            return jsonify({"status": "error", "error": "No valid nodes selected"}), 400

    job_id = str(uuid.uuid4())
    try:
        if mode == "percentage":
            allocation = _splitter.split_percentage(total_spins, nodes)
        else:
            allocation = _splitter.split_vcpu(total_spins, nodes)
    except ValueError as exc:
        return jsonify({"status": "error", "error": str(exc)}), 400

    if interval_count and interval_count > 0:
        for addr in allocation:
            raw = allocation[addr]
            if raw > 0:
                allocation[addr] = math.ceil(raw / interval_count) * interval_count

    results = []
    master_spins = allocation.get("master", 0)
    if master_spins > 0:
        try:
            started = _sim_runner.start(master_spins, job_id, game_name, interval_count, sim_type, override_spin_settings)
            results.append({"node": "master", "success": started, "retries": 0})
        except RuntimeError as exc:
            results.append({"node": "master", "success": False, "retries": 0, "error": str(exc)})

    worker_addrs = [n["addr"] for n in nodes if n["addr"] != "master"]
    for addr in worker_addrs:
        spins = allocation.get(addr, 0)
        if spins > 0:
            result = _worker_client.start_with_retry(addr, spins, job_id, game_name, interval_count, sim_type, override_spin_settings)
            results.append(result)

    _poller.start(worker_addrs)
    all_ok = all(r.get("success") for r in results)
    if all_ok:
        _run_coordinator.has_been_running = True
    return jsonify({"status": "success" if all_ok else "partial_failure", "job_id": job_id, "results": results})


@simulations_bp.route("/status", methods=["GET"])
def status():
    """获取汇总进度/结果。"""
    return jsonify(_run_coordinator.get_aggregated_status())


@simulations_bp.route("/start-master", methods=["POST"])
def start_master():
    """单独启动 Master 本地模拟器。"""
    data = request.get_json(force=True)
    spins = data.get("spins")
    game_name = data.get("game_name", "")
    interval_count = data.get("interval_count")
    sim_type = data.get("sim_type", "production")
    try:
        override_spin_settings = _boolean_value(data.get("override_spin_settings", True), "override_spin_settings")
    except ValueError as exc:
        return jsonify({"status": "error", "message": str(exc)}), 400
    job_id = str(uuid.uuid4())
    if not game_name:
        return jsonify({"status": "error", "message": "game_name is required"}), 400
    try:
        started = _sim_runner.start(spins, job_id, game_name, interval_count, sim_type, override_spin_settings)
    except RuntimeError as exc:
        return jsonify({"status": "error", "message": str(exc)}), 500
    if not started:
        return jsonify({"status": "error", "message": "Master simulator already running"}), 409
    _poller.start([w["addr"] for w in _config.workers])
    _run_coordinator.has_been_running = True
    return jsonify({"status": "started", "message": f"Master simulator started with {spins} spins"})


@simulations_bp.route("/start-worker", methods=["POST"])
def start_worker():
    """单独启动指定 Worker。"""
    data = request.get_json(force=True)
    worker_addr = data.get("worker_addr")
    spins = data.get("spins")
    game_name = data.get("game_name", "")
    interval_count = data.get("interval_count")
    sim_type = data.get("sim_type", "production")
    try:
        override_spin_settings = _boolean_value(data.get("override_spin_settings", True), "override_spin_settings")
    except ValueError as exc:
        return jsonify({"status": "error", "error": str(exc)}), 400
    job_id = str(uuid.uuid4())
    known_addrs = [w["addr"] for w in _config.workers]
    if worker_addr not in known_addrs:
        return jsonify({"error": "Worker not found", "addr": worker_addr}), 404
    result = _worker_client.start_with_retry(worker_addr, spins, job_id, game_name, interval_count, sim_type, override_spin_settings)
    _poller.start([w["addr"] for w in _config.workers])
    return jsonify({"status": "ok" if result["success"] else "error", "message": result})


@simulations_bp.route("/stop-master", methods=["POST"])
def stop_master():
    """停止 Master 本地模拟器。"""
    stopped = _sim_runner.stop()
    if stopped:
        return jsonify({"status": "stopped", "message": "Master simulator stopped"})
    return jsonify({"status": "error", "message": "No running task to stop"}), 400


@simulations_bp.route("/clear-results", methods=["POST"])
def clear_results():
    """清除当前 Per-Model Results 记录。"""
    _sim_runner.clear_results()
    _poller.clear_snapshot()
    _run_coordinator.clear()
    return jsonify({"status": "ok", "message": "Results cleared"})


@simulations_bp.route("/stop-worker", methods=["POST"])
def stop_worker():
    """停止指定 Worker 的模拟器。"""
    data = request.get_json(force=True)
    worker_addr = data.get("worker_addr")
    known_addrs = [w["addr"] for w in _config.workers]
    if worker_addr not in known_addrs:
        return jsonify({"error": "Worker not found", "addr": worker_addr}), 404
    try:
        r = _worker_client.post(worker_addr, "/stop", timeout=10)
        return jsonify(r.json()), r.status_code
    except Exception as exc:
        return jsonify({"status": "error", "message": str(exc)}), 500


@simulations_bp.route("/logs/worker", methods=["GET"])
def worker_logs():
    """获取指定 Worker 的模拟器日志。"""
    addr = request.args.get("addr", "")
    since = request.args.get("since", 0, type=int)
    if not addr:
        return jsonify({"error": "addr is required"}), 400
    try:
        r = _worker_client.get(addr, "/logs", params={"since": since}, timeout=5)
        return jsonify(r.json())
    except Exception as exc:
        return jsonify({"lines": [f"[ERROR] 无法连接 {addr}: {exc}"], "total": 0})


@simulations_bp.route("/logs", methods=["GET"])
def logs():
    """获取 Master 本地模拟器的日志。"""
    since = request.args.get("since", 0, type=int)
    return jsonify(_sim_runner.get_logs(since))


@simulations_bp.route("/poller/log", methods=["GET"])
def poller_log():
    """获取轮询日志。"""
    since = request.args.get("since", 0, type=int)
    return jsonify(_poller.get_poll_log(since))


@simulations_bp.route("/sync", methods=["POST"])
def sync():
    """文件同步到 Worker。"""
    data = request.get_json(force=True)
    target_addr = data.get("worker_addr")
    game_name = data.get("game_name", "")
    if game_name:
        game_dir = os.path.join("math", game_name)
        _file_sync.clean_simulation_results(game_dir)
    workers = _config.workers
    if target_addr:
        worker = None
        for w in workers:
            if w["addr"] == target_addr:
                worker = w
                break
        if worker is None:
            return jsonify({"error": "Worker not found", "addr": target_addr}), 404
        result = _file_sync.sync_to_worker(worker["addr"], worker.get("shared_dir", ""), worker.get("username"), worker.get("password"))
        if result["success"]:
            return jsonify({"status": "success", "message": f"Synced to {target_addr}"})
        return jsonify({"status": "error", "message": result.get("error", "Sync failed")}), 500
    else:
        result = _file_sync.sync_to_all_workers(workers)
        all_ok = all(r["success"] for r in result["results"].values())
        return jsonify({"status": "success" if all_ok else "partial_failure", "message": "Sync completed", "details": result["results"]})


# ---------------------------------------------------------------------------
# Config routes
# ---------------------------------------------------------------------------
@simulations_bp.route("/config/poll-interval", methods=["POST"])
def set_poll_interval():
    data = request.get_json(force=True)
    interval = data.get("interval")
    _config.set_poll_interval(interval)
    _poller.set_interval(interval)
    return jsonify({"interval": interval})


@simulations_bp.route("/config/allocation-mode", methods=["POST"])
def set_allocation_mode():
    data = request.get_json(force=True)
    mode = data.get("mode")
    _config.set_allocation_mode(mode)
    return jsonify({"mode": mode})


@simulations_bp.route("/config/percentages", methods=["POST"])
def set_percentages():
    data = request.get_json(force=True)
    percentages = data.get("percentages", {})
    _config.set_percentages(percentages)
    return jsonify({"percentages": percentages})


@simulations_bp.route("/config/nodes", methods=["GET"])
def get_nodes():
    return jsonify({
        "nodes": _config.get_nodes(),
        "allocation_mode": _config.get_allocation_mode(),
        "poll_interval": _config.get_poll_interval(),
        "sysinfo_refresh_interval": _raw_config.get("sysinfo_refresh_interval", 5),
        "cpu_healthy_threshold": _raw_config.get("cpu_healthy_threshold", 90),
    })


@simulations_bp.route("/config/dynamic-start-modules", methods=["GET"])
def get_dynamic_start_modules():
    try:
        return jsonify(_load_dynamic_start_modules())
    except (OSError, ValueError, _json.JSONDecodeError) as exc:
        logger.exception("Unable to load dynamic start modules")
        return jsonify({"error": str(exc)}), 500


@simulations_bp.route("/config/dynamic-start-modules", methods=["PUT"])
def put_dynamic_start_modules():
    try:
        payload = request.get_json(force=True)
        return jsonify(_save_dynamic_start_modules(payload))
    except (ValueError, _json.JSONDecodeError) as exc:
        return jsonify({"error": str(exc)}), 400
    except OSError as exc:
        logger.exception("Unable to save dynamic start modules")
        return jsonify({"error": str(exc)}), 500


@simulations_bp.route("/config/quick-access-toolbar", methods=["GET"])
def get_quick_access_toolbar():
    items = []
    try:
        with open(_config_path, "r", encoding="utf-8") as f:
            cfg = _json.load(f)
        items = cfg.get("quick_access_toolbar", [])
    except Exception:
        items = _raw_config.get("quick_access_toolbar", [])
    return jsonify({"items": items})


@simulations_bp.route("/config/footer-links", methods=["GET"])
def get_footer_links():
    try:
        with open(_config_path, "r", encoding="utf-8") as f:
            cfg = _json.load(f)
        links = cfg.get("footer_links", [])
    except Exception:
        links = _raw_config.get("footer_links", [])
    return jsonify({"links": links})
