"""模拟器启动与管理模块。

在独立线程中启动模拟器子进程，管理运行状态，
完成后通过 ResultParser 解析结果。
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
    """管理模拟器子进程的启动、状态查询和结果获取。"""

    def __init__(self, simulator_dir: str, production_dir: str = ""):
        self._simulator_dir = simulator_dir
        self._production_dir = production_dir
        self._sim_type: str = "test"
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
        # Per-model results parsed from stdout in real-time
        self._model_results: dict[str, dict] = {}
        self._current_model: str | None = None
        self._current_model_data: dict = {}
        self._models_total: int = 0
        self._models_completed: int = 0
        self._completed_models: set = set()
        self._current_snapshot_dirty: bool = False
        self._last_spin_count: int = 0
        self._current_open_card: str = ""
        self._all_finished: bool = False

    @property
    def _active_dir(self) -> str:
        if self._sim_type == "production":
            return self._production_dir
        return self._simulator_dir

    @property
    def _properties_path(self) -> str:
        return os.path.join(
            self._active_dir, "simulator", "B2BGameSimulator",
            "config", "stresstest.properties"
        )

    @property
    def _simulation_result_dir(self) -> str:
        return os.path.join(
            self._active_dir, "math", self._game_name,
            "simulationResult"
        )

    def _write_spin_times(self, spins: int, interval_count: int | None = None) -> None:
        """覆盖 stresstest.properties 中的 spinTimes 和 intervalCount 值。"""
        ic = interval_count if interval_count is not None else spins

        if self._sim_type == "production":
            prod_dir = self._production_dir
            if os.path.isdir(prod_dir):
                for entry in os.listdir(prod_dir):
                    entry_path = os.path.join(prod_dir, entry)
                    if os.path.isdir(entry_path) and entry.startswith("SimC"):
                        props = os.path.join(
                            entry_path, "simulator", "B2BGameSimulator",
                            "config", "stresstest.properties"
                        )
                        self._write_properties_file(props, spins, ic)
        else:
            self._write_properties_file(self._properties_path, spins, ic)

    def _write_properties_file(self, path: str, spins: int, ic: int) -> None:
        if os.path.isfile(path):
            with open(path, "r", encoding="utf-8") as f:
                content = f.read()
            new_content = re.sub(
                r"^spinTimes\s*=\s*.*$", f"spinTimes={spins}",
                content, flags=re.MULTILINE,
            )
            if f"spinTimes={spins}" not in new_content:
                new_content = new_content.rstrip("\n") + f"\nspinTimes={spins}\n"
            new_content = re.sub(
                r"^intervalCount\s*=\s*.*$", f"intervalCount={ic}",
                new_content, flags=re.MULTILINE,
            )
            if f"intervalCount={ic}" not in new_content:
                new_content = new_content.rstrip("\n") + f"\nintervalCount={ic}\n"
        else:
            new_content = f"spinTimes={spins}\nintervalCount={ic}\n"

        os.makedirs(os.path.dirname(path), exist_ok=True)
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
        if self._sim_type == "production":
            if platform.system() == "Windows":
                return os.path.join(self._production_dir, "start_all.bat")
            return os.path.join(self._production_dir, "start_all.sh")
        else:
            sim_base = os.path.join(
                self._simulator_dir, "simulator", "B2BGameSimulator"
            )
            if platform.system() == "Windows":
                return os.path.join(sim_base, "run.bat")
            return os.path.join(sim_base, "run.sh")

    def _get_start_cwd(self) -> str:
        if self._sim_type == "production":
            return self._production_dir
        return os.path.join(
            self._simulator_dir, "simulator", "B2BGameSimulator"
        )

    def start(self, spins: int, job_id: str, game_name: str = "", interval_count: int | None = None, sim_type: str = "production") -> bool:
        """在独立线程中启动模拟器子进程。

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

            self._sim_type = sim_type
            self._game_name = game_name

            # 覆盖 spinTimes
            try:
                self._write_spin_times(spins, interval_count)
            except OSError as exc:
                self._status = "error"
                self._error = f"Failed to write properties: {exc}"
                raise RuntimeError(self._error) from exc

            # 重置状态
            self._status = "running"
            self._job_id = job_id
            self._progress = 0
            self._result = None
            self._error = None
            self._output_lines = []
            self._model_results = {}
            self._current_model = None
            self._current_model_data = {}
            self._models_total = 0
            self._models_completed = 0
            self._completed_models = set()
            self._current_snapshot_dirty = False
            self._last_spin_count = 0
            self._current_open_card = ""
            self._all_finished = False

        # 在独立线程中启动子进程
        self._thread = threading.Thread(
            target=self._run_simulator,
            args=(spins,),
            daemon=True,
        )
        self._thread.start()
        return True

    def _append_log(self, line: str) -> None:
        with self._lock:
            self._output_lines.append(line)
            if len(self._output_lines) > self._max_log_lines:
                self._output_lines = self._output_lines[-self._max_log_lines:]

    def _parse_log_line(self, line: str) -> None:
        """Parse a stdout line to extract per-model results in real-time."""
        stripped = line.strip()

        # Detect completion marker
        if "All Simulators Finished" in stripped:
            self._finalize_current_snapshot()
            if self._current_model and self._current_model not in self._completed_models:
                with self._lock:
                    self._completed_models.add(self._current_model)
                    self._models_completed = len(self._completed_models)
            with self._lock:
                self._all_finished = True
                if self._status == "running":
                    self._status = "completed"
            return

        # Detect "=== open N card(s) ===" lines (production mode)
        if re.match(r"^===\s*open\s+\d+\s+cards?\s*===$", stripped):
            m = re.search(r"open\s+(\d+)\s+cards?", stripped)
            if m:
                self._current_open_card = f"open {m.group(1)} card"
            return

        if stripped.startswith("working on:"):
            self._finalize_current_snapshot()
            if self._current_model and self._current_model not in self._completed_models:
                with self._lock:
                    self._completed_models.add(self._current_model)
                    self._models_completed = len(self._completed_models)

            rest = stripped[len("working on:"):].strip()
            parts = rest.split()
            raw_name = parts[0] if parts else rest
            # Build composite key: "open N card | filename" when open card is set
            if self._current_open_card:
                model_name = f"{self._current_open_card} | {raw_name}"
            else:
                model_name = raw_name
            self._current_model = model_name
            self._current_model_data = {}
            self._current_snapshot_dirty = False
            self._last_spin_count = 0

            if len(parts) > 1 and "/" in parts[1]:
                try:
                    _, total = parts[1].split("/")
                    self._models_total = int(total)
                except ValueError:
                    pass
            return

        if ":" in stripped and self._current_model:
            key_val = stripped.split(":", 1)
            if len(key_val) == 2:
                key = key_val[0].strip()
                val_str = key_val[1].strip()
                try:
                    val = float(val_str)
                    field_map = {
                        "SPIN COUNT": "spin_count",
                        "TOTAL WON": "total_won",
                        "BASE WON": "base_won",
                        "BASE SPENT": "base_spent",
                        "TOTAL EB WON": "eb_won",
                        "TOTAL EB SPENT": "eb_spent",
                        "TOTAL SPENT": "total_spent",
                    }
                    if key not in field_map:
                        return

                    field = field_map[key]

                    if key == "SPIN COUNT":
                        sc = int(val)
                        if sc > self._last_spin_count:
                            self._finalize_current_snapshot()
                            self._current_model_data = {}
                            self._last_spin_count = sc

                    self._current_model_data[field] = val
                    self._current_snapshot_dirty = True

                    with self._lock:
                        if self._current_model not in self._model_results:
                            self._model_results[self._current_model] = {"latest": {}, "history": []}
                        self._model_results[self._current_model]["latest"] = dict(self._current_model_data)
                except ValueError:
                    pass


    def _finalize_current_snapshot(self) -> None:
        """Save current model data as a history snapshot only if complete (all 7 fields)."""
        required = {"spin_count", "total_won", "base_won", "base_spent", "eb_won", "eb_spent", "total_spent"}
        if (self._current_model and self._current_model_data
                and self._current_snapshot_dirty
                and required.issubset(self._current_model_data.keys())):
            with self._lock:
                if self._current_model not in self._model_results:
                    self._model_results[self._current_model] = {"latest": {}, "history": []}
                self._model_results[self._current_model]["history"].append(dict(self._current_model_data))
                self._model_results[self._current_model]["latest"] = dict(self._current_model_data)
            self._current_snapshot_dirty = False

    def _run_simulator(self, spins: int) -> None:
        """在子线程中执行模拟器进程并实时捕获输出和解析 per-model 数据。"""
        cmd = self._get_start_command()
        try:
            logger.info("Starting simulator: %s", cmd)
            sim_cwd = self._get_start_cwd()
            self._process = subprocess.Popen(
                [cmd],
                cwd=sim_cwd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
                creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if platform.system() == "Windows" else 0,
            )
            for line in self._process.stdout:
                stripped = line.rstrip("\n\r")
                self._append_log(stripped)
                self._parse_log_line(stripped)
                logger.debug("simulator> %s", stripped)

            # Finalize last model
            self._finalize_current_snapshot()
            if self._current_model and self._current_model not in self._completed_models:
                with self._lock:
                    self._completed_models.add(self._current_model)
                    self._models_completed = len(self._completed_models)

            self._process.wait()
            return_code = self._process.returncode

            with self._lock:
                # Don't overwrite if already stopped manually or already completed
                if self._status in ("stopped", "completed"):
                    pass
                elif return_code == 0 or self._all_finished:
                    self._progress = spins
                    self._status = "completed"
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
        """返回当前模拟器状态，包含 per-model 实时结果。"""
        with self._lock:
            response: dict = {"status": self._status}
            if self._job_id is not None:
                response["job_id"] = self._job_id
            if self._status in ("running", "completed"):
                response["progress"] = self._progress
            # Always return model_results if we have any (even after stop)
            response["models_completed"] = self._models_completed
            response["models_total"] = self._models_total
            response["model_results"] = dict(self._model_results)
            if self._status == "error" and self._error:
                response["error"] = self._error
            return response

    def is_running(self) -> bool:
        """检查模拟器是否正在运行。"""
        with self._lock:
            return self._status == "running"

    def stop(self) -> bool:
        """停止正在运行的模拟器子进程（包括子进程树）。"""
        pid = None
        with self._lock:
            if self._status != "running" or self._process is None:
                return False
            pid = self._process.pid
            self._status = "stopped"
            self._error = None

        try:
            if platform.system() == "Windows":
                subprocess.run(
                    ["taskkill", "/T", "/F", "/PID", str(pid)],
                    capture_output=True,
                    timeout=10,
                )
            else:
                import signal
                self._process.send_signal(signal.SIGTERM)
        except Exception as exc:
            logger.error("Failed to stop simulator: %s", exc)

        with self._lock:
            self._process = None
            self._output_lines.append("[STOPPED] Simulator stopped manually")
        return True

    def get_logs(self, since: int = 0) -> dict:
        """获取模拟器输出日志。"""
        with self._lock:
            total = len(self._output_lines)
            lines = self._output_lines[since:]
            return {"lines": lines, "total": total}
