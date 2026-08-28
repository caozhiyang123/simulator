"""Workers blueprint – add/edit/delete nodes, health, launcher, sysinfo."""

import logging

import requests as http_requests
from flask import Blueprint, jsonify, request

workers_bp = Blueprint("workers", __name__)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Dependencies (set via init_workers)
# ---------------------------------------------------------------------------
_config = None
_worker_client = None
_raw_config: dict = {}


def init_workers(*, config, worker_client, raw_config: dict):
    global _config, _worker_client, _raw_config
    _config = config
    _worker_client = worker_client
    _raw_config = raw_config


# ---------------------------------------------------------------------------
# Worker CRUD
# ---------------------------------------------------------------------------
@workers_bp.route("/add_worker", methods=["POST"])
def add_worker():
    """新增 Worker 节点。"""
    from config import WorkerExistsError
    data = request.get_json(force=True)
    addr = data.get("addr")
    vcpu = data.get("vcpu", 1)
    alias = data.get("alias", "")
    try:
        nodes = _config.add_worker(addr, vcpu, alias)
    except WorkerExistsError as exc:
        return jsonify({"error": str(exc), "addr": addr}), exc.status_code
    return jsonify({"workers": nodes})


@workers_bp.route("/edit_worker", methods=["POST"])
def edit_worker():
    """Edit an existing Worker node."""
    data = request.get_json(force=True)
    old_addr = data.get("old_addr", "")
    new_addr = data.get("addr", "")
    vcpu = data.get("vcpu", 1)
    alias = data.get("alias", "")
    if not old_addr:
        return jsonify({"error": "old_addr required"}), 400
    found = False
    for w in _config._workers:
        if w["addr"] == old_addr:
            w["addr"] = new_addr or old_addr
            w["vcpu"] = vcpu
            w["alias"] = alias
            found = True
            break
    if not found:
        return jsonify({"error": "Worker not found", "addr": old_addr}), 404
    _config._save()
    return jsonify({"workers": _config.get_nodes()})


@workers_bp.route("/del_worker", methods=["POST"])
def del_worker():
    """删除 Worker 节点。"""
    from config import WorkerNotFoundError
    data = request.get_json(force=True)
    addr = data.get("addr")
    try:
        nodes = _config.remove_worker(addr)
    except WorkerNotFoundError as exc:
        return jsonify({"error": str(exc), "addr": addr}), exc.status_code
    return jsonify({"workers": nodes})


# ---------------------------------------------------------------------------
# Health & Launcher
# ---------------------------------------------------------------------------
@workers_bp.route("/workers/health", methods=["GET"])
def workers_health():
    """Check if each worker is online by pinging /status."""
    results = {}
    for w in _config.workers:
        addr = w["addr"]
        try:
            r = _worker_client.get(addr, "/status", timeout=2)
            results[addr] = r.status_code == 200
        except Exception:
            results[addr] = False
    return jsonify(results)


def _launcher_addr(worker_addr: str) -> str:
    host = worker_addr.split(":")[0]
    launcher_port = _raw_config.get("launcher_port", 5099)
    return f"{host}:{launcher_port}"


def _launcher_headers() -> dict:
    token = _raw_config.get("launcher_auth_token", "")
    return {"X-Launcher-Token": token} if token else {}


@workers_bp.route("/workers/launcher-status", methods=["GET"])
def launcher_status():
    """Query whether worker.exe is currently running via Launcher."""
    addr = request.args.get("addr", "")
    if not addr or addr == "master":
        return jsonify({"error": "addr (worker addr) is required"}), 400
    launcher = _launcher_addr(addr)
    try:
        r = _worker_client.get(launcher, "/launcher/status", timeout=5)
        try:
            return jsonify(r.json()), r.status_code
        except ValueError:
            return jsonify({"error": "Launcher returned non-JSON"}), 502
    except http_requests.ConnectionError:
        return jsonify({"error": f"Cannot reach launcher at {launcher}. Is it running?"}), 503
    except http_requests.Timeout:
        return jsonify({"error": f"Connection to launcher {launcher} timed out"}), 504
    except http_requests.RequestException as exc:
        return jsonify({"error": str(exc)}), 500


@workers_bp.route("/workers/launcher-start", methods=["POST"])
def launcher_start_worker():
    """Ask Launcher to start worker.exe."""
    data = request.get_json(force=True)
    addr = data.get("addr", "")
    if not addr or addr == "master":
        return jsonify({"error": "addr (worker addr) is required"}), 400
    launcher = _launcher_addr(addr)
    try:
        r = _worker_client.post(launcher, "/launcher/start-worker", timeout=15)
        try:
            return jsonify(r.json()), r.status_code
        except ValueError:
            return jsonify({"error": "Launcher returned non-JSON"}), 502
    except http_requests.ConnectionError:
        return jsonify({"error": f"Cannot reach launcher at {launcher}. Is it running?"}), 503
    except http_requests.Timeout:
        return jsonify({"error": f"Connection to launcher {launcher} timed out"}), 504
    except http_requests.RequestException as exc:
        return jsonify({"error": str(exc)}), 500


@workers_bp.route("/workers/launcher-stop", methods=["POST"])
def launcher_stop_worker():
    """Ask Launcher to stop worker.exe."""
    data = request.get_json(force=True)
    addr = data.get("addr", "")
    if not addr or addr == "master":
        return jsonify({"error": "addr (worker addr) is required"}), 400
    launcher = _launcher_addr(addr)
    try:
        r = _worker_client.post(launcher, "/launcher/stop-worker", timeout=15)
        try:
            return jsonify(r.json()), r.status_code
        except ValueError:
            return jsonify({"error": "Launcher returned non-JSON"}), 502
    except http_requests.ConnectionError:
        return jsonify({"error": f"Cannot reach launcher at {launcher}. Is it running?"}), 503
    except http_requests.Timeout:
        return jsonify({"error": f"Connection to launcher {launcher} timed out"}), 504
    except http_requests.RequestException as exc:
        return jsonify({"error": str(exc)}), 500


# ---------------------------------------------------------------------------
# System Info
# ---------------------------------------------------------------------------
@workers_bp.route("/sysinfo", methods=["GET"])
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


@workers_bp.route("/files/worker/sysinfo", methods=["GET"])
def worker_sysinfo_proxy():
    """Proxy sysinfo request to a worker."""
    addr = request.args.get("addr", "")
    if not addr:
        return jsonify({"error": "addr is required"}), 400
    try:
        r = _worker_client.get(addr, "/sysinfo", timeout=5)
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


@workers_bp.route("/sysinfo/all", methods=["GET"])
def all_sysinfo():
    """Collect system info from master + all workers."""
    import psutil
    results = {}
    cpu_pct = psutil.cpu_percent(interval=0.5)
    mem = psutil.virtual_memory()
    results["master"] = {
        "cpu_percent": cpu_pct,
        "cpu_count": psutil.cpu_count(),
        "mem_total_mb": round(mem.total / 1024 / 1024),
        "mem_used_mb": round(mem.used / 1024 / 1024),
        "mem_percent": mem.percent,
    }
    for w in _config.workers:
        addr = w["addr"]
        try:
            r = _worker_client.get(addr, "/sysinfo", timeout=3)
            results[addr] = r.json()
        except Exception as exc:
            results[addr] = {"error": str(exc)}
    return jsonify(results)
