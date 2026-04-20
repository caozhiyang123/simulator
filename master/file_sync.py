"""局域网共享目录文件同步与预处理模块。

通过 net use 命令建立/断开共享目录连接，
使用 shutil.copytree 将 Master 本地模拟器文件同步到 Worker 机器。
同步前可清除 Master 本地 simulationResult 文件夹中的文件。
"""

import logging
import os
import shutil
import subprocess

logger = logging.getLogger(__name__)


class FileSync:
    """管理模拟器文件到 Worker 的局域网共享目录同步。"""

    def __init__(self, simulator_dir: str, shared_dir_template: str):
        """初始化 FileSync。

        Args:
            simulator_dir: Master 本地模拟器目录
                （如 D:\\tools2\\b2b\\B2BBMM\\B2BSimulator）
            shared_dir_template: Worker 共享目录模板
                （如 \\\\{ip}\\shared\\）
        """
        self._simulator_dir = simulator_dir
        self._shared_dir_template = shared_dir_template

    def clean_simulation_results(self, game_dir: str):
        """预处理：清除 Master 本地对应游戏目录下 simulationResult 文件夹中的所有文件。

        Args:
            game_dir: 游戏子目录（如 math\\ShowBingo）

        如果 simulationResult 文件夹不存在则静默跳过。
        如果清除失败则记录警告并继续。
        """
        result_dir = os.path.join(
            self._simulator_dir, game_dir, "simulationResult"
        )

        if not os.path.isdir(result_dir):
            logger.debug(
                "simulationResult directory does not exist, skipping: %s",
                result_dir,
            )
            return

        try:
            for filename in os.listdir(result_dir):
                filepath = os.path.join(result_dir, filename)
                try:
                    if os.path.isfile(filepath) or os.path.islink(filepath):
                        os.remove(filepath)
                    elif os.path.isdir(filepath):
                        shutil.rmtree(filepath)
                except OSError as exc:
                    logger.warning(
                        "Failed to remove %s: %s", filepath, exc
                    )
        except OSError as exc:
            logger.warning(
                "Failed to clean simulationResult directory %s: %s",
                result_dir,
                exc,
            )

    def _connect_share(
        self,
        shared_dir: str,
        username: str = None,
        password: str = None,
    ):
        """通过 net use 建立共享目录连接。

        Args:
            shared_dir: 共享目录路径（如 \\\\192.168.1.2\\shared）
            username: 可选认证用户名
            password: 可选认证密码

        Raises:
            RuntimeError: 连接失败时抛出。
        """
        if username and password:
            cmd = [
                "net", "use", shared_dir,
                f"/user:{username}", password,
            ]
        else:
            cmd = ["net", "use", shared_dir]

        logger.info("Connecting to share: %s", shared_dir)
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode != 0:
            raise RuntimeError(
                f"net use failed for {shared_dir}: {result.stderr.strip()}"
            )

    def _disconnect_share(self, shared_dir: str):
        """通过 net use /delete 断开共享目录连接。

        Args:
            shared_dir: 共享目录路径

        断开失败时仅记录警告，不抛出异常。
        """
        logger.info("Disconnecting share: %s", shared_dir)
        try:
            result = subprocess.run(
                ["net", "use", shared_dir, "/delete"],
                capture_output=True,
                text=True,
                check=False,
            )
            if result.returncode != 0:
                logger.warning(
                    "net use /delete failed for %s: %s",
                    shared_dir,
                    result.stderr.strip(),
                )
        except OSError as exc:
            logger.warning(
                "Failed to disconnect share %s: %s", shared_dir, exc
            )

    def sync_to_worker(
        self,
        worker_addr: str,
        shared_dir: str,
        username: str = None,
        password: str = None,
    ) -> dict:
        """通过局域网共享目录将模拟器文件同步到指定 Worker。

        流程：connect → copy（shutil.copytree）→ finally disconnect

        Args:
            worker_addr: Worker 地址（用于日志标识）
            shared_dir: Worker 共享目录路径
            username: 可选认证用户名
            password: 可选认证密码

        Returns:
            dict: {"success": bool, "error": str | None}
        """
        try:
            self._connect_share(shared_dir, username, password)
            try:
                dest = os.path.join(
                    shared_dir,
                    os.path.basename(self._simulator_dir),
                )
                logger.info(
                    "Copying %s -> %s for worker %s",
                    self._simulator_dir,
                    dest,
                    worker_addr,
                )
                shutil.copytree(
                    self._simulator_dir,
                    dest,
                    dirs_exist_ok=True,
                )
                logger.info(
                    "Sync to worker %s completed successfully",
                    worker_addr,
                )
                return {"success": True, "error": None}
            except (OSError, shutil.Error) as exc:
                error_msg = f"Copy failed for worker {worker_addr}: {exc}"
                logger.error(error_msg)
                return {"success": False, "error": error_msg}
        except RuntimeError as exc:
            error_msg = str(exc)
            logger.error(error_msg)
            return {"success": False, "error": error_msg}
        finally:
            self._disconnect_share(shared_dir)

    def sync_to_all_workers(self, workers: list[dict]) -> dict:
        """同步到所有 Worker，每个 Worker 独立执行 connect/copy/disconnect。

        Args:
            workers: Worker 配置列表，每个 dict 包含:
                - addr: Worker 地址
                - shared_dir: 共享目录路径
                - username: (可选) 认证用户名
                - password: (可选) 认证密码

        Returns:
            dict: 每个 Worker 的同步结果
                {"results": {addr: {"success": bool, "error": str | None}}}
        """
        results = {}
        for worker in workers:
            addr = worker["addr"]
            shared_dir = worker.get("shared_dir", "")
            username = worker.get("username")
            password = worker.get("password")

            if not shared_dir:
                logger.warning(
                    "Worker %s has no shared_dir configured, skipping",
                    addr,
                )
                results[addr] = {
                    "success": False,
                    "error": "No shared_dir configured",
                }
                continue

            results[addr] = self.sync_to_worker(
                addr, shared_dir, username, password
            )

        return {"results": results}
