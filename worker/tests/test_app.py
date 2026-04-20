"""Worker Flask API 单元测试。"""

from unittest.mock import patch

import pytest

from app import app


@pytest.fixture
def client():
    """创建 Flask test client。"""
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


class TestStartRoute:
    """POST /start 路由测试。"""

    def test_start_success(self, client):
        """成功启动任务返回 200。"""
        with patch("app.runner") as mock_runner:
            mock_runner.start.return_value = True
            resp = client.post(
                "/start",
                json={"spins": 1000, "job_id": "job-1"},
            )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["status"] == "started"
        assert "job-1" in data["message"]

    def test_start_conflict_returns_409(self, client):
        """已有任务运行时返回 409。"""
        with patch("app.runner") as mock_runner:
            mock_runner.start.return_value = False
            resp = client.post(
                "/start",
                json={"spins": 500, "job_id": "job-2"},
            )
        assert resp.status_code == 409
        data = resp.get_json()
        assert "already running" in data["error"].lower()

    def test_start_failure_returns_500(self, client):
        """模拟器启动失败返回 500。"""
        with patch("app.runner") as mock_runner:
            mock_runner.start.side_effect = RuntimeError(
                "Failed to write properties: ..."
            )
            resp = client.post(
                "/start",
                json={"spins": 100, "job_id": "job-3"},
            )
        assert resp.status_code == 500
        data = resp.get_json()
        assert "Failed to start simulator" in data["error"]
        assert "detail" in data


class TestStatusRoute:
    """GET /status 路由测试。"""

    def test_status_idle(self, client):
        """空闲状态返回 idle。"""
        with patch("app.runner") as mock_runner:
            mock_runner.get_status.return_value = {
                "status": "idle",
            }
            resp = client.get("/status")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["status"] == "idle"

    def test_status_running(self, client):
        """运行中返回 running 和 progress。"""
        with patch("app.runner") as mock_runner:
            mock_runner.get_status.return_value = {
                "status": "running",
                "job_id": "job-1",
                "progress": 500,
            }
            resp = client.get("/status")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["status"] == "running"
        assert data["progress"] == 500

    def test_status_completed_with_result(self, client):
        """完成状态返回 result。"""
        result = {
            "spins": 1000,
            "total_spent": 12500.0,
            "total_win": 12125.0,
            "base_spent": 12500.0,
            "base_win": 10625.0,
            "eb_spent": 0.0,
            "eb_win": 1500.0,
        }
        with patch("app.runner") as mock_runner:
            mock_runner.get_status.return_value = {
                "status": "completed",
                "job_id": "job-1",
                "progress": 1000,
                "result": result,
            }
            resp = client.get("/status")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["status"] == "completed"
        assert data["result"]["spins"] == 1000
        assert data["result"]["total_spent"] == 12500.0

    def test_status_error(self, client):
        """错误状态返回 error 信息。"""
        with patch("app.runner") as mock_runner:
            mock_runner.get_status.return_value = {
                "status": "error",
                "job_id": "job-1",
                "error": "Simulator process exited with code 1",
            }
            resp = client.get("/status")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["status"] == "error"
        assert "error" in data
