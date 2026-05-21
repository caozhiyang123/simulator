"""Unit tests for IdleTimerManager module."""

import json
import os
import tempfile
import time
import threading

import pytest

from game.tileexplorer.idle_timer_manager import IdleTimerManager


@pytest.fixture
def config_dir(tmp_path):
    """Create a temporary config directory with a valid config.json."""
    config_file = tmp_path / "config.json"
    config_file.write_text(json.dumps({
        "port": 5002,
        "idle_warning_seconds": 10,
        "idle_clear_seconds": 60
    }))
    return str(config_file)


@pytest.fixture
def manager(config_dir):
    """Create an IdleTimerManager with default config."""
    mgr = IdleTimerManager(config_path=config_dir)
    yield mgr
    mgr.stop_monitoring()


class TestConfigParsing:
    """Tests for config loading and default handling."""

    def test_loads_valid_config(self, tmp_path):
        config_file = tmp_path / "config.json"
        config_file.write_text(json.dumps({
            "idle_warning_seconds": 15,
            "idle_clear_seconds": 120
        }))
        mgr = IdleTimerManager(config_path=str(config_file))
        assert mgr.idle_warning_seconds == 15
        assert mgr.idle_clear_seconds == 120

    def test_uses_defaults_when_config_missing(self, tmp_path):
        config_file = tmp_path / "nonexistent.json"
        mgr = IdleTimerManager(config_path=str(config_file))
        assert mgr.idle_warning_seconds == 10
        assert mgr.idle_clear_seconds == 60

    def test_uses_defaults_for_missing_keys(self, tmp_path):
        config_file = tmp_path / "config.json"
        config_file.write_text(json.dumps({"port": 5002}))
        mgr = IdleTimerManager(config_path=str(config_file))
        assert mgr.idle_warning_seconds == 10
        assert mgr.idle_clear_seconds == 60

    def test_uses_defaults_for_non_positive_values(self, tmp_path):
        config_file = tmp_path / "config.json"
        config_file.write_text(json.dumps({
            "idle_warning_seconds": 0,
            "idle_clear_seconds": -5
        }))
        mgr = IdleTimerManager(config_path=str(config_file))
        assert mgr.idle_warning_seconds == 10
        assert mgr.idle_clear_seconds == 60

    def test_minimum_value_is_one(self, tmp_path):
        config_file = tmp_path / "config.json"
        config_file.write_text(json.dumps({
            "idle_warning_seconds": 1,
            "idle_clear_seconds": 1
        }))
        mgr = IdleTimerManager(config_path=str(config_file))
        assert mgr.idle_warning_seconds == 1
        assert mgr.idle_clear_seconds == 1

    def test_uses_defaults_for_invalid_json(self, tmp_path):
        config_file = tmp_path / "config.json"
        config_file.write_text("not valid json {{{")
        mgr = IdleTimerManager(config_path=str(config_file))
        assert mgr.idle_warning_seconds == 10
        assert mgr.idle_clear_seconds == 60

    def test_uses_defaults_for_non_numeric_values(self, tmp_path):
        config_file = tmp_path / "config.json"
        config_file.write_text(json.dumps({
            "idle_warning_seconds": "abc",
            "idle_clear_seconds": None
        }))
        mgr = IdleTimerManager(config_path=str(config_file))
        assert mgr.idle_warning_seconds == 10
        assert mgr.idle_clear_seconds == 60

    def test_float_values_are_truncated_to_int(self, tmp_path):
        config_file = tmp_path / "config.json"
        config_file.write_text(json.dumps({
            "idle_warning_seconds": 7.9,
            "idle_clear_seconds": 30.5
        }))
        mgr = IdleTimerManager(config_path=str(config_file))
        assert mgr.idle_warning_seconds == 7
        assert mgr.idle_clear_seconds == 30

    def test_room_auto_close_seconds_loaded(self, tmp_path):
        """room_auto_close_seconds is read from config."""
        config_file = tmp_path / "config.json"
        config_file.write_text(json.dumps({
            "idle_warning_seconds": 10,
            "idle_clear_seconds": 60,
            "room_auto_close_seconds": 120
        }))
        mgr = IdleTimerManager(config_path=str(config_file))
        assert mgr.room_auto_close_seconds == 120

    def test_room_auto_close_seconds_default(self, tmp_path):
        """room_auto_close_seconds defaults to 60 when missing."""
        config_file = tmp_path / "config.json"
        config_file.write_text(json.dumps({"port": 5002}))
        mgr = IdleTimerManager(config_path=str(config_file))
        assert mgr.room_auto_close_seconds == 60

    def test_room_auto_close_seconds_minimum_1(self, tmp_path):
        """room_auto_close_seconds has minimum of 1."""
        config_file = tmp_path / "config.json"
        config_file.write_text(json.dumps({
            "room_auto_close_seconds": 0
        }))
        mgr = IdleTimerManager(config_path=str(config_file))
        assert mgr.room_auto_close_seconds == 60  # Falls back to default

    def test_room_auto_close_seconds_non_positive_uses_default(self, tmp_path):
        """room_auto_close_seconds uses default for negative values."""
        config_file = tmp_path / "config.json"
        config_file.write_text(json.dumps({
            "room_auto_close_seconds": -10
        }))
        mgr = IdleTimerManager(config_path=str(config_file))
        assert mgr.room_auto_close_seconds == 60


