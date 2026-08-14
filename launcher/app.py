"""Launcher Flask 应用。

常驻于每台 Worker 机器上的轻量级"看门人"服务，独立于 worker.exe 运行，
职责仅为启动/停止/查询 worker.exe 进程状态。

设计原因：worker.exe 本身通过 HTTP 接收指令（/start、/stop 等），
但如果 worker.exe 没有运行，就没有进程能接收"启动"请求 —— 因此需要
一个始终在线的独立进程负责把 worker.exe 拉起来，并支持强制关闭。

建议部署方式：随系统启动自动运行（Windows 任务计划程序 / Linux systemd），
与 worker.exe 完全解耦，worker.exe 崩溃或被关闭都不影响 launcher 自身。
"""

import json
import logging
import os
import subprocess
import sys
import time

# PyInstaller 打包后 exe 所在目录，开发时用 __file__ 所在目录
if getattr(sys, 'frozen', False):
    _base_dir = os.path.dirname(sys.executable)
else:
    _base_dir = os.path.dirname(__file__)

from flask import Flask, jsonify, request

try:
    import psutil
except ImportError:
    # pragma: no cover - psutil is a hard requirement, see requirements.txt
    psutil = None

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s"
)
logger = logging.getLogger(__name__)

app = Flask(__name__)

# 优先读取 exe 同级目录下的 config.json
_config_path = os.path.join(_base_dir, "config.json")
_config = {}
if os.path.exists(_config_path):
    with open(_config_path, "r", encoding="utf-8") as _f:
        _config = json.load(_f)

WORKER_EXE_PATH = os.environ.get(
    "LAUNCHER_WORKER_EXE_PATH", _config.get("worker_exe_path", "")
)
WORKER_PROCESS_NAME = os.environ.get(
    "LAUNCHER_WORKER_PROCESS_NAME",
    _config.get("worker_process_name", "worker.exe"),
)
# worker_command: 可选，用于不打包成可执行文件、直接跑源码的场景
# （例如 Linux 上 ["python3", "app.py"]）。配置了它就优先于 worker_exe_path。
WORKER_COMMAND = _config.get("worker_command") or None
WORKER_CWD = (
    os.environ.get("LAUNCHER_WORKER_CWD", _config.get("worker_cwd", ""))
    or os.path.dirname(WORKER_EXE_PATH)
)
PORT = int(os.environ.get("LAUNCHER_PORT", _config.get("port", 5099)))
AUTH_TOKEN = os.environ.get(
    "LAUNCHER_AUTH_TOKEN", _config.get("auth_token", "") or ""
)

# launcher 自身的日志目录
# （worker 在非 Windows 平台或无控制台时的 stdout/stderr 落地文件）
_log_dir = os.path.join(_base_dir, "launcher_logs")
os.makedirs(_log_dir, exist_ok=True)


def _check_auth():
    """校验请求头中的共享密钥（若配置了 auth_token）。

    返回 None 表示通过，否则返回错误响应。
    """
    if not AUTH_TOKEN:
        return None
    provided = request.headers.get("X-Launcher-Token", "")
    if provided != AUTH_TOKEN:
        return jsonify({"error": "unauthorized"}), 401
    return None


def _find_worker_processes():
    """查找当前所有匹配 worker 进程。

    匹配策略（任一命中即算匹配）：
      - 按进程名精确匹配 worker_process_name（打包成可执行文件场景）
      - 按可执行文件完整路径匹配 worker_exe_path（打包成可执行文件场景）
      - 按命令行包含 worker_command 中的脚本路径（直接跑源码场景，例如
        ["python3", "app.py"]。因为多个进程都可能叫 "python3"，只看
        进程名不够，需要检查完整命令行是否包含目标脚本路径）

    Returns:
        list[psutil.Process]
    """
    if psutil is None:
        return []
    matches = []
    target_name = (WORKER_PROCESS_NAME or "").lower()
    target_exe = (
        os.path.normpath(WORKER_EXE_PATH).lower() if WORKER_EXE_PATH else ""
    )
    # 用命令行里的脚本/入口文件名作为源码场景的匹配依据
    # （取 worker_command 最后一个非参数项）
    command_needle = ""
    if WORKER_COMMAND:
        for token in reversed(WORKER_COMMAND):
            if not token.startswith("-"):
                command_needle = os.path.normpath(token).lower()
                break

    for proc in psutil.process_iter(["pid", "name", "exe", "cmdline"]):
        try:
            info = proc.info
            name = (info.get("name") or "").lower()
            exe = (info.get("exe") or "")
            exe_norm = os.path.normpath(exe).lower() if exe else ""
            cmdline = info.get("cmdline") or []
            cmdline_str = " ".join(cmdline).lower()

            if target_name and name == target_name:
                matches.append(proc)
                continue
            if target_exe and exe_norm == target_exe:
                matches.append(proc)
                continue
            if command_needle and command_needle in cmdline_str:
                matches.append(proc)
        except (
            psutil.NoSuchProcess,
            psutil.AccessDenied,
            psutil.ZombieProcess,
        ):
            continue
    return matches


