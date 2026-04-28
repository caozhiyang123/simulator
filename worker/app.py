"""Worker Flask 应用与路由。

提供 POST /start、GET /status、POST /stop、GET /logs 端点，
用于接收模拟任务、查询运行状态、停止任务和获取日志。
"""

import json
import os
import sys

# PyInstaller 打包后 exe 所在目录，开发时用 __file__ 所在目录
if getattr(sys, 'frozen', False):
    _base_dir = os.path.dirname(sys.executable)
    # 把 PyInstaller 临时解压目录加到 sys.path，以便导入本地模块
    sys.path.insert(0, sys._MEIPASS)
else:
    _base_dir = os.path.dirname(__file__)

from flask import Flask, jsonify, request

from simulator_runner import SimulatorRunner

app = Flask(__name__)

# PyInstaller 打包后 exe 所在目录，开发时用 __file__ 所在目录
if getattr(sys, 'frozen', False):
    _base_dir = os.path.dirname(sys.executable)
else:
    _base_dir = os.path.dirname(__file__)

# 优先读取 exe 同级目录下的 config.json
_config_path = os.path.join(_base_dir, "config.json")
_config = {}
if os.path.exists(_config_path):
    with open(_config_path, "r", encoding="utf-8") as _f:
        _config = json.load(_f)

SIMULATOR_DIR = os.environ.get("SIMULATOR_DIR", _config.get("simulator_dir", ""))
PRODUCTION_DIR = os.environ.get("PRODUCTION_DIR", _config.get("production_dir", ""))
PORT = int(os.environ.get("PORT", _config.get("port", 5001)))

runner = SimulatorRunner(SIMULATOR_DIR, PRODUCTION_DIR)


@app.route("/start", methods=["POST"])
def start():
    """启动模拟任务。

    请求体: {"spins": int, "job_id": str}
    成功: 200 {"status": "started", "message": "..."}
    冲突: 409 {"error": "Task already running", "job_id": "..."}
    失败: 500 {"error": "Failed to start simulator", "detail": "..."}
    """
    data = request.get_json(force=True)
    spins = data.get("spins")
    job_id = data.get("job_id")
    game_name = data.get("game_name", "")
    interval_count = data.get("interval_count")
    sim_type = data.get("sim_type", "production")

    try:
        started = runner.start(spins, job_id, game_name, interval_count, sim_type)
    except RuntimeError as exc:
        return jsonify({
            "error": "Failed to start simulator",
            "detail": str(exc),
        }), 500

    if not started:
        return jsonify({
            "error": "Task already running",
            "job_id": job_id,
        }), 409

    return jsonify({
        "status": "started",
        "message": f"Job {job_id} started with {spins} spins",
    })


@app.route("/status", methods=["GET"])
def status():
    """查询运行状态。"""
    return jsonify(runner.get_status())


@app.route("/stop", methods=["POST"])
def stop():
    """停止正在运行的模拟器。"""
    stopped = runner.stop()
    if stopped:
        return jsonify({"status": "stopped", "message": "Simulator stopped"})
    return jsonify({"status": "error", "message": "No running task to stop"}), 400


@app.route("/logs", methods=["GET"])
def logs():
    """获取模拟器输出日志。"""
    since = request.args.get("since", 0, type=int)
    return jsonify(runner.get_logs(since))


@app.route("/files/browse", methods=["GET"])
def browse_files():
    """Browse directory contents on this worker.

    Query param: ?path=absolute/path (defaults to production_dir)
    Special: ?path=__drives__ lists all drive letters (Windows)
    """
    import platform as _plat
    browse_path = request.args.get("path", "")

    # List all drives (Windows)
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

    if not browse_path or browse_path == "default":
        browse_path = PRODUCTION_DIR
    if not browse_path:
        return jsonify({"error": "production_dir not configured in worker config.json"}), 400
    if not os.path.isdir(browse_path):
        return jsonify({"error": f"Directory not found: {browse_path}"}), 404

    full_path = os.path.normpath(browse_path)
    parent = os.path.dirname(full_path)
    if parent == full_path:
        parent = "__drives__" if _plat.system() == "Windows" else ""
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


@app.route("/files/upload", methods=["POST"])
def upload_file():
    """Upload a file to a specific absolute path on this worker.

    Form data:
      - file: the file content
      - path: absolute directory path to save into
    """
    target_dir = request.form.get("path", "")
    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400

    if not target_dir:
        target_dir = PRODUCTION_DIR
    target_dir = os.path.normpath(target_dir)

    f = request.files["file"]
    os.makedirs(target_dir, exist_ok=True)
    target_path = os.path.join(target_dir, f.filename)
    f.save(target_path)
    return jsonify({"status": "ok", "path": target_path.replace("\\", "/")})


@app.route("/files/read", methods=["GET"])
def read_file():
    """Read file content for preview.

    Query param: ?path=absolute/path
    """
    file_path = request.args.get("path", "")
    full = os.path.normpath(file_path)
    if not os.path.isfile(full):
        return jsonify({"error": "File not found"}), 404
    try:
        with open(full, "r", encoding="utf-8") as f:
            content = f.read(100000)  # limit to 100KB
        return jsonify({"path": file_path, "content": content, "size": os.path.getsize(full)})
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@app.route("/files/write", methods=["POST"])
def write_file():
    """Write content to a file on this worker.

    Request body: {"path": "absolute/path", "content": "file content"}
    """
    data = request.get_json(force=True)
    file_path = data.get("path", "")
    content = data.get("content", "")
    full = os.path.normpath(file_path)
    try:
        with open(full, "w", encoding="utf-8") as f:
            f.write(content)
        return jsonify({"status": "ok", "path": file_path})
    except OSError as exc:
        return jsonify({"error": str(exc)}), 500


@app.route("/files/delete", methods=["POST"])
def delete_files():
    """Delete files or directories on this worker.

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


@app.route("/sysinfo", methods=["GET"])
def sysinfo():
    """Return system CPU and memory info."""
    import psutil
    cpu_pct = psutil.cpu_percent(interval=0.5)
    mem = psutil.virtual_memory()
    return jsonify({
        "cpu_percent": cpu_pct,
        "cpu_count": psutil.cpu_count(),
        "mem_total_mb": round(mem.total / 1024 / 1024),
        "mem_used_mb": round(mem.used / 1024 / 1024),
        "mem_percent": mem.percent,
    })


if __name__ == "__main__":
    print(f"Worker listening on 0.0.0.0:{PORT}")
    print(f"SIMULATOR_DIR: {SIMULATOR_DIR}")
    print(f"PRODUCTION_DIR: {PRODUCTION_DIR}")
    app.run(host="0.0.0.0", port=PORT)