class TestResetTimer:
    """Tests for reset_timer method."""

    def test_reset_timer_records_timestamp(self, manager):
        before = time.time()
        manager.reset_timer("player1")
        after = time.time()

        with manager._lock:
            ts = manager._timers["player1"]
        assert before <= ts <= after

    def test_reset_timer_clears_warning_state(self, manager):
        # Simulate a warned state
        with manager._lock:
            manager._timers["player1"] = time.time() - 100
            manager._warned.add("player1")

        manager.reset_timer("player1")

        with manager._lock:
            assert "player1" not in manager._warned

    def test_reset_timer_multiple_players(self, manager):
        manager.reset_timer("player1")
        manager.reset_timer("player2")

        with manager._lock:
            assert "player1" in manager._timers
            assert "player2" in manager._timers


class TestCheckIdle:
    """Tests for check_idle method."""

    def test_no_actions_for_active_players(self, manager):
        manager.reset_timer("player1")
        actions = manager.check_idle()
        assert actions == []

    def test_warn_action_after_warning_threshold(self, manager):
        # Set last activity to beyond warning threshold
        with manager._lock:
            manager._timers["player1"] = time.time() - (manager.idle_warning_seconds + 1)

        actions = manager.check_idle()
        assert ("player1", "warn") in actions

    def test_no_duplicate_warnings(self, manager):
        with manager._lock:
            manager._timers["player1"] = time.time() - (manager.idle_warning_seconds + 1)

        # First check should warn
        actions1 = manager.check_idle()
        assert ("player1", "warn") in actions1

        # Second check should not warn again
        actions2 = manager.check_idle()
        assert ("player1", "warn") not in actions2

    def test_clear_action_after_clear_threshold(self, manager):
        with manager._lock:
            manager._timers["player1"] = time.time() - (manager.idle_clear_seconds + 1)

        actions = manager.check_idle()
        assert ("player1", "clear") in actions

    def test_clear_removes_player_from_tracking(self, manager):
        with manager._lock:
            manager._timers["player1"] = time.time() - (manager.idle_clear_seconds + 1)

        manager.check_idle()

        with manager._lock:
            assert "player1" not in manager._timers
            assert "player1" not in manager._warned

    def test_multiple_players_different_states(self, manager):
        now = time.time()
        with manager._lock:
            # Active player
            manager._timers["active"] = now
            # Warned player
            manager._timers["idle_warn"] = now - (manager.idle_warning_seconds + 1)
            # Cleared player
            manager._timers["idle_clear"] = now - (manager.idle_clear_seconds + 1)

        actions = manager.check_idle()
        assert ("idle_warn", "warn") in actions
        assert ("idle_clear", "clear") in actions
        # Active player should not appear
        assert not any(code == "active" for code, _ in actions)

    def test_player_between_warn_and_clear_already_warned(self, manager):
        """Player between thresholds who was already warned gets no action."""
        with manager._lock:
            manager._timers["player1"] = time.time() - (manager.idle_warning_seconds + 1)
            manager._warned.add("player1")

        actions = manager.check_idle()
        assert ("player1", "warn") not in actions
        assert ("player1", "clear") not in actions


class TestRemovePlayer:
    """Tests for remove_player method."""

    def test_remove_existing_player(self, manager):
        manager.reset_timer("player1")
        manager.remove_player("player1")

        with manager._lock:
            assert "player1" not in manager._timers

    def test_remove_nonexistent_player_no_error(self, manager):
        # Should not raise
        manager.remove_player("nonexistent")


