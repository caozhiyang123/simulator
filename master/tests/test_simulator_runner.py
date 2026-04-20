"""Unit tests for Master SimulatorRunner."""

import os
import platform

from simulator_runner import SimulatorRunner


class TestWriteSpinTimes:
    """Tests for _write_spin_times (properties file handling)."""

    def test_creates_file_if_not_exists(self, tmp_path):
        runner = SimulatorRunner(str(tmp_path))
        runner._write_spin_times(100000)
        props = tmp_path / "stresstest.properties"
        assert props.exists()
        assert "spinTimes=100000" in props.read_text()

    def test_overwrites_existing_value(self, tmp_path):
        props = tmp_path / "stresstest.properties"
        props.write_text("spinTimes=500000\n")
        runner = SimulatorRunner(str(tmp_path))
        runner._write_spin_times(200000)
        content = props.read_text()
        assert "spinTimes=200000" in content
        assert "spinTimes=500000" not in content

    def test_preserves_other_properties(self, tmp_path):
        props = tmp_path / "stresstest.properties"
        props.write_text(
            "otherProp=abc\nspinTimes=500000\nfoo=bar\n"
        )
        runner = SimulatorRunner(str(tmp_path))
        runner._write_spin_times(999)
        content = props.read_text()
        assert "spinTimes=999" in content
        assert "otherProp=abc" in content
        assert "foo=bar" in content

    def test_appends_if_no_spin_times_line(self, tmp_path):
        props = tmp_path / "stresstest.properties"
        props.write_text("otherProp=abc\n")
        runner = SimulatorRunner(str(tmp_path))
        runner._write_spin_times(42)
        content = props.read_text()
        assert "spinTimes=42" in content
        assert "otherProp=abc" in content


class TestReadSpinTimes:
    """Tests for _read_spin_times static method."""

    def test_reads_value(self, tmp_path):
        props = tmp_path / "stresstest.properties"
        props.write_text("spinTimes=123456\n")
        val = SimulatorRunner._read_spin_times(str(props))
        assert val == 123456

    def test_returns_none_for_missing_file(self):
        val = SimulatorRunner._read_spin_times("/no/such/file")
        assert val is None

    def test_returns_none_if_no_spin_times(self, tmp_path):
        props = tmp_path / "stresstest.properties"
        props.write_text("otherProp=abc\n")
        val = SimulatorRunner._read_spin_times(str(props))
        assert val is None


class TestGetStartCommand:
    """Tests for _get_start_command OS detection."""

    def test_returns_bat_or_sh(self, tmp_path):
        runner = SimulatorRunner(str(tmp_path))
        cmd = runner._get_start_command()
        if platform.system() == "Windows":
            assert cmd.endswith("start.bat")
        else:
            assert cmd.endswith("start.sh")


class TestInitialState:
    """Tests for initial state of SimulatorRunner."""

    def test_initial_status_is_idle(self, tmp_path):
        runner = SimulatorRunner(str(tmp_path))
        status = runner.get_status()
        assert status["status"] == "idle"

    def test_initial_is_not_running(self, tmp_path):
        runner = SimulatorRunner(str(tmp_path))
        assert runner.is_running() is False


class TestStartRejectsWhenRunning:
    """Tests that start() rejects new tasks when running."""

    def test_rejects_when_running(self, tmp_path):
        runner = SimulatorRunner(str(tmp_path))
        runner._status = "running"
        result = runner.start(1000, "job-2")
        assert result is False


class TestGetStatus:
    """Tests for get_status() return values."""

    def test_idle_status(self, tmp_path):
        runner = SimulatorRunner(str(tmp_path))
        status = runner.get_status()
        assert status == {"status": "idle"}

    def test_running_status(self, tmp_path):
        runner = SimulatorRunner(str(tmp_path))
        runner._status = "running"
        runner._job_id = "job-1"
        runner._progress = 500
        status = runner.get_status()
        assert status["status"] == "running"
        assert status["job_id"] == "job-1"
        assert status["progress"] == 500

    def test_completed_status(self, tmp_path):
        runner = SimulatorRunner(str(tmp_path))
        runner._status = "completed"
        runner._job_id = "job-1"
        runner._progress = 1000
        runner._result = {"spins": 1000, "total_spent": 100.0}
        status = runner.get_status()
        assert status["status"] == "completed"
        assert status["result"] == {
            "spins": 1000, "total_spent": 100.0
        }
        assert status["progress"] == 1000

    def test_error_status(self, tmp_path):
        runner = SimulatorRunner(str(tmp_path))
        runner._status = "error"
        runner._job_id = "job-1"
        runner._error = "Process crashed"
        status = runner.get_status()
        assert status["status"] == "error"
        assert status["error"] == "Process crashed"


class TestStartWithFakeScript:
    """Integration test: start with a real script."""

    def test_start_completes_with_exit_0(self, tmp_path):
        """Create a fake start script that exits 0."""
        sim_result_dir = tmp_path / "simulationResult"
        sim_result_dir.mkdir()
        result_file = (
            sim_result_dir
            / "Test_2025.01.01_00.00.00_highest.txt"
        )
        result_file.write_text(
            "SPIN COUNT = 100\n"
            "TOTAL SPEND = 1000.00\n"
            "TOTAL WIN = 950.00\n"
            "BASE SPEND = 1000.00\n"
            "BASE WIN = 800.00\n"
            "EB SPEND = 0.00\n"
            "EB WIN = 150.00\n"
        )

        if platform.system() == "Windows":
            script = tmp_path / "start.bat"
            script.write_text("@echo off\nexit /b 0\n")
        else:
            script = tmp_path / "start.sh"
            script.write_text("#!/bin/sh\nexit 0\n")
            os.chmod(str(script), 0o755)

        runner = SimulatorRunner(str(tmp_path))
        ok = runner.start(100, "job-test")
        assert ok is True
        assert runner.is_running() is True

        # Wait for thread to finish
        runner._thread.join(timeout=5)

        status = runner.get_status()
        assert status["status"] == "completed"
        assert status["result"]["spins"] == 100
        assert status["progress"] == 100

    def test_start_error_on_nonzero_exit(self, tmp_path):
        """Script exits with non-zero code -> error."""
        if platform.system() == "Windows":
            script = tmp_path / "start.bat"
            script.write_text("@echo off\nexit /b 1\n")
        else:
            script = tmp_path / "start.sh"
            script.write_text("#!/bin/sh\nexit 1\n")
            os.chmod(str(script), 0o755)

        runner = SimulatorRunner(str(tmp_path))
        ok = runner.start(100, "job-err")
        assert ok is True

        runner._thread.join(timeout=5)

        status = runner.get_status()
        assert status["status"] == "error"
        assert "exited with code" in status["error"]