@app.route("/launcher/health", methods=["GET"])
def health():
    """Launcher 自身健康检查（与 worker.exe 是否运行无关）。"""
    return jsonify({
        "status": "ok",
        "worker_exe_path": WORKER_EXE_PATH,
        "worker_process_name": WORKER_PROCESS_NAME,
        "worker_command": WORKER_COMMAND,
    })


@app.route("/launcher/status", methods=["GET"])
def status():
    """查询 worker.exe 当前运行状态。"""
    auth_err = _check_auth()
    if auth_err:
        return auth_err
    procs = _find_worker_processes()
    pids = [p.pid for p in procs]
    return jsonify({"running": len(pids) > 0, "pids": pids})


@app.route("/launcher/start-worker", methods=["POST"])
def start_worker():
    """启动 worker.exe / worker 源码（若已在运行则直接返回 already_running）。

    支持两种启动方式（互斥，WORKER_COMMAND 优先）：
      1. worker_command 配置了：直接执行该命令列表，例如
         ["python3", "app.py"] —— 用于不打包、直接跑源码的场景。
      2. 否则回退到 worker_exe_path：执行打包好的单文件可执行程序。
    """
    auth_err = _check_auth()
    if auth_err:
        return auth_err

    if WORKER_COMMAND:
        argv = list(WORKER_COMMAND)
    else:
        if not WORKER_EXE_PATH:
            return jsonify({
                "error": "worker_exe_path (or worker_command) not "
                         "configured in launcher config.json"
            }), 500
        if not os.path.isfile(WORKER_EXE_PATH):
            return jsonify({
                "error": f"worker executable not found: {WORKER_EXE_PATH}"
            }), 404
        argv = [WORKER_EXE_PATH]

    existing = _find_worker_processes()
    if existing:
        return jsonify({"status": "already_running", "pids": [p.pid for p in existing]})

    try:
        popen_kwargs = {"cwd": WORKER_CWD or None}
        if sys.platform == "win32":
            # 独立控制台窗口 + 独立进程组：
            # launcher 退出/重启不会牵连 worker 进程
            popen_kwargs["creationflags"] = (
                subprocess.CREATE_NEW_CONSOLE
                | subprocess.CREATE_NEW_PROCESS_GROUP
            )
            proc = subprocess.Popen(argv, **popen_kwargs)
        else:
            # 非 Windows：脱离控制终端，stdout/stderr 落地到日志文件
            log_path = os.path.join(_log_dir, "worker_stdout.log")
            log_file = open(log_path, "ab", buffering=0)
            popen_kwargs["stdout"] = log_file
            popen_kwargs["stderr"] = log_file
            popen_kwargs["start_new_session"] = True
            proc = subprocess.Popen(argv, **popen_kwargs)

        # 给进程一点时间起来，再确认一次是否真的存活
        # （快速失败会立刻退出）
        time.sleep(0.5)
        if proc.poll() is not None:
            return jsonify({
                "error": "worker process exited immediately "
                         f"(code={proc.returncode})"
            }), 500

        logger.info("Started worker process, pid=%s, argv=%s", proc.pid, argv)
        return jsonify({"status": "started", "pid": proc.pid})
    except OSError as exc:
        logger.error("Failed to start worker process: %s", exc)
        return jsonify({"error": str(exc)}), 500


@app.route("/launcher/stop-worker", methods=["POST"])
def stop_worker():
    """关闭 worker.exe（按进程名/路径匹配，逐一 terminate，超时后 kill）。"""
    auth_err = _check_auth()
    if auth_err:
        return auth_err

    procs = _find_worker_processes()
    if not procs:
        return jsonify({"status": "not_running"})

    all_pids = [p.pid for p in procs]
    failed = []

    for proc in procs:
        try:
            proc.terminate()
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue

    # 等待优雅退出，超时的强制 kill
    _gone, alive = psutil.wait_procs(procs, timeout=5)
    for proc in alive:
        try:
            proc.kill()
        except (psutil.NoSuchProcess, psutil.AccessDenied) as exc:
            failed.append({"pid": proc.pid, "error": str(exc)})
    if alive:
        _gone2, alive2 = psutil.wait_procs(alive, timeout=3)
        for proc in alive2:
            failed.append({
                "pid": proc.pid,
                "error": "process did not terminate after kill",
            })

    stopped_pids = all_pids

    if failed:
        return jsonify({"status": "partial", "stopped": stopped_pids, "errors": failed}), 207
    logger.info("Stopped worker.exe, pids=%s", stopped_pids)
    return jsonify({"status": "stopped", "stopped": stopped_pids})


if __name__ == "__main__":
    if psutil is None:
        logger.error("psutil is required but not installed. Run: pip install psutil")
        sys.exit(1)
    logger.info("Launcher listening on 0.0.0.0:%s", PORT)
    logger.info("WORKER_EXE_PATH: %s", WORKER_EXE_PATH)
    logger.info("WORKER_PROCESS_NAME: %s", WORKER_PROCESS_NAME)
    logger.info("WORKER_CWD: %s", WORKER_CWD)
    app.run(host="0.0.0.0", port=PORT)
