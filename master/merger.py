"""Result merging and RTP calculation for distributed simulation results."""


class ResultMerger:
    """Merges results from all cluster nodes and computes RTP metrics."""

    _SUM_FIELDS = (
        "total_spent",
        "total_win",
        "base_spent",
        "base_win",
        "eb_spent",
        "eb_win",
        "spins",
    )

    def merge(self, results: dict[str, dict]) -> dict:
        """Merge all node results and calculate RTP.

        Args:
            results: Dict mapping node addr to result dict.
                     A node with ``None`` value is treated as missing/failed.
                     e.g. {
                         "master": {"total_spent": 100, "total_win": 95, ...},
                         "192.168.1.2:5001": {"total_spent": 80, ...},
                         "192.168.1.3:5001": None  # missing node
                     }

        Returns:
            Dict with aggregated fields, RTP values, SPIN_DISTRIBUTION,
            and missing_nodes list.
        """
        missing_nodes: list[str] = []
        spin_distribution: dict[str, int] = {}
        totals: dict[str, float] = {field: 0 for field in self._SUM_FIELDS}

        for addr, node_result in results.items():
            if node_result is None:
                missing_nodes.append(addr)
                continue

            for field in self._SUM_FIELDS:
                totals[field] += node_result.get(field, 0)

            spin_distribution[addr] = node_result.get("spins", 0)

        total_spent = totals["total_spent"]
        base_spent = totals["base_spent"]
        eb_spent = totals["eb_spent"]

        return {
            **totals,
            "TOTAL_RTP": totals["total_win"] / total_spent if total_spent else 0,
            "BASE_RTP": totals["base_win"] / base_spent if base_spent else 0,
            "EB_RTP": totals["eb_win"] / eb_spent if eb_spent else 0,
            "SPIN_DISTRIBUTION": spin_distribution,
            "missing_nodes": missing_nodes,
        }