class TestMonitoring:
    """Tests for start_monitoring and stop_monitoring."""

    def test_start_monitoring_creates_thread(self, manager):
        manager.start_monitoring()
        assert manager.is_monitoring
        assert manager._monitor_thread is not None
        assert manager._monitor_thread.is_alive()
        manager.stop_monitoring()

    def test_stop_monitoring_stops_thread(self, manager):
        manager.start_monitoring()
        manager.stop_monitoring()
        assert not manager.is_monitoring
        assert manager._monitor_thread is None

    def test_start_monitoring_idempotent(self, manager):
        manager.start_monitoring()
        thread1 = manager._monitor_thread
        manager.start_monitoring()
        thread2 = manager._monitor_thread
        assert thread1 is thread2
        manager.stop_monitoring()

    def test_stop_monitoring_when_not_started(self, manager):
        # Should not raise
        manager.stop_monitoring()

    def test_monitor_thread_is_daemon(self, manager):
        manager.start_monitoring()
        assert manager._monitor_thread.daemon is True
        manager.stop_monitoring()

    def test_monitoring_performs_checks(self, tmp_path):
        """Verify the monitoring loop actually calls check_idle."""
        config_file = tmp_path / "config.json"
        config_file.write_text(json.dumps({
            "idle_warning_seconds": 1,
            "idle_clear_seconds": 3
        }))
        mgr = IdleTimerManager(config_path=str(config_file))

        # Add a player that will become idle quickly
        with mgr._lock:
            mgr._timers["player1"] = time.time() - 2  # Already past warning

        mgr.start_monitoring()
        # Wait for at least one check cycle
        time.sleep(6)
        mgr.stop_monitoring()

        # Player should have been cleared by the monitoring loop
        with mgr._lock:
            assert "player1" not in mgr._timers


class TestIdleCallback:
    """Tests for the idle callback mechanism."""

    def test_set_idle_callback(self, manager):
        """set_idle_callback stores the callback function."""
        callback = lambda actions: None
        manager.set_idle_callback(callback)
        assert manager._idle_callback is callback

    def test_callback_invoked_on_idle_actions(self, tmp_path):
        """Callback is invoked when check_idle returns actions."""
        config_file = tmp_path / "config.json"
        config_file.write_text(json.dumps({
            "idle_warning_seconds": 1,
            "idle_clear_seconds": 5
        }))
        mgr = IdleTimerManager(config_path=str(config_file))

        received_actions = []

        def callback(actions):
            received_actions.extend(actions)

        mgr.set_idle_callback(callback)

        # Set a player past warning threshold
        with mgr._lock:
            mgr._timers["player1"] = time.time() - 2

        mgr.start_monitoring()
        time.sleep(6)
        mgr.stop_monitoring()

        # Callback should have been invoked with warn action
        assert any(code == "player1" for code, _ in received_actions)

    def test_callback_not_invoked_when_no_actions(self, tmp_path):
        """Callback is not invoked when no idle actions exist."""
        config_file = tmp_path / "config.json"
        config_file.write_text(json.dumps({
            "idle_warning_seconds": 100,
            "idle_clear_seconds": 200
        }))
        mgr = IdleTimerManager(config_path=str(config_file))

        call_count = [0]

        def callback(actions):
            call_count[0] += 1

        mgr.set_idle_callback(callback)
        mgr.reset_timer("player1")

        mgr.start_monitoring()
        time.sleep(6)
        mgr.stop_monitoring()

        # Callback should not have been called (player is active)
        assert call_count[0] == 0

    def test_callback_exception_does_not_crash_monitor(self, tmp_path):
        """Exception in callback does not crash the monitoring loop."""
        config_file = tmp_path / "config.json"
        config_file.write_text(json.dumps({
            "idle_warning_seconds": 1,
            "idle_clear_seconds": 3
        }))
        mgr = IdleTimerManager(config_path=str(config_file))

        def bad_callback(actions):
            raise RuntimeError("Callback error")

        mgr.set_idle_callback(bad_callback)

        with mgr._lock:
            mgr._timers["player1"] = time.time() - 2

        mgr.start_monitoring()
        time.sleep(6)
        mgr.stop_monitoring()

        # Monitor should still be running (didn't crash)
        # Player should have been cleared eventually
        with mgr._lock:
            assert "player1" not in mgr._timers
