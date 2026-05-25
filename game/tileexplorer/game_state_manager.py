"""Game State Manager module for Tile Explorer multiplayer system.

Manages in-memory game state for active sessions: initialization,
persistence, recovery, tile actions, and level generation.
"""

import copy
import json
import math
import os
import random
from datetime import datetime, timezone


CONFIG_PATH = os.path.join(os.path.dirname(__file__), "config", "config.json")
STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")

# Board dimensions (matching the client-side constants)
BOARD_W = 600
BOARD_H = 800
TILE_SIZE = 80
MAX_SLOTS = 7


# Shape test functions ported from single.html JavaScript.
# Each returns True if point (x, y) in [-1, 1] is inside the shape.
SHAPE_TESTS = {
    "heart": lambda x, y: (
        (x * x + (y - 0.4) * (y - 0.4) - 0.5) ** 3
        - x * x * (y - 0.4) * (y - 0.4) * (y - 0.4) < 0
    ),
    "apple": lambda x, y: math.sqrt(x * x + (y + 0.1) ** 2) < 0.85,
    "banana": lambda x, y: (
        0.4 < math.sqrt((x + 0.3) ** 2 + y * y) < 0.9
        and -0.5 < math.atan2(y, x + 0.3) < 1.5
    ),
    "star": lambda x, y: (
        math.sqrt(x * x + y * y)
        < 0.6 + 0.3 * math.cos(5 * math.atan2(y, x) + math.pi / 2)
    ),
    "diamond": lambda x, y: abs(x) + abs(y) < 0.9,
    "circle": lambda x, y: x * x + y * y < 0.81,
    "triangle": lambda x, y: y > -0.7 and y < 0.8 - abs(x) * 1.6,
    "cross": lambda x, y: abs(x) < 0.25 or abs(y) < 0.25,
    "arrow": lambda x, y: (
        (abs(x) < 0.18 and -0.8 < y < 0.2)
        or (y >= 0.2 and abs(x) < (0.9 - y) * 0.9)
    ),
    "moon": lambda x, y: (
        x * x + y * y < 0.75
        and (x - 0.4) ** 2 + y * y > 0.45
    ),
    "cloud": lambda x, y: (
        (x + 0.4) ** 2 + (y - 0.1) ** 2 < 0.2
        or x * x + (y - 0.25) ** 2 < 0.3
        or (x - 0.4) ** 2 + (y - 0.1) ** 2 < 0.2
        or (x - 0.15) ** 2 + (y + 0.2) ** 2 < 0.16
        or (x + 0.15) ** 2 + (y + 0.2) ** 2 < 0.16
    ),
    "tree": lambda x, y: (
        (abs(x) < 0.15 and -0.9 < y < -0.3)
        or (y >= -0.3 and abs(x) < 0.7 * (0.9 - y) / 1.2)
    ),
    "fish": lambda x, y: (
        ((x + 0.1) ** 2 / 0.49 + y * y / 0.16 < 1)
        or (x > 0.5 and abs(y) < (x - 0.5) * 1.5 and x < 0.95)
    ),
    "butterfly": lambda x, y: (
        (x + 0.5) ** 2 + y * y < 0.2
        or (x - 0.5) ** 2 + y * y < 0.2
        or (abs(x) < 0.1 and abs(y) < 0.5)
    ),
    "spiral": lambda x, y: (
        abs(math.sqrt(x * x + y * y)
            - (math.atan2(y, x) + math.pi) / (math.pi * 2) * 0.7) < 0.12
        or math.sqrt(x * x + y * y) < 0.1
    ),
    "wave": lambda x, y: abs(y - 0.4 * math.sin(x * 3)) < 0.22,
    "pyramid": lambda x, y: (
        y > -0.8 and y < 0.8
        and abs(x) < 0.75 * (0.85 - y) / 1.6
    ),
    "hexagon": lambda x, y: (
        abs(x) < 0.78 and abs(y) < 0.68
        and abs(x) + abs(y) * 0.577 < 0.88
    ),
    "pentagon": lambda x, y: _pentagon_test(x, y),
    "octagon": lambda x, y: (
        abs(x) < 0.75 and abs(y) < 0.75
        and abs(x) + abs(y) < 1.05
    ),
    "leaf": lambda x, y: _leaf_test(x, y),
    "flower": lambda x, y: (
        math.sqrt(x * x + y * y)
        < 0.35 + 0.35 * abs(math.cos(2.5 * math.atan2(y, x)))
    ),
    "mushroom": lambda x, y: (
        (x * x + (y - 0.2) ** 2 < 0.35 and y > -0.1)
        or (abs(x) < 0.18 and -0.9 <= y <= -0.1)
    ),
    "crown": lambda x, y: (
        (y > -0.5 and y < -0.1 and abs(x) < 0.7)
        or (-0.1 <= y < 0.4 + 0.25 * abs(math.sin(x * 5))
            and abs(x) < 0.7)
    ),
    "bell": lambda x, y: (
        y > -0.9 and y < 0.5
        and abs(x) < 0.15 + 0.5 * (y + 0.9) / 1.5
    ),
    "house": lambda x, y: (
        (abs(x) < 0.55 and -0.8 < y < 0.1)
        or (y >= 0.1 and y < 0.8 - abs(x) * 1.1 and abs(x) < 0.6)
    ),
    "car": lambda x, y: (
        (abs(x) < 0.8 and -0.3 < y < 0.15)
        or (abs(x) < 0.45 and 0.15 <= y < 0.5)
    ),
    "boat": lambda x, y: (
        (y < 0 and y > -0.5 and abs(x) < 0.7 + y * 0.5)
        or (abs(x) < 0.08 and 0 <= y < 0.7)
        or (0 < x < 0.5 and 0.1 < y < 0.6)
    ),
    "plane": lambda x, y: (
        (abs(x) < 0.1 and -0.8 < y < 0.8)
        or (abs(x) < 0.8 and abs(y - 0.1) < 0.08)
        or (abs(x) < 0.3 and abs(y + 0.6) < 0.07)
    ),
    "rocket": lambda x, y: _rocket_test(x, y),
    "lightning": lambda x, y: (
        abs(x - 0.15 * math.sin(y * 4)) < 0.18
        and -0.85 < y < 0.85
    ),
    "snowflake": lambda x, y: _snowflake_test(x, y),
    "sun": lambda x, y: _sun_test(x, y),
    "umbrella": lambda x, y: (
        (x * x + (y - 0.2) ** 2 < 0.45 and y > 0.2)
        or (abs(x) < 0.06 and -0.8 < y <= 0.2)
    ),
    "key": lambda x, y: (
        x * x + (y - 0.5) ** 2 < 0.14
        or (abs(x) < 0.07 and -0.8 < y <= 0.5)
        or (0 <= x < 0.18 and abs(y + 0.5) < 0.05)
        or (0 <= x < 0.14 and abs(y + 0.7) < 0.05)
    ),
    "lock": lambda x, y: (
        (abs(x) < 0.45 and -0.7 < y < 0.1)
        or (x * x + (y - 0.2) ** 2 < 0.14 and y > 0.1)
    ),
    "music_note": lambda x, y: (
        x * x + (y + 0.5) ** 2 < 0.1
        or (abs(x - 0.1) < 0.06 and -0.5 < y < 0.7)
        or (x - 0.1) ** 2 + (y - 0.7) ** 2 < 0.03
    ),
    "guitar": lambda x, y: (
        x * x + (y + 0.4) ** 2 < 0.18
        or (abs(x) < 0.08 and -0.2 < y < 0.6)
        or x * x + (y - 0.65) ** 2 < 0.04
    ),
    "cup": lambda x, y: (
        (abs(x) < 0.35 * (1 - 0.2 * (y + 0.8)) and -0.8 < y < 0.4)
        or ((x - 0.4) ** 2 + y * y < 0.05 and x > 0.35)
    ),
    "bottle": lambda x, y: _bottle_test(x, y),
    "hat": lambda x, y: (
        (abs(x) < 0.75 and -0.7 < y < -0.5)
        or (abs(x) < 0.28 and -0.5 <= y < 0.5)
        or (abs(x) < 0.12 and 0.5 <= y < 0.8)
    ),
    "shoe": lambda x, y: (
        (-0.8 < x < 0.4 and -0.35 < y < 0)
        or (0.1 <= x < 0.8 and 0 <= y < 0.3)
    ),
    "glasses": lambda x, y: (
        (x + 0.45) ** 2 + y * y < 0.11
        or (x - 0.45) ** 2 + y * y < 0.11
        or (abs(x) < 0.12 and abs(y) < 0.06)
    ),
    "book": lambda x, y: abs(x) < 0.65 and abs(y) < 0.5,
    "pencil": lambda x, y: _pencil_test(x, y),
    "scissors": lambda x, y: (
        (x + 0.25) ** 2 + (y - 0.5) ** 2 < 0.07
        or (x - 0.25) ** 2 + (y - 0.5) ** 2 < 0.07
        or (abs(x - 0.08 * (0.5 - y)) < 0.06 and -0.7 < y < 0.5)
        or (abs(x + 0.08 * (0.5 - y)) < 0.06 and -0.7 < y < 0.5)
    ),
    "hammer": lambda x, y: (
        (abs(x) < 0.08 and -0.8 < y < 0.3)
        or (abs(x) < 0.38 and 0.3 <= y < 0.6)
    ),
    "wrench": lambda x, y: (
        (abs(x) < 0.06 and -0.5 < y < 0.5)
        or (x * x + (y - 0.6) ** 2 < 0.08
            and x * x + (y - 0.6) ** 2 > 0.02)
        or (x * x + (y + 0.6) ** 2 < 0.08
            and x * x + (y + 0.6) ** 2 > 0.02)
    ),
    "gear": lambda x, y: (
        0.12 < math.sqrt(x * x + y * y)
        < 0.5 + 0.2 * math.cos(8 * math.atan2(y, x))
    ),
    "flag": lambda x, y: (
        (abs(x + 0.6) < 0.06 and -0.8 < y < 0.8)
        or (-0.55 < x < 0.7 and 0 < y < 0.65)
    ),
    "shield": lambda x, y: (
        abs(x) < 0.65 * (1 - max(0, y + 0.2) * 0.7)
        and -0.85 < y < 0.7
    ),
    "sword": lambda x, y: (
        (abs(x) < 0.05 and -0.8 < y < 0.6)
        or (abs(x) < 0.32 and abs(y + 0.1) < 0.06)
        or (abs(x) < 0.09 and -0.9 <= y <= -0.8)
    ),
    "trophy": lambda x, y: (
        (x * x + (y - 0.35) ** 2 < 0.22 and y > 0.05)
        or (abs(x) < 0.07 and -0.3 < y <= 0.05)
        or (abs(x) < 0.32 and -0.5 <= y <= -0.3)
    ),
    "medal": lambda x, y: (
        x * x + (y + 0.2) ** 2 < 0.28
        or (abs(x) < 0.18 and 0.25 < y < 0.8)
    ),
    "gift": lambda x, y: (
        (abs(x) < 0.55 and abs(y) < 0.55)
        or (abs(x) < 0.07 and abs(y) < 0.65)
        or (abs(y) < 0.07 and abs(x) < 0.65)
    ),
    "cake": lambda x, y: (
        (abs(x) < 0.65 and -0.6 < y < -0.2)
        or (abs(x) < 0.5 and -0.2 <= y < 0.2)
        or (abs(x) < 0.35 and 0.2 <= y < 0.5)
    ),
    "candy": lambda x, y: (
        math.sqrt(x * x + y * y) < 0.38
        or (abs(y) < 0.12 and 0.3 < abs(x) < 0.85)
    ),
    "cookie": lambda x, y: x * x + y * y < 0.65,
    "donut": lambda x, y: 0.12 < x * x + y * y < 0.65,
    "cherry": lambda x, y: (
        (x + 0.3) ** 2 + (y + 0.2) ** 2 < 0.13
        or (x - 0.3) ** 2 + (y + 0.2) ** 2 < 0.13
        or (abs(x) < 0.05 and 0 < y < 0.65)
    ),
}


