"""Unit tests for ResultMerger."""

import pytest

from merger import ResultMerger


@pytest.fixture
def merger():
    return ResultMerger()


def _node_result(total_spent, total_win, base_spent, base_win, eb_spent, eb_win, spins):
    return {
        "total_spent": total_spent,
        "total_win": total_win,
        "base_spent": base_spent,
        "base_win": base_win,
        "eb_spent": eb_spent,
        "eb_win": eb_win,
        "spins": spins,
    }


class TestMergeBasic:
    """Basic merge behaviour with all nodes present."""

    def test_single_node(self, merger):
        results = {"master": _node_result(100, 95, 100, 80, 0, 15, 1000)}
        merged = merger.merge(results)

        assert merged["total_spent"] == 100
        assert merged["total_win"] == 95
        assert merged["spins"] == 1000
        assert merged["SPIN_DISTRIBUTION"] == {"master": 1000}
        assert merged["missing_nodes"] == []

    def test_multiple_nodes_sums(self, merger):
        results = {
            "master": _node_result(100, 95, 100, 80, 0, 15, 1000),
            "w1": _node_result(200, 190, 200, 160, 0, 30, 2000),
        }
        merged = merger.merge(results)

        assert merged["total_spent"] == 300
        assert merged["total_win"] == 285
        assert merged["base_spent"] == 300
        assert merged["base_win"] == 240
        assert merged["eb_spent"] == 0
        assert merged["eb_win"] == 45
        assert merged["spins"] == 3000
        assert merged["SPIN_DISTRIBUTION"] == {"master": 1000, "w1": 2000}
        assert merged["missing_nodes"] == []


class TestRTPCalculation:
    """RTP calculation edge cases."""

    def test_rtp_values(self, merger):
        results = {
            "master": _node_result(1000, 970, 1000, 800, 200, 170, 5000),
        }
        merged = merger.merge(results)

        assert merged["TOTAL_RTP"] == pytest.approx(0.97)
        assert merged["BASE_RTP"] == pytest.approx(0.80)
        assert merged["EB_RTP"] == pytest.approx(0.85)

    def test_zero_spent_returns_zero_rtp(self, merger):
        results = {"master": _node_result(0, 0, 0, 0, 0, 0, 0)}
        merged = merger.merge(results)

        assert merged["TOTAL_RTP"] == 0
        assert merged["BASE_RTP"] == 0
        assert merged["EB_RTP"] == 0

    def test_zero_eb_spent_returns_zero_eb_rtp(self, merger):
        results = {"master": _node_result(100, 95, 100, 80, 0, 15, 1000)}
        merged = merger.merge(results)

        assert merged["EB_RTP"] == 0


class TestMissingNodes:
    """Partial failure / missing node handling."""

    def test_missing_node_excluded_from_sums(self, merger):
        results = {
            "master": _node_result(100, 95, 100, 80, 0, 15, 1000),
            "w1": None,
        }
        merged = merger.merge(results)

        assert merged["total_spent"] == 100
        assert merged["spins"] == 1000
        assert merged["SPIN_DISTRIBUTION"] == {"master": 1000}
        assert merged["missing_nodes"] == ["w1"]

    def test_all_nodes_missing(self, merger):
        results = {"master": None, "w1": None, "w2": None}
        merged = merger.merge(results)

        assert merged["total_spent"] == 0
        assert merged["total_win"] == 0
        assert merged["spins"] == 0
        assert merged["TOTAL_RTP"] == 0
        assert merged["BASE_RTP"] == 0
        assert merged["EB_RTP"] == 0
        assert merged["SPIN_DISTRIBUTION"] == {}
        assert set(merged["missing_nodes"]) == {"master", "w1", "w2"}

    def test_empty_results(self, merger):
        merged = merger.merge({})

        assert merged["total_spent"] == 0
        assert merged["spins"] == 0
        assert merged["SPIN_DISTRIBUTION"] == {}
        assert merged["missing_nodes"] == []
