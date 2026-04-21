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
PORT = int(os.environ.get("PORT", _config.get("port", 5001)))

runner = SimulatorRunner(SIMULATOR_DIR)


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

    try:
        started = runner.start(spins, job_id, game_name, interval_count)
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


if __name__ == "__main__":
    print(f"Worker listening on 0.0.0.0:{PORT}")
    app.run(host="0.0.0.0", port=PORT)
