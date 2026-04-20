"""Unit tests for TaskSplitter."""

import pytest

from task_splitter import TaskSplitter


@pytest.fixture
def splitter():
    return TaskSplitter()


class TestSplitVcpu:
    """Tests for vCPU-based splitting."""

    def test_even_split(self, splitter):
        nodes = [
            {"addr": "master", "vcpu": 4},
            {"addr": "192.168.1.2:5001", "vcpu": 4},
        ]
        result = splitter.split_vcpu(1000, nodes)
        assert result == {"master": 500, "192.168.1.2:5001": 500}

    def test_remainder_goes_to_master(self, splitter):
        nodes = [
            {"addr": "master", "vcpu": 1},
            {"addr": "192.168.1.2:5001", "vcpu": 1},
            {"addr": "192.168.1.3:5001", "vcpu": 1},
        ]
        result = splitter.split_vcpu(10, nodes)
        assert sum(result.values()) == 10
        # floor(10*1/3) = 3 for each worker, master gets 10-3-3=4
        assert result["master"] == 4
        assert result["192.168.1.2:5001"] == 3
        assert result["192.168.1.3:5001"] == 3

    def test_proportional_split(self, splitter):
        nodes = [
            {"addr": "master", "vcpu": 12},
            {"addr": "192.168.1.2:5001", "vcpu": 8},
            {"addr": "192.168.1.3:5001", "vcpu": 8},
        ]
        result = splitter.split_vcpu(1000000, nodes)
        assert sum(result.values()) == 1000000
        # master >= floor(1000000 * 12/28)
        assert result["master"] >= 1000000 * 12 // 28

    def test_single_master_node(self, splitter):
        nodes = [{"addr": "master", "vcpu": 8}]
        result = splitter.split_vcpu(500000, nodes)
        assert result == {"master": 500000}

    def test_sum_preserved(self, splitter):
        nodes = [
            {"addr": "master", "vcpu": 12},
            {"addr": "w1:5001", "vcpu": 8},
            {"addr": "w2:5001", "vcpu": 8},
        ]
        result = splitter.split_vcpu(999999, nodes)
        assert sum(result.values()) == 999999


class TestSplitPercentage:
    """Tests for percentage-based splitting."""

    def test_even_percentage(self, splitter):
        nodes = [
            {"addr": "master", "percentage": 50.0},
            {"addr": "192.168.1.2:5001", "percentage": 50.0},
        ]
        result = splitter.split_percentage(1000000, nodes)
        assert result == {
            "master": 500000,
            "192.168.1.2:5001": 500000,
        }

    def test_remainder_goes_to_master(self, splitter):
        nodes = [
            {"addr": "master", "percentage": 33.34},
            {"addr": "w1:5001", "percentage": 33.33},
            {"addr": "w2:5001", "percentage": 33.33},
        ]
        result = splitter.split_percentage(1000000, nodes)
        assert sum(result.values()) == 1000000
        # Master gets remainder
        assert result["master"] >= 333300

    def test_invalid_percentage_sum_raises(self, splitter):
        nodes = [
            {"addr": "master", "percentage": 50.0},
            {"addr": "w1:5001", "percentage": 30.0},
        ]
        with pytest.raises(ValueError, match="sum to 100%"):
            splitter.split_percentage(1000000, nodes)

    def test_percentage_sum_over_100_raises(self, splitter):
        nodes = [
            {"addr": "master", "percentage": 60.0},
            {"addr": "w1:5001", "percentage": 50.0},
        ]
        with pytest.raises(ValueError):
            splitter.split_percentage(1000000, nodes)

    def test_percentage_within_tolerance(self, splitter):
        """Sum within 0.01 tolerance should not raise."""
        nodes = [
            {"addr": "master", "percentage": 50.005},
            {"addr": "w1:5001", "percentage": 49.999},
        ]
        # sum = 100.004, within 0.01 tolerance
        result = splitter.split_percentage(1000, nodes)
        assert sum(result.values()) == 1000

    def test_single_master_100_percent(self, splitter):
        nodes = [{"addr": "master", "percentage": 100.0}]
        result = splitter.split_percentage(500000, nodes)
        assert result == {"master": 500000}
