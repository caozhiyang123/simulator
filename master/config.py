"""Cluster configuration management for the distributed simulator system."""

import json
import os


class WorkerExistsError(Exception):
    """Raised when attempting to add a worker that already exists (409)."""

    def __init__(self, addr: str):
        self.addr = addr
        self.status_code = 409
        super().__init__(f"Worker already exists: {addr}")


class WorkerNotFoundError(Exception):
    """Raised when attempting to remove a worker that does not exist (404)."""

    def __init__(self, addr: str):
        self.addr = addr
        self.status_code = 404
        super().__init__(f"Worker not found: {addr}")


class ClusterConfig:
    """Manages cluster configuration: nodes, allocation mode, poll interval."""

    def __init__(self, config_path: str = "config.json"):
        self._config_path = config_path
        self._master = {"vcpu": 1, "percentage": 100.0}
        self._workers: list[dict] = []
        self._poll_interval: float = 2.0
        self._allocation_mode: str = "vcpu"
        self._progress_save_dir: str = "./progress_data"
        self._simulator_dir: str = ""
        self._production_dir: str = ""

        if os.path.exists(config_path):
            self._load(config_path)

    def _load(self, config_path: str):
        with open(config_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        master_cfg = data.get("master", {})
        self._master = {
            "vcpu": master_cfg.get("vcpu", 1),
            "percentage": master_cfg.get("percentage", 100.0),
        }

        self._workers = []
        for w in data.get("workers", []):
            self._workers.append({
                "addr": w["addr"],
                "vcpu": w.get("vcpu", 1),
                "percentage": w.get("percentage", 0.0),
                "shared_dir": w.get("shared_dir", ""),
                "username": w.get("username"),
                "password": w.get("password"),
            })

        self._poll_interval = data.get("poll_interval", 2.0)
        self._allocation_mode = data.get("allocation_mode", "vcpu")
        self._progress_save_dir = data.get("progress_save_dir", "./progress_data")
        self._simulator_dir = data.get("simulator_dir", "")
        self._production_dir = data.get("production_dir", "")

    def _save(self):
        """Persist current config back to config.json."""
        data = {
            "master": self._master,
            "workers": self._workers,
            "poll_interval": self._poll_interval,
            "allocation_mode": self._allocation_mode,
            "progress_save_dir": self._progress_save_dir,
            "simulator_dir": self._simulator_dir,
            "production_dir": self._production_dir,
        }
        with open(self._config_path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    def get_nodes(self) -> list[dict]:
        """Return all nodes (master + workers) in a unified format."""
        nodes = [
            {
                "addr": "master",
                "vcpu": self._master["vcpu"],
                "percentage": self._master["percentage"],
            }
        ]
        for w in self._workers:
            nodes.append({
                "addr": w["addr"],
                "vcpu": w["vcpu"],
                "percentage": w["percentage"],
            })
        return nodes

    def add_worker(self, addr: str, vcpu: int = 1) -> list[dict]:
        """Add a worker at runtime.

        Raises WorkerExistsError if already present.
        """
        for w in self._workers:
            if w["addr"] == addr:
                raise WorkerExistsError(addr)
        self._workers.append({
            "addr": addr,
            "vcpu": vcpu,
            "percentage": 0.0,
            "shared_dir": "",
            "username": None,
            "password": None,
        })
        self._save()
        return self.get_nodes()

    def remove_worker(self, addr: str) -> list[dict]:
        """Remove a worker at runtime.

        Raises WorkerNotFoundError if not found.
        """
        for i, w in enumerate(self._workers):
            if w["addr"] == addr:
                self._workers.pop(i)
                self._save()
                return self.get_nodes()
        raise WorkerNotFoundError(addr)

    def set_allocation_mode(self, mode: str):
        """Set allocation mode ('vcpu' or 'percentage')."""
        self._allocation_mode = mode
        self._save()

    def get_allocation_mode(self) -> str:
        """Return current allocation mode."""
        return self._allocation_mode

    def set_percentages(self, percentages: dict[str, float]):
        """Set percentage values for nodes.

        Keys are node addrs.
        """
        for addr, pct in percentages.items():
            if addr == "master":
                self._master["percentage"] = pct
            else:
                for w in self._workers:
                    if w["addr"] == addr:
                        w["percentage"] = pct
                        break
        self._save()

    def get_poll_interval(self) -> float:
        """Return current poll interval in seconds."""
        return self._poll_interval

    def set_poll_interval(self, interval: float):
        """Set poll interval in seconds."""
        self._poll_interval = interval
        self._save()

    @property
    def progress_save_dir(self) -> str:
        return self._progress_save_dir

    @property
    def simulator_dir(self) -> str:
        return self._simulator_dir

    @property
    def production_dir(self) -> str:
        return self._production_dir

    @property
    def workers(self) -> list[dict]:
        """Return raw worker list (includes shared_dir, credentials)."""
        return list(self._workers)