def _pentagon_test(x: float, y: float) -> bool:
    """Test if point is inside a pentagon shape."""
    a = math.atan2(y, x) + math.pi / 2
    r = math.sqrt(x * x + y * y)
    sector = (2 * math.pi) / 5
    s = 0.7 / math.cos(((a % sector) + sector) % sector - math.pi / 5)
    return r < min(0.85, abs(s))


def _leaf_test(x: float, y: float) -> bool:
    """Test if point is inside a leaf shape."""
    r = math.sqrt(x * x + y * y)
    a = math.atan2(y, x)
    sin_a = abs(math.sin(a))
    threshold = 0.8 * (sin_a ** 0.6) if sin_a > 0 else 0
    return r < threshold and r < 0.85


def _rocket_test(x: float, y: float) -> bool:
    """Test if point is inside a rocket shape."""
    if y > 0.5:
        w = 0.28 * (0.9 - y) / 0.4
    elif y > -0.5:
        w = 0.28
    else:
        w = 0.28 + 0.18 * (-0.5 - y) / 0.4
    return abs(x) < w and -0.9 < y < 0.9


def _snowflake_test(x: float, y: float) -> bool:
    """Test if point is inside a snowflake shape."""
    r = math.sqrt(x * x + y * y)
    a = math.atan2(y, x)
    return (r < 0.85 and (
        r < 0.15
        or abs(math.sin(3 * a)) * r < 0.18
        or abs(math.cos(3 * a)) * r < 0.18
    ))


