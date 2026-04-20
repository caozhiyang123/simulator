"""Task splitting logic for distributing spins across cluster nodes."""

import math


class TaskSplitter:
    """Splits total spins across nodes using vCPU or percentage mode."""

    def split_vcpu(self, total_spins: int, nodes: list[dict]) -> dict[str, int]:
        """Split spins proportionally by vCPU count; remainder goes to Master.

        Args:
            total_spins: Total number of spins to distribute.
            nodes: List of node dicts with 'addr' and 'vcpu' keys.
                   e.g. [{"addr": "master", "vcpu": 12}, {"addr": "ip:port", "vcpu": 8}]

        Returns:
            Dict mapping node addr to assigned spins.
        """
        total_vcpu = sum(n["vcpu"] for n in nodes)
        result = {}
        non_master_sum = 0

        for node in nodes:
            if node["addr"] != "master":
                share = math.floor(total_spins * node["vcpu"] / total_vcpu)
                result[node["addr"]] = share
                non_master_sum += share

        result["master"] = total_spins - non_master_sum
        return result

    def split_percentage(self, total_spins: int, nodes: list[dict]) -> dict[str, int]:
        """Split spins by percentage; remainder goes to Master.

        Args:
            total_spins: Total number of spins to distribute.
            nodes: List of node dicts with 'addr' and 'percentage' keys.
                   e.g. [{"addr": "master", "percentage": 50.0}, {"addr": "ip:port", "percentage": 25.0}]

        Returns:
            Dict mapping node addr to assigned spins.

        Raises:
            ValueError: If percentages do not sum to 100%.
        """
        pct_sum = sum(n["percentage"] for n in nodes)
        if abs(pct_sum - 100.0) >= 0.01:
            raise ValueError(
                f"Percentages must sum to 100%, got {pct_sum}"
            )

        result = {}
        non_master_sum = 0

        for node in nodes:
            if node["addr"] != "master":
                share = math.floor(total_spins * node["percentage"] / 100.0)
                result[node["addr"]] = share
                non_master_sum += share

        result["master"] = total_spins - non_master_sum
        return result
