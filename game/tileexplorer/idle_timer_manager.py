"""Idle Timer Manager module for tracking player inactivity.

Monitors player activity timestamps and triggers idle warnings and clears
based on configurable thresholds read from config.json.
"""

import json
import os
import threading
import time


class IdleTimerManager:
    """Tracks player activity and triggers idle warnings/clears.

    Reads idle_warning_seconds, idle_clear_seconds, and
    room_auto_close_seconds from config.json.
    Uses defaults (10, 60, 60) if values are missing or non-positive.
    All values have a minimum of 1.
    """

    DEFAULT_WARNING_SECONDS = 10
    DEFAULT_CLEAR_SECONDS = 60
    DEFAULT_ROOM_AUTO_CLOSE_SECONDS = 60

    def __init__(self, config_path: str | None = None):
        """Initialize the IdleTimerManager.

        Args:
            config_path: Path to config.json. If None, uses
                default location.
        """
        if config_path is None:
            config_path = os.path.join(
                os.path.dirname(__file__), "config", "config.json"
            )
        self._config_path = config_path
        warning, clear, room_auto_close = self._load_config()
        self._idle_warning_seconds = warning
        self._idle_clear_seconds = clear
        self._room_auto_close_seconds = room_auto_close

        # Dictionary mapping unique_code -> last activity timestamp
        self._timers: dict[str, float] = {}
        # Set of unique_codes already warned (avoid duplicates)
        self._warned: set[str] = set()
        # Lock for thread-safe access
        self._lock = threading.Lock()

        # Background monitoring thread state
        self._monitoring = False
        self._monitor_thread: threading.Thread | None = None
        self._stop_event = threading.Event()

        # Callback for idle actions (set by socketio integration)
        self._idle_callback = None

    @property
    def idle_warning_seconds(self) -> int:
        """The configured idle warning threshold in seconds."""
        return self._idle_warning_seconds

    @property
    def idle_clear_seconds(self) -> int:
        """The configured idle clear threshold in seconds."""
        return self._idle_clear_seconds

    @property
    def room_auto_close_seconds(self) -> int:
        """The configured room auto-close threshold in seconds."""
        return self._room_auto_close_seconds

    def set_idle_callback(self, callback_fn) -> None:
        """Set a callback function for idle actions.

        The callback receives a list of (unique_code, action) tuples
        where action is 'warn' or 'clear'.

        Args:
            callback_fn: Callable that accepts list of (str, str) tuples.
        """
        self._idle_callback = callback_fn

    def _load_config(self) -> tuple[int, int, int]:
        """Load idle thresholds from config.json.

        Returns:
            Tuple of (idle_warning_seconds, idle_clear_seconds,
            room_auto_close_seconds) with defaults applied for
            missing or non-positive values. Minimum value is 1.
        """
        warning = self.DEFAULT_WARNING_SECONDS
        clear = self.DEFAULT_CLEAR_SECONDS
        room_auto_close = self.DEFAULT_ROOM_AUTO_CLOSE_SECONDS

        try:
            with open(self._config_path, "r", encoding="utf-8") as f:
                config = json.load(f)

            # Parse idle_warning_seconds
            raw_warning = config.get("idle_warning_seconds")
            if isinstance(raw_warning, (int, float)):
                parsed_warning = int(raw_warning)
                if parsed_warning >= 1:
                    warning = parsed_warning

            # Parse idle_clear_seconds
            raw_clear = config.get("idle_clear_seconds")
            if isinstance(raw_clear, (int, float)):
                parsed_clear = int(raw_clear)
                if parsed_clear >= 1:
                    clear = parsed_clear

            # Parse room_auto_close_seconds
            raw_auto_close = config.get("room_auto_close_seconds")
            if isinstance(raw_auto_close, (int, float)):
                parsed_auto_close = int(raw_auto_close)
                if parsed_auto_close >= 1:
                    room_auto_close = parsed_auto_close

        except (OSError, json.JSONDecodeError, TypeError):
            # If config can't be read or parsed, use defaults
            pass

        return warning, clear, room_auto_close

    def reset_timer(self, unique_code: str) -> None:
        """Reset idle timer for a player (activity detected).

        Records the current timestamp as the player's last activity time.
        Also clears any existing warning state for the player.

        Args:
            unique_code: The player's unique identifier.
        """
        with self._lock:
            self._timers[unique_code] = time.time()
            self._warned.discard(unique_code)

    def check_idle(self) -> list[tuple[str, str]]:
        """Check all players and return idle actions.

        Returns:
            List of (unique_code, action) tuples where action is:
            - 'warn': Player has exceeded idle_warning_seconds but not
              idle_clear_seconds, and hasn't been warned yet.
            - 'clear': Player has exceeded idle_clear_seconds.
        """
        now = time.time()
        actions: list[tuple[str, str]] = []

        with self._lock:
            codes_to_remove: list[str] = []

            for unique_code, last_activity in self._timers.items():
                elapsed = now - last_activity

                if elapsed >= self._idle_clear_seconds:
                    actions.append((unique_code, "clear"))
                    codes_to_remove.append(unique_code)
                elif (
                    elapsed >= self._idle_warning_seconds
                    and unique_code not in self._warned
                ):
                    actions.append((unique_code, "warn"))
                    self._warned.add(unique_code)

            # Remove cleared players from tracking
            for code in codes_to_remove:
                del self._timers[code]
                self._warned.discard(code)

        return actions

    def remove_player(self, unique_code: str) -> None:
        """Remove a player from idle tracking.

        Args:
            unique_code: The player's unique identifier.
        """
        with self._lock:
            self._timers.pop(unique_code, None)
            self._warned.discard(unique_code)

    def start_monitoring(self) -> None:
        """Start background thread for periodic idle checks.

        The thread checks every 5 seconds and is a daemon thread
        that can be stopped gracefully via stop_monitoring().
        """
        if self._monitoring:
            return

        self._stop_event.clear()
        self._monitoring = True
        self._monitor_thread = threading.Thread(
            target=self._monitor_loop, daemon=True, name="IdleTimerMonitor"
        )
        self._monitor_thread.start()

    def stop_monitoring(self) -> None:
        """Stop background monitoring gracefully.

        Signals the monitoring thread to stop and waits for it to finish.
        """
        if not self._monitoring:
            return

        self._monitoring = False
        self._stop_event.set()

        if self._monitor_thread is not None:
            self._monitor_thread.join(timeout=10)
            self._monitor_thread = None

    def _monitor_loop(self) -> None:
        """Background loop that checks idle status every 5 seconds.

        If an idle callback is set, it will be invoked with the
        list of idle actions returned by check_idle().
        """
        while not self._stop_event.is_set():
            actions = self.check_idle()
            if actions and self._idle_callback:
                try:
                    self._idle_callback(actions)
                except Exception:
                    pass  # Don't crash the monitor loop
            # Wait 5 seconds or until stop is signaled
            self._stop_event.wait(timeout=5)

    @property
    def is_monitoring(self) -> bool:
        """Whether the background monitoring thread is running."""
        return self._monitoring