def _sun_test(x: float, y: float) -> bool:
    """Test if point is inside a sun shape."""
    r = math.sqrt(x * x + y * y)
    a = math.atan2(y, x)
    return r < 0.38 or (r < 0.82 and math.cos(8 * a) > 0.3)


def _bottle_test(x: float, y: float) -> bool:
    """Test if point is inside a bottle shape."""
    if y > 0.3:
        w = 0.12
    elif y > 0.1:
        w = 0.12 + 0.22 * (0.3 - y) / 0.2
    else:
        w = 0.34
    return abs(x) < w and -0.8 < y < 0.8


def _pencil_test(x: float, y: float) -> bool:
    """Test if point is inside a pencil shape."""
    if y < -0.6:
        w = 0.14 * (y + 0.9) / 0.3
    else:
        w = 0.14
    return abs(x) < w and -0.9 < y < 0.8


def _get_shape_positions(shape: str, count: int) -> list[dict]:
    """Generate grid positions inside a shape, evenly sampled.

    Mirrors the getShapePositions() function from single.html.
    Returns list of {x, y} dicts with values in [0, 1] range.
    """
    test_fn = SHAPE_TESTS.get(shape, SHAPE_TESTS["circle"])
    candidates = []
    grid_size = math.ceil(math.sqrt(count * 4.5))

    for row in range(grid_size):
        for col in range(grid_size):
            nx = (col / (grid_size - 1)) * 2 - 1 if grid_size > 1 else 0
            ny = (row / (grid_size - 1)) * 2 - 1 if grid_size > 1 else 0
            if test_fn(nx, ny):
                if grid_size > 1:
                    x = 0.08 + (col / (grid_size - 1)) * 0.84
                    y = 0.05 + (row / (grid_size - 1)) * 0.9
                else:
                    x = 0.5
                    y = 0.5
                candidates.append({"x": x, "y": y})

    if len(candidates) <= count:
        return candidates

    # Evenly sample from candidates
    step = len(candidates) / count
    positions = []
    for i in range(count):
        positions.append(candidates[int(i * step)])
    return positions


