"""Unit tests for ClusterConfig."""

import json

import pytest

from config import ClusterConfig, WorkerExistsError, WorkerNotFoundError


SAMPLE_CONFIG = {
    "master": {"vcpu": 12, "percentage": 40.0},
    "workers": [
        {
            "addr": "192.168.1.2:5001",
            "vcpu": 8,
            "percentage": 30.0,
            "shared_dir": "\\\\192.168.1.2\\shared",
            "username": "admin",
            "password": "pass123",
        },
        {
            "addr": "192.168.1.3:5001",
            "vcpu": 8,
            "percentage": 30.0,
            "shared_dir": "\\\\192.168.1.3\\shared",
        },
    ],
    "poll_interval": 2.0,
    "allocation_mode": "vcpu",
    "progress_save_dir": "./progress_data",
    "simulator_dir": "D:\\tools2\\b2b\\B2BBMM\\B2BSimulator",
    "game_dir": "math\\ShowBingo",
}


@pytest.fixture
def config_file(tmp_path):
    """Write sample config to a temp file and return its path."""
    path = tmp_path / "config.json"
    path.write_text(json.dumps(SAMPLE_CONFIG), encoding="utf-8")
    return str(path)


@pytest.fixture
def cfg(config_file):
    return ClusterConfig(config_path=config_file)


# --- Loading tests ---

class TestConfigLoading:
    def test_loads_master_node(self, cfg):
        nodes = cfg.get_nodes()
        master = nodes[0]
        assert master["addr"] == "master"
        assert master["vcpu"] == 12
        assert master["percentage"] == 40.0

    def test_loads_workers(self, cfg):
        nodes = cfg.get_nodes()
        assert len(nodes) == 3  # master + 2 workers
        assert nodes[1]["addr"] == "192.168.1.2:5001"
        assert nodes[1]["vcpu"] == 8
        assert nodes[2]["addr"] == "192.168.1.3:5001"

    def test_loads_poll_interval(self, cfg):
        assert cfg.get_poll_interval() == 2.0

    def test_loads_allocation_mode(self, cfg):
        assert cfg.get_allocation_mode() == "vcpu"

    def test_missing_config_file_uses_defaults(self, tmp_path):
        cfg = ClusterConfig(config_path=str(tmp_path / "nonexistent.json"))
        nodes = cfg.get_nodes()
        assert len(nodes) == 1
        assert nodes[0]["addr"] == "master"


# --- get_nodes tests ---

class TestGetNodes:
    def test_returns_master_first(self, cfg):
        nodes = cfg.get_nodes()
        assert nodes[0]["addr"] == "master"

    def test_node_format(self, cfg):
        for node in cfg.get_nodes():
            assert "addr" in node
            assert "vcpu" in node
            assert "percentage" in node


# --- add_worker / remove_worker tests ---

class TestWorkerManagement:
    def test_add_worker(self, cfg):
        nodes = cfg.add_worker("10.0.0.1:5001", vcpu=4)
        addrs = [n["addr"] for n in nodes]
        assert "10.0.0.1:5001" in addrs

    def test_add_worker_default_vcpu(self, cfg):
        nodes = cfg.add_worker("10.0.0.1:5001")
        added = [n for n in nodes if n["addr"] == "10.0.0.1:5001"][0]
        assert added["vcpu"] == 1

    def test_add_duplicate_worker_raises_409(self, cfg):
        with pytest.raises(WorkerExistsError) as exc_info:
            cfg.add_worker("192.168.1.2:5001")
        assert exc_info.value.status_code == 409
        assert "192.168.1.2:5001" in str(exc_info.value)

    def test_remove_worker(self, cfg):
        nodes = cfg.remove_worker("192.168.1.2:5001")
        addrs = [n["addr"] for n in nodes]
        assert "192.168.1.2:5001" not in addrs
        assert len(nodes) == 2  # master + 1 remaining worker

    def test_remove_nonexistent_worker_raises_404(self, cfg):
        with pytest.raises(WorkerNotFoundError) as exc_info:
            cfg.remove_worker("10.0.0.99:5001")
        assert exc_info.value.status_code == 404
        assert "10.0.0.99:5001" in str(exc_info.value)

    def test_add_then_remove_roundtrip(self, cfg):
        cfg.add_worker("10.0.0.5:5001", vcpu=2)
        nodes = cfg.remove_worker("10.0.0.5:5001")
        addrs = [n["addr"] for n in nodes]
        assert "10.0.0.5:5001" not in addrs


# --- set_allocation_mode / set_percentages / poll_interval tests ---

class TestConfigMutations:
    def test_set_allocation_mode(self, cfg):
        cfg.set_allocation_mode("percentage")
        assert cfg.get_allocation_mode() == "percentage"

    def test_set_percentages(self, cfg):
        cfg.set_percentages({
            "master": 50.0,
            "192.168.1.2:5001": 25.0,
            "192.168.1.3:5001": 25.0,
        })
        nodes = cfg.get_nodes()
        assert nodes[0]["percentage"] == 50.0
        assert nodes[1]["percentage"] == 25.0
        assert nodes[2]["percentage"] == 25.0

    def test_set_poll_interval(self, cfg):
        cfg.set_poll_interval(5.0)
        assert cfg.get_poll_interval() == 5.0

    def test_set_poll_interval_small(self, cfg):
        cfg.set_poll_interval(0.5)
        assert cfg.get_poll_interval() == 0.5
