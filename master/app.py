"""Master Flask 主应用与路由。

提供 Web 控制面板、批量/单独启动模拟、进度查询、
Worker 动态管理、配置修改、文件同步等 HTTP 端点。
"""

import logging
import os
import time
import uuid

import requests as http_requests
from flask import Flask, jsonify, render_template, request

from config import ClusterConfig, WorkerExistsError, WorkerNotFoundError
from file_sync import FileSync
from merger import ResultMerger
from poller import ProgressPoller
from progress_store import ProgressStore
from simulator_runner import SimulatorRunner
from task_splitter import TaskSplitter

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
CONFIG_PATH = os.environ.get("CONFIG_PATH", os.path.join(os.path.dirname(__file__), "config.json"))
PORT = int(os.environ.get("MASTER_PORT", "5000"))

# ---------------------------------------------------------------------------
# Application & component initialisation
# ---------------------------------------------------------------------------
app = Flask(__name__)

config = ClusterConfig(CONFIG_PATH)
splitter = TaskSplitter()
merger = ResultMerger()
progress_store = ProgressStore(config.progress_save_dir)
sim_runner = SimulatorRunner(config.simulator_dir)
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


def start_worker_with_retry(worker_addr: str, spins: int, job_id: str, game_name: str = "") -> dict:
    """Send POST /start to a worker with retry logic.

    Returns dict with keys: node, success, retries, error (optional).
    """
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            response = http_requests.post(
                f"http://{worker_addr}/start",
                json={"spins": spins, "job_id": job_id, "game_name": game_name},
                timeout=10,
            )
            if response.status_code == 200:
                return {
                    "node": worker_addr,
                    "success": True,
                    "retries": attempt - 1,
                }
            if response.status_code == 409:
                return {
                    "node": worker_addr,
                    "success": False,
                    "retries": attempt - 1,
                    "error": "Task conflict",
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

    results = []

    # Start master local simulator (only if selected)
    master_spins = allocation.get("master", 0)
    if master_spins > 0:
        try:
            started = sim_runner.start(master_spins, job_id, game_name)
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
            result = start_worker_with_retry(addr, spins, job_id, game_name)
            results.append(result)

    # Start poller
    poller.start(worker_addrs)

    all_ok = all(r.get("success") for r in results)
    return jsonify({
        "status": "success" if all_ok else "partial_failure",
        "job_id": job_id,
        "results": results,
    })


@app.route("/status", methods=["GET"])
def status():
    """获取汇总进度/结果，所有节点完成后执行 merge。"""
    snapshot = poller.get_snapshot()
    nodes_data = snapshot.get("nodes", {})

    # Determine overall status and collect results for merge
    statuses = []
    node_results: dict[str, dict | None] = {}
    nodes_info = []

    for name, info in nodes_data.items():
        node_status = info.get("status", "idle")
        statuses.append(node_status)

        # Build addr key for merger (strip wrapper like "master(local)" -> "master")
        if name.startswith("master"):
            addr = "master"
        else:
            # "worker(ip:port)" -> "ip:port"
            addr = name.replace("worker(", "").rstrip(")")

        if node_status == "completed" and info.get("result"):
            node_results[addr] = info["result"]
        elif node_status == "error":
            node_results[addr] = None
        else:
            node_results[addr] = None

        nodes_info.append({
            "addr": addr,
            "name": name,
            "status": node_status,
            "progress": info.get("progress"),
        })

    # Determine overall status
    if all(s == "completed" for s in statuses) and statuses:
        overall_status = "completed"
    elif any(s == "error" for s in statuses):
        overall_status = "partial_error"
    elif any(s == "running" for s in statuses):
        overall_status = "running"
    else:
        overall_status = "idle"

    response: dict = {
        "overall_status": overall_status,
        "nodes": nodes_info,
    }

    # Merge when all nodes completed
    if overall_status == "completed":
        merged = merger.merge(node_results)
        response["merged_result"] = merged

    return jsonify(response)


@app.route("/start-master", methods=["POST"])
def start_master():
    """单独启动 Master 本地模拟器。

    请求体: {"spins": int, "game_name": str}
    """
    data = request.get_json(force=True)
    spins = data.get("spins")
    game_name = data.get("game_name", "")
    job_id = str(uuid.uuid4())

    if not game_name:
        return jsonify({"status": "error", "message": "game_name is required"}), 400

    try:
        started = sim_runner.start(spins, job_id, game_name)
    except RuntimeError as exc:
        return jsonify({"status": "error", "message": str(exc)}), 500

    if not started:
        return jsonify({
            "status": "error",
            "message": "Master simulator already running",
        }), 409

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
    job_id = str(uuid.uuid4())

    # Check worker exists in config
    known_addrs = [w["addr"] for w in config.workers]
    if worker_addr not in known_addrs:
        return jsonify({
            "error": "Worker not found",
            "addr": worker_addr,
        }), 404

    result = start_worker_with_retry(worker_addr, spins, job_id, game_name)
    return jsonify({"status": "ok" if result["success"] else "error", "message": result})


@app.route("/stop-master", methods=["POST"])
def stop_master():
    """停止 Master 本地模拟器。"""
    stopped = sim_runner.stop()
    if stopped:
        return jsonify({"status": "stopped", "message": "Master simulator stopped"})
    return jsonify({"status": "error", "message": "No running task to stop"}), 400


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

    try:
        nodes = config.add_worker(addr, vcpu)
    except WorkerExistsError as exc:
        return jsonify({"error": str(exc), "addr": addr}), exc.status_code

    return jsonify({"workers": nodes})


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
        worker = None
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


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    print(f"Master listening on 0.0.0.0:{PORT}")
    app.run(host="0.0.0.0", port=PORT)