def _load_config(config_path: str = CONFIG_PATH) -> dict:
    """Load config.json, returning empty dict on failure."""
    try:
        with open(config_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return {}


def _list_images(static_dir: str = STATIC_DIR) -> list[str]:
    """List image files in the static directory, sorted."""
    try:
        files = sorted([
            f for f in os.listdir(static_dir)
            if f.lower().endswith(('.png', '.jpg', '.jpeg'))
        ])
        return [f"/static/{f}" for f in files]
    except OSError:
        return []


class GameStateManager:
    """Manages in-memory game state for active sessions.

    Game states are stored in a dict keyed by (unique_code, room_code).
    For single-player sessions, room_code is None.
    """

    def __init__(self, config_path: str = CONFIG_PATH,
                 static_dir: str = STATIC_DIR):
        self._config_path = config_path
        self._static_dir = static_dir
        # In-memory store: {(unique_code, room_code): game_state_dict}
        self._states: dict[tuple[str, str | None], dict] = {}
        # Persisted store (backup for recovery)
        self._persisted: dict[tuple[str, str | None], dict] = {}

    def _state_key(self, unique_code: str,
                   room_code: str | None) -> tuple[str, str | None]:
        """Build the dict key for a game state."""
        return (unique_code, room_code)

    def init_game_state(self, unique_code: str, level: int,
                        room_code: str | None = None) -> dict:
        """Initialize a new game state for a player at a given level.

        Generates the tile layout using config and stores it in memory.
        Returns the new game state dict.
        """
        level = max(1, min(60, level))
        layout = self.generate_level(level)
        state = {
            "unique_code": unique_code,
            "room_code": room_code,
            "level": level,
            "tiles": layout["tiles"],
            "slots": [],
            "remaining": len(layout["tiles"]),
            "game_over": False,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        key = self._state_key(unique_code, room_code)
        self._states[key] = state
        return state

    def get_game_state(self, unique_code: str,
                       room_code: str | None = None) -> dict | None:
        """Retrieve persisted game state for recovery.

        Checks in-memory active states first, then persisted backup.
        Returns None if no state exists.
        If state is corrupted (missing required keys), returns None
        so caller can reinitialize.
        """
        key = self._state_key(unique_code, room_code)
        # Check active states first
        state = self._states.get(key)
        if state and self._is_valid_state(state):
            return state
        # Check persisted backup
        state = self._persisted.get(key)
        if state and self._is_valid_state(state):
            # Restore to active
            self._states[key] = state
            return state
        # Corrupted or missing — discard
        if key in self._states:
            del self._states[key]
        if key in self._persisted:
            del self._persisted[key]
        return None

    def apply_tile_action(self, unique_code: str,
                          room_code: str | None,
                          action: dict) -> dict:
        """Apply a tile action, validate, and update state.

        Supported action types:
        - "select_tile": {"type": "select_tile", "tile_id": int}
          Moves a tile from the board to the slot area and checks
          for triple matches.

        Returns the updated game state.
        Raises ValueError if state not found or action is invalid.
        """
        key = self._state_key(unique_code, room_code)
        state = self._states.get(key)
        if state is None:
            raise ValueError("No active game state found")

        action_type = action.get("type")

        # Allow undo even when game_over (slots full), but block other actions
        if state["game_over"] and action_type != "undo_tile":
            raise ValueError("Game is already over")

        if action_type == "select_tile":
            self._apply_select_tile(state, action)
        elif action_type == "undo_tile":
            self._apply_undo_tile(state)
        elif action_type == "use_magic":
            self._apply_use_magic(state, action)
        else:
            raise ValueError(f"Unknown action type: {action_type}")

        # Update timestamp
        state["timestamp"] = datetime.now(timezone.utc).isoformat()
        # Auto-persist after action (Req 8.1)
        self.persist_state(unique_code, room_code)
        return state

    def _apply_select_tile(self, state: dict, action: dict) -> None:
        """Move a tile from the board to slots, check triple match.

        A tile is selectable only if no higher-layer tile overlaps it
        and slots are not already full.
        """
        tile_id = action.get("tile_id")
        if tile_id is None:
            raise ValueError("tile_id is required for select_tile")

        tiles = state["tiles"]
        slots = state["slots"]

        # Reject if slots are already full (Req 2.2)
        if len(slots) >= MAX_SLOTS:
            raise ValueError("Slots are full, cannot select more tiles")

        # Find the tile
        tile_idx = None
        tile = None
        for i, t in enumerate(tiles):
            if t["id"] == tile_id:
                tile_idx = i
                tile = t
                break

        if tile is None:
            raise ValueError(f"Tile {tile_id} not found on board")

        # Check if tile is blocked (higher layer tile overlaps)
        tile_layer = tile.get("layer", 0)
        for other in tiles:
            if other["id"] == tile_id:
                continue
            if other.get("layer", 0) <= tile_layer:
                continue
            # Check overlap: distance < 64px in both axes
            if (abs(other["x"] - tile["x"]) < 64
                    and abs(other["y"] - tile["y"]) < 64):
                raise ValueError(f"Tile {tile_id} is blocked")

        # Move tile to slots (preserve original position for undo)
        slot_tile = {
            "id": tile["id"],
            "imgIdx": tile["imgIdx"],
            "img": tile["img"],
            "orig_x": tile["x"],
            "orig_y": tile["y"],
            "orig_layer": tile.get("layer", 0),
            "orig_z": tile.get("z", 0),
        }
        slots.append(slot_tile)
        tiles.pop(tile_idx)

        # Check for triple match
        matches = self._check_triple(slots)

        # Award random magic for each triple match
        if matches > 0:
            state["magic_charges"] = state.get("magic_charges", 0) + matches
            # Assign a random magic type using weighted selection from config
            assigned = self._pick_weighted_magic()
            state["pending_magic"] = assigned

        # Update remaining count
        state["remaining"] = len(tiles)

        # Check win/lose conditions
        if len(tiles) == 0 and len(slots) == 0:
            state["game_over"] = True
        elif len(slots) >= MAX_SLOTS:
            state["game_over"] = True

    def _pick_weighted_magic(self) -> str:
        """Pick a magic type using weighted random selection from config.

        Reads magic.json weights. Falls back to uniform random if
        config is unavailable.
        """
        magic_cfg_path = os.path.join(
            os.path.dirname(__file__), "config", "magic.json"
        )
        try:
            with open(magic_cfg_path, "r", encoding="utf-8") as f:
                cfg = json.load(f)
            types = cfg.get("magic_types", {})
            if not types:
                return random.choice(list(types.keys()) or
                                     ["smoke", "bomb", "flower", "letter"])

            # Build weighted list
            entries = []
            for key, val in types.items():
                weight = val.get("weight", 0)
                if weight > 0:
                    entries.append((key, weight))

            if not entries:
                return random.choice(list(types.keys()))

            # Weighted selection: cumulative ranges
            r = random.random()
            cumulative = 0.0
            for key, weight in entries:
                cumulative += weight
                if r < cumulative:
                    return key

            # Fallback to last entry (handles floating point edge case)
            return entries[-1][0]

        except (OSError, json.JSONDecodeError):
            return random.choice(["smoke", "bomb", "flower", "letter"])

    def _apply_undo_tile(self, state: dict) -> None:
        """Undo the last tile placement: move last slot tile back to board.

        Restores the tile to its original position (x, y, layer, z).
        Only works if there are tiles in the slots.
        If game was over due to slots being full, resets game_over.
        """
        slots = state["slots"]
        tiles = state["tiles"]

        if not slots:
            raise ValueError("No tiles in slots to undo")

        # Pop the last tile from slots
        slot_tile = slots.pop()

        # Restore tile to board with original position
        restored_tile = {
            "id": slot_tile["id"],
            "imgIdx": slot_tile["imgIdx"],
            "img": slot_tile["img"],
            "x": slot_tile.get("orig_x", 0),
            "y": slot_tile.get("orig_y", 0),
            "layer": slot_tile.get("orig_layer", 0),
            "z": slot_tile.get("orig_z", 0),
        }
        tiles.append(restored_tile)

        # Update remaining count
        state["remaining"] = len(tiles)

        # If game was over due to slots full, reset game_over
        if state.get("game_over") and len(slots) < MAX_SLOTS:
            state["game_over"] = False

    def _apply_use_magic(self, state: dict, action: dict) -> None:
        """Use a magic charge. Decrements magic_charges.

        After use, if charges remain, assigns a new random pending magic
        so the player can continue using their accumulated charges.
        """
        charges = state.get("magic_charges", 0)
        if charges <= 0:
            raise ValueError("No magic charges available")

        pending = state.get("pending_magic")
        if not pending:
            # Assign a new magic if charges exist but pending was cleared
            pending = self._pick_weighted_magic()
            state["pending_magic"] = pending

        state["magic_charges"] = charges - 1

        # If charges remain, assign next magic; otherwise clear
        if state["magic_charges"] > 0:
            state["pending_magic"] = self._pick_weighted_magic()
        else:
            state["pending_magic"] = None

        # Store the used magic type for the event handler to read
        state["_last_used_magic"] = pending

    def _check_triple(self, slots: list[dict]) -> int:
        """Remove groups of 3 matching tiles from slots (recursive).

        Returns the number of triple matches removed.
        """
        counts: dict[int, list[int]] = {}
        for i, s in enumerate(slots):
            img_idx = s["imgIdx"]
            if img_idx not in counts:
                counts[img_idx] = []
            counts[img_idx].append(i)

        for _img_key, indices in counts.items():
            if len(indices) >= 3:
                # Remove last 3 of this type
                to_remove = sorted(indices[-3:], reverse=True)
                for i in to_remove:
                    slots.pop(i)
                # Re-check in case another triple formed
                return 1 + self._check_triple(slots)

        return 0

    def persist_state(self, unique_code: str,
                      room_code: str | None) -> None:
        """Persist current game state to server memory for recovery.

        Copies the active state to the persisted backup store.
        """
        key = self._state_key(unique_code, room_code)
        state = self._states.get(key)
        if state is not None:
            # Deep copy to avoid reference issues
            self._persisted[key] = copy.deepcopy(state)

    def clear_state(self, unique_code: str,
                    room_code: str | None) -> None:
        """Clear game state (idle timeout or explicit clear)."""
        key = self._state_key(unique_code, room_code)
        self._states.pop(key, None)
        self._persisted.pop(key, None)

    def generate_level(self, level: int) -> dict:
        """Generate tile layout for a level using config and shape functions.

        Mirrors the initLevel() logic from single.html:
        1. Load level config (image_count, copies, layers, shape)
        2. Select random images, create tile copies (multiples of 3)
        3. Distribute tiles across layers (bottom gets most)
        4. Position tiles using shape-based grid positions
        5. Apply layer offsets for 3D depth effect

        Returns dict with "tiles" list.
        """
        config = _load_config(self._config_path)
        all_images = _list_images(self._static_dir)
        levels = config.get("levels", {})

        level_key = str(level)
        level_cfg = levels.get(level_key, {
            "image_count": 4, "copies": 3,
            "layers": 1, "shape": "heart"
        })

        num_images = min(
            level_cfg.get("image_count", 4),
            len(all_images) if all_images else 4
        )
        # Ensure copies is a multiple of 3
        raw_copies = level_cfg.get("copies", 3)
        copies = math.ceil(raw_copies / 3) * 3
        shape = level_cfg.get("shape", "heart")
        num_layers = level_cfg.get("layers", 1)

        # Select random images
        if all_images:
            selected = random.sample(
                all_images, min(num_images, len(all_images))
            )
        else:
            # Fallback if no images available
            selected = [f"/static/{i + 1}.PNG" for i in range(num_images)]

        # Create tile data with copies
        tile_data = []
        for i, img in enumerate(selected):
            for _ in range(copies):
                tile_data.append({
                    "id": len(tile_data),
                    "imgIdx": i,
                    "img": img,
                })
        random.shuffle(tile_data)

        total_tiles = len(tile_data)
        return self._position_tiles(
            tile_data, total_tiles, num_layers, shape
        )

    def _position_tiles(self, tile_data: list[dict],
                        total_tiles: int, num_layers: int,
                        shape: str) -> dict:
        """Position tiles across layers using shape-based grid.

        Mirrors the layer distribution and positioning logic from
        single.html's initLevel().
        """
        # Distribute tiles across layers (bottom gets most weight)
        layer_weights = [num_layers - i for i in range(num_layers)]
        total_weight = sum(layer_weights)
        layer_counts = [
            int(total_tiles * w / total_weight) for w in layer_weights
        ]
        # Distribute remainder to bottom layer
        assigned = sum(layer_counts)
        layer_counts[0] += total_tiles - assigned

        # Ensure each layer count is multiple of 3
        for idx in range(num_layers):
            remainder = layer_counts[idx] % 3
            if remainder != 0:
                if idx > 0:
                    layer_counts[idx] -= remainder
                    layer_counts[idx - 1] += remainder
                else:
                    layer_counts[idx] -= remainder
                    target = min(idx + 1, num_layers - 1)
                    layer_counts[target] += remainder

        # Position tiles on each layer
        tile_idx = 0
        global_z = 0

        for layer in range(num_layers):
            count = layer_counts[layer]
            if count <= 0:
                continue
            layer_tiles = tile_data[tile_idx:tile_idx + count]
            tile_idx += count

            # Get shape positions for this layer
            positions = _get_shape_positions(shape, count)
            layer_offset_px = layer * 4

            for idx, t in enumerate(layer_tiles):
                if idx < len(positions):
                    pos = positions[idx]
                else:
                    pos = {"x": random.random() * 0.8 + 0.1,
                           "y": random.random() * 0.8 + 0.1}

                # Scale toward center for upper layers
                scale = 1 - layer * 0.08
                cx, cy = 0.5, 0.5
                sx = cx + (pos["x"] - cx) * scale
                sy = cy + (pos["y"] - cy) * scale

                # Convert to pixel coordinates
                px = sx * (BOARD_W - TILE_SIZE) + layer_offset_px
                py = sy * (BOARD_H - TILE_SIZE) - layer_offset_px
                px = max(0, min(BOARD_W - TILE_SIZE, px))
                py = max(0, min(BOARD_H - TILE_SIZE, py))

                t["x"] = round(px, 2)
                t["y"] = round(py, 2)
                t["layer"] = layer
                t["z"] = global_z
                global_z += 1

        return {"tiles": tile_data}

    def _is_valid_state(self, state: dict) -> bool:
        """Check if a game state dict has all required keys and types.

        Used to detect corruption — if invalid, state is discarded
        and reinitialized (Req 8.6).
        """
        required_keys = [
            "unique_code", "level", "tiles", "slots",
            "remaining", "game_over",
        ]
        for key in required_keys:
            if key not in state:
                return False

        # Validate types
        if not isinstance(state["tiles"], list):
            return False
        if not isinstance(state["slots"], list):
            return False
        if not isinstance(state["level"], int):
            return False
        if not isinstance(state["remaining"], int):
            return False
        if not isinstance(state["game_over"], bool):
            return False

        # Validate tile structure (spot check first tile if any)
        if state["tiles"]:
            tile = state["tiles"][0]
            if not isinstance(tile, dict):
                return False
            tile_keys = ["id", "imgIdx", "img", "x", "y", "layer", "z"]
            for k in tile_keys:
                if k not in tile:
                    return False

        return True
