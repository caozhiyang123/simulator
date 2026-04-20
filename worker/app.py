"""Worker Flask 应用与路由。

提供 POST /start 和 GET /status 两个 HTTP 端点，
用于接收模拟任务和查询运行状态。
"""

import os

from flask import Flask, jsonify, request

from simulator_runner import SimulatorRunner

app = Flask(__name__)

# 从环境变量读取配置，提供默认值
SIMULATOR_DIR = os.environ.get(
    "SIMULATOR_DIR", os.path.join(os.getcwd(), "simulator")
)
PORT = int(os.environ.get("PORT", "5001"))

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

    try:
        started = runner.start(spins, job_id, game_name)
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
