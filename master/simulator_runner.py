"""Master 本地模拟器启动与管理模块。

在独立线程中启动模拟器子进程，管理运行状态，
完成后通过 ResultParser 解析结果。
与 Worker 端 SimulatorRunner 行为一致——Master 自身也作为执行节点参与模拟任务。
"""

import os
import platform
import re
import subprocess
import threading
import logging

from result_parser import ResultParser

logger = logging.getLogger(__name__)


class SimulatorRunner:
    """管理 Master 本地模拟器子进程的启动、状态查询和结果获取。"""

    def __init__(self, simulator_dir: str):
        """初始化 SimulatorRunner。

        Args:
            simulator_dir: 模拟器根目录，如 D:\\tools2\\b2b\\B2BBMM\\B2BSimulator
        """
        self._simulator_dir = simulator_dir
        self._game_name: str = ""
        self._lock = threading.Lock()
        self._status = "idle"
        self._job_id: str | None = None
        self._progress: int | None = None
        self._result: dict | None = None
        self._error: str | None = None
        self._process: subprocess.Popen | None = None
        self._thread: threading.Thread | None = None
        self._output_lines: list[str] = []
        self._max_log_lines: int = 500

    @property
    def _properties_path(self) -> str:
        return os.path.join(
            self._simulator_dir, "simulator", "B2BGameSimulator",
            "config", "stresstest.properties"
        )

    @property
    def _simulation_result_dir(self) -> str:
        return os.path.join(
            self._simulator_dir, "math", self._game_name,
            "simulationResult"
        )

    def _write_spin_times(self, spins: int) -> None:
        """覆盖 stresstest.properties 中的 spinTimes 和 intervalCount 值。

        两个字段保持同步，都设为传入的 spins 值。
        读取现有文件内容，替换对应行；
        如果文件不存在或不含对应字段，则追加。
        """
        path = self._properties_path
        if os.path.isfile(path):
            with open(path, "r", encoding="utf-8") as f:
                content = f.read()
            # 替换 spinTimes
            new_content = re.sub(
                r"^spinTimes\s*=\s*.*$",
                f"spinTimes={spins}",
                content,
                flags=re.MULTILINE,
            )
            if f"spinTimes={spins}" not in new_content:
                new_content = new_content.rstrip("\n") + f"\nspinTimes={spins}\n"
            # 替换 intervalCount
            new_content = re.sub(
                r"^intervalCount\s*=\s*.*$",
                f"intervalCount={spins}",
                new_content,
                flags=re.MULTILINE,
            )
            if f"intervalCount={spins}" not in new_content:
                new_content = new_content.rstrip("\n") + f"\nintervalCount={spins}\n"
        else:
            new_content = f"spinTimes={spins}\nintervalCount={spins}\n"

        with open(path, "w", encoding="utf-8") as f:
            f.write(new_content)

    @staticmethod
    def _read_spin_times(properties_path: str) -> int | None:
        """从 stresstest.properties 文件读取 spinTimes 值。"""
        if not os.path.isfile(properties_path):
            return None
        with open(properties_path, "r", encoding="utf-8") as f:
            for line in f:
                m = re.match(r"^spinTimes\s*=\s*(\d+)", line.strip())
                if m:
                    return int(m.group(1))
        return None

    def _get_start_command(self) -> str:
        """根据操作系统自动选择启动脚本。"""
        sim_base = os.path.join(
            self._simulator_dir, "simulator", "B2BGameSimulator"
        )
        if platform.system() == "Windows":
            return os.path.join(sim_base, "run.bat")
        return os.path.join(sim_base, "run.sh")

    def start(self, spins: int, job_id: str, game_name: str = "") -> bool:
        """在独立线程中启动本地模拟器子进程。

        自动检测 OS 选择 run.bat 或 run.sh。
        启动前覆盖 stresstest.properties 中的 spinTimes。

        Args:
            spins: 模拟旋转次数。
            job_id: 任务唯一标识。
            game_name: 游戏名称，用于定位 simulationResult 目录。

        Returns:
            True 表示成功启动，False 表示已有任务在运行。

        Raises:
            RuntimeError: 模拟器启动失败。
        """
        with self._lock:
            if self._status == "running":
                return False

            # 覆盖 spinTimes
            try:
                self._write_spin_times(spins)
            except OSError as exc:
                self._status = "error"
                self._error = f"Failed to write properties: {exc}"
                raise RuntimeError(self._error) from exc

            # 重置状态
            self._status = "running"
            self._job_id = job_id
            self._game_name = game_name
            self._progress = 0
            self._result = None
            self._error = None
            self._output_lines = []

        # 在独立线程中启动子进程
        self._thread = threading.Thread(
            target=self._run_simulator,
            args=(spins,),
            daemon=True,
        )
        self._thread.start()
        return True

    def _append_log(self, line: str) -> None:
        """Append a line to the output buffer (thread-safe, capped)."""
        with self._lock:
            self._output_lines.append(line)
            if len(self._output_lines) > self._max_log_lines:
                self._output_lines = self._output_lines[-self._max_log_lines:]

    def _run_simulator(self, spins: int) -> None:
        """在子线程中执行模拟器进程并实时捕获输出。"""
        cmd = self._get_start_command()
        try:
            logger.info("Starting local simulator: %s", cmd)
            sim_cwd = os.path.join(
                self._simulator_dir, "simulator", "B2BGameSimulator"
            )
            self._process = subprocess.Popen(
                [cmd],
                cwd=sim_cwd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
            )
            # 实时逐行读取输出
            for line in self._process.stdout:
                stripped = line.rstrip("\n\r")
                self._append_log(stripped)
                logger.debug("simulator> %s", stripped)

            self._process.wait()
            return_code = self._process.returncode

            with self._lock:
                if return_code == 0:
                    self._progress = spins
                    # 解析结果
                    try:
                        result_path = ResultParser.find_latest_result(
                            self._simulation_result_dir
                        )
                        if result_path:
                            self._result = ResultParser.parse(
                                result_path
                            )
                            self._status = "completed"
                        else:
                            self._status = "error"
                            self._error = (
                                "No result file found in "
                                "simulationResult directory"
                            )
                    except (ValueError, FileNotFoundError) as exc:
                        self._status = "error"
                        self._error = (
                            f"Result file parse error: {exc}"
                        )
                else:
                    self._status = "error"
                    self._error = (
                        f"Simulator process exited with "
                        f"code {return_code}"
                    )
        except OSError as exc:
            with self._lock:
                self._status = "error"
                self._error = (
                    f"Failed to start simulator: {exc}"
                )
            logger.error("Simulator start failed: %s", exc)
        finally:
            self._process = None

    def get_status(self) -> dict:
        """返回当前本地模拟器状态。

        Returns:
            dict 包含:
            - status: idle|running|completed|error
            - job_id: 当前任务 ID（非 idle 时）
            - progress: 当前进度（running/completed 时）
            - result: 结果数据（completed 时）
            - error: 错误信息（error 时）
        """
        with self._lock:
            response: dict = {"status": self._status}
            if self._job_id is not None:
                response["job_id"] = self._job_id
            if self._status in ("running", "completed"):
                response["progress"] = self._progress
            if self._status == "completed" and self._result:
                response["result"] = self._result
            if self._status == "error" and self._error:
                response["error"] = self._error
            return response

    def is_running(self) -> bool:
        """检查本地模拟器是否正在运行。"""
        with self._lock:
            return self._status == "running"

    def stop(self) -> bool:
        """停止正在运行的模拟器子进程（包括子进程树）。

        Returns:
            True 表示成功停止，False 表示没有运行中的任务。
        """
        with self._lock:
            if self._status != "running" or self._process is None:
                return False
            try:
                pid = self._process.pid
                # Windows: taskkill /T /F 杀掉整个进程树
                # Linux: kill 进程组
                if platform.system() == "Windows":
                    subprocess.run(
                        ["taskkill", "/T", "/F", "/PID", str(pid)],
                        capture_output=True,
                    )
                else:
                    import signal
                    os.killpg(os.getpgid(pid), signal.SIGTERM)
                self._append_log("[STOPPED] 模拟器已被手动停止")
                self._status = "idle"
                self._error = None
                self._process = None
                return True
            except OSError as exc:
                logger.error("Failed to stop simulator: %s", exc)
                return False

    def get_logs(self, since: int = 0) -> dict:
        """获取模拟器输出日志。

        Args:
            since: 从第几行开始返回（用于增量获取）。

        Returns:
            {"lines": [...], "total": int}
        """
        with self._lock:
            total = len(self._output_lines)
            lines = self._output_lines[since:]
            return {"lines": lines, "total": total}
