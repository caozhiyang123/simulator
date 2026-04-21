"""结果文件解析与格式化模块。

解析 Java Simulator 输出的结果文件，提取最后一个 SPIN COUNT 数据段。
文件名格式：{配置文件名}_{时间戳}_highest.txt
时间戳格式：YYYY.MM.DD_HH.MM.SS

与 Worker 端逻辑一致，Master 本地模拟器完成后用此解析本地结果。
"""

import os
import re
from datetime import datetime


class ResultParser:
    """解析 simulationResult 目录下的结果文件。"""

    # 文件名中时间戳的正则：匹配 YYYY.MM.DD_HH.MM.SS
    _TIMESTAMP_RE = re.compile(r"(\d{4}\.\d{2}\.\d{2}_\d{2}\.\d{2}\.\d{2})")
    _TIMESTAMP_FMT = "%Y.%m.%d_%H.%M.%S"

    # 结果文件中各字段的映射（文件中的 key -> 返回字典的 key）
    _FIELD_MAP = {
        "SPIN COUNT": "SPIN COUNT",
        "TOTAL SPEND": "TOTAL SPENT",
        "TOTAL WIN": "TOTAL WON",
        "BASE SPEND": "BASE SPENT",
        "BASE WIN": "BASE WON",
        "EB SPEND": "TOTAL EB SPENT",
        "EB WIN": "TOTAL EB WON",
    }

    @staticmethod
    def find_latest_result(simulation_result_dir: str) -> str | None:
        """在 simulationResult 目录下查找最新的结果文件。

        按文件名中的时间戳排序，返回最新文件的完整路径。
        无匹配文件时返回 None。
        """
        if not os.path.isdir(simulation_result_dir):
            return None

        best_path = None
        best_time = None

        for fname in os.listdir(simulation_result_dir):
            if not fname.endswith("_highest.txt"):
                continue
            match = ResultParser._TIMESTAMP_RE.search(fname)
            if not match:
                continue
            try:
                ts = datetime.strptime(match.group(1), ResultParser._TIMESTAMP_FMT)
            except ValueError:
                continue
            if best_time is None or ts > best_time:
                best_time = ts
                best_path = os.path.join(simulation_result_dir, fname)

        return best_path

    @staticmethod
    def parse(filepath: str) -> dict:
        """解析结果文件，提取最后一个 SPIN COUNT 数据段。

        Returns:
            dict with keys: total_spent, total_win, base_spent, base_win,
                            eb_spent, eb_win, spins

        Raises:
            FileNotFoundError: 文件不存在
            ValueError: 文件格式异常或缺少必要字段
        """
        if not os.path.isfile(filepath):
            raise FileNotFoundError(f"Result file not found: {filepath}")

        with open(filepath, "r", encoding="utf-8") as f:
            content = f.read()

        # 按 SPIN COUNT 分割，取最后一段
        segments = re.split(r"(?=SPIN COUNT\s*=)", content)
        # 过滤掉不含 SPIN COUNT 的前导内容
        segments = [s for s in segments if s.strip().startswith("SPIN COUNT")]

        if not segments:
            raise ValueError(f"No SPIN COUNT segment found in: {filepath}")

        last_segment = segments[-1]
        result = {}

        for file_key, dict_key in ResultParser._FIELD_MAP.items():
            pattern = re.compile(rf"^{re.escape(file_key)}\s*=\s*(.+)$", re.MULTILINE)
            m = pattern.search(last_segment)
            if m is None:
                raise ValueError(
                    f"Missing field '{file_key}' in last segment of: {filepath}"
                )
            raw = m.group(1).strip()
            if dict_key == "spins":
                result[dict_key] = int(raw)
            else:
                result[dict_key] = float(raw)

        return result

    @staticmethod
    def format_result(result: dict) -> str:
        """将结果对象格式化为文本（与结果文件格式一致）。

        Args:
            result: dict with keys spins, total_spent, total_win,
                    base_spent, base_win, eb_spent, eb_win
        """
        lines = [
            f"SPIN COUNT = {result['spins']}",
            f"TOTAL SPEND = {result['total_spent']:.2f}",
            f"TOTAL WIN = {result['total_win']:.2f}",
            f"BASE SPEND = {result['base_spent']:.2f}",
            f"BASE WIN = {result['base_win']:.2f}",
            f"EB SPEND = {result['eb_spent']:.2f}",
            f"EB WIN = {result['eb_win']:.2f}",
        ]
        return "\n".join(lines)
