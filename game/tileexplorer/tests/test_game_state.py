"""Unit tests for GameStateManager module."""

import json
import os
import tempfile

import pytest

from game.tileexplorer.game_state_manager import (
    GameStateManager,
    _get_shape_positions,
    SHAPE_TESTS,
)


@pytest.fixture
def tmp_config(tmp_path):
    """Create a temporary config.json with test level data."""
    config = {
        "port": 5002,
        "levels": {
            "1": {"image_count": 5, "copies": 9, "layers": 2, "shape": "heart"},
            "2": {"image_count": 4, "copies": 6, "layers": 1, "shape": "circle"},
            "3": {"image_count": 3, "copies": 3, "layers": 1, "shape": "diamond"},
        }
    }
    config_file = tmp_path / "config.json"
    config_file.write_text(json.dumps(config), encoding="utf-8")
    return str(config_file)


@pytest.fixture
def tmp_static(tmp_path):
    """Create a temporary static directory with test images."""
    static_dir = tmp_path / "static"
    static_dir.mkdir()
    for i in range(1, 10):
        (static_dir / f"{i}.PNG").write_bytes(b"fake")
    return str(static_dir)


@pytest.fixture
def game_manager(tmp_config, tmp_static):
    """Create a GameStateManager with temp config and static dirs."""
    return GameStateManager(config_path=tmp_config, static_dir=tmp_static)


class TestInitGameState:
    """Tests for init_game_state method."""

    def test_initializes_state_with_correct_structure(self, game_manager):
        """State has all required keys with correct types."""
        state = game_manager.init_game_state("uuid-1", 1)

        assert state["unique_code"] == "uuid-1"
        assert state["room_code"] is None
        assert state["level"] == 1
        assert isinstance(state["tiles"], list)
        assert isinstance(state["slots"], list)
        assert len(state["slots"]) == 0
        assert state["remaining"] == len(state["tiles"])
        assert state["game_over"] is False
        assert "timestamp" in state

    def test_tiles_have_required_fields(self, game_manager):
        """Each tile has id, imgIdx, img, x, y, layer, z."""
        state = game_manager.init_game_state("uuid-1", 1)
        for tile in state["tiles"]:
            assert "id" in tile
            assert "imgIdx" in tile
            assert "img" in tile
            assert "x" in tile
            assert "y" in tile
            assert "layer" in tile
            assert "z" in tile

    def test_tile_count_is_multiple_of_3(self, game_manager):
        """Total tile count should be a multiple of 3 for matching."""
        state = game_manager.init_game_state("uuid-1", 1)
        assert len(state["tiles"]) % 3 == 0

    def test_with_room_code(self, game_manager):
        """State can be initialized with a room_code for multiplayer."""
        state = game_manager.init_game_state("uuid-1", 1, "ROOM123")
        assert state["room_code"] == "ROOM123"

    def test_level_clamped_to_valid_range(self, game_manager):
        """Level is clamped to [1, 60]."""
        state_low = game_manager.init_game_state("uuid-1", 0)
        assert state_low["level"] == 1

        state_high = game_manager.init_game_state("uuid-2", 100)
        assert state_high["level"] == 60


class TestGetGameState:
    """Tests for get_game_state method."""

    def test_returns_active_state(self, game_manager):
        """Returns state that was previously initialized."""
        game_manager.init_game_state("uuid-1", 1)
        state = game_manager.get_game_state("uuid-1")
        assert state is not None
        assert state["unique_code"] == "uuid-1"

    def test_returns_none_for_unknown(self, game_manager):
        """Returns None when no state exists."""
        state = game_manager.get_game_state("nonexistent")
        assert state is None

    def test_returns_persisted_state_after_active_cleared(self, game_manager):
        """Recovers from persisted backup when active state is lost."""
        game_manager.init_game_state("uuid-1", 2)
        game_manager.persist_state("uuid-1", None)
        # Simulate loss of active state (e.g., server restart)
        game_manager._states.clear()
        state = game_manager.get_game_state("uuid-1")
        assert state is not None
        assert state["level"] == 2

    def test_returns_none_for_corrupted_state(self, game_manager):
        """Returns None and discards corrupted state (Req 8.6)."""
        game_manager._states[("corrupt", None)] = {"bad": "data"}
        state = game_manager.get_game_state("corrupt")
        assert state is None
        # Corrupted state should be removed
        assert ("corrupt", None) not in game_manager._states

    def test_with_room_code(self, game_manager):
        """Retrieves state using both unique_code and room_code."""
        game_manager.init_game_state("uuid-1", 1, "ROOM1")
        game_manager.init_game_state("uuid-1", 2, "ROOM2")
        state1 = game_manager.get_game_state("uuid-1", "ROOM1")
        state2 = game_manager.get_game_state("uuid-1", "ROOM2")
        assert state1["level"] == 1
        assert state2["level"] == 2


class TestApplyTileAction:
    """Tests for apply_tile_action method."""

    def _find_unblocked_tile(self, state):
        """Find a tile that is not blocked by higher-layer tiles."""
        tiles = state["tiles"]
        for tile in tiles:
            layer = tile.get("layer", 0)
            blocked = False
            for other in tiles:
                if other["id"] == tile["id"]:
                    continue
                if other.get("layer", 0) <= layer:
                    continue
                if (abs(other["x"] - tile["x"]) < 80
                        and abs(other["y"] - tile["y"]) < 80):
                    blocked = True
                    break
            if not blocked:
                return tile
        return None

    def test_select_tile_moves_to_slot(self, game_manager):
        """Selecting a tile moves it from board to slots."""
        state = game_manager.init_game_state("uuid-1", 2)
        tile = self._find_unblocked_tile(state)
        assert tile is not None

        initial_count = len(state["tiles"])
        new_state = game_manager.apply_tile_action(
            "uuid-1", None, {"type": "select_tile", "tile_id": tile["id"]}
        )
        assert len(new_state["tiles"]) == initial_count - 1
        assert len(new_state["slots"]) == 1
        assert new_state["slots"][0]["imgIdx"] == tile["imgIdx"]

    def test_raises_on_no_state(self, game_manager):
        """Raises ValueError when no state exists."""
        with pytest.raises(ValueError, match="No active game state"):
            game_manager.apply_tile_action(
                "nonexistent", None, {"type": "select_tile", "tile_id": 0}
            )

    def test_raises_on_blocked_tile(self, game_manager):
        """Raises ValueError when tile is blocked by higher layer."""
        # Use a level with multiple layers
        state = game_manager.init_game_state("uuid-1", 1)
        # Find a blocked tile (bottom layer covered by upper)
        tiles = state["tiles"]
        blocked_tile = None
        for tile in tiles:
            layer = tile.get("layer", 0)
            for other in tiles:
                if other["id"] == tile["id"]:
                    continue
                if other.get("layer", 0) <= layer:
                    continue
                if (abs(other["x"] - tile["x"]) < 80
                        and abs(other["y"] - tile["y"]) < 80):
                    blocked_tile = tile
                    break
            if blocked_tile:
                break

        if blocked_tile:
            with pytest.raises(ValueError, match="blocked"):
                game_manager.apply_tile_action(
                    "uuid-1", None,
                    {"type": "select_tile", "tile_id": blocked_tile["id"]}
                )

    def test_raises_on_invalid_tile_id(self, game_manager):
        """Raises ValueError for nonexistent tile_id."""
        game_manager.init_game_state("uuid-1", 1)
        with pytest.raises(ValueError, match="not found"):
            game_manager.apply_tile_action(
                "uuid-1", None, {"type": "select_tile", "tile_id": 9999}
            )

    def test_raises_on_unknown_action_type(self, game_manager):
        """Raises ValueError for unknown action type."""
        game_manager.init_game_state("uuid-1", 1)
        with pytest.raises(ValueError, match="Unknown action type"):
            game_manager.apply_tile_action(
                "uuid-1", None, {"type": "invalid_action"}
            )

    def test_triple_match_removes_tiles(self, game_manager):
        """Three tiles with same imgIdx in slots are removed."""
        state = game_manager.init_game_state("uuid-1", 3)
        # Manually set up a scenario: put 2 matching tiles in slots
        # then select a third matching tile
        tiles = state["tiles"]
        # Find 3 tiles with same imgIdx
        from collections import Counter
        img_counts = Counter(t["imgIdx"] for t in tiles)
        target_img = None
        for img_idx, count in img_counts.items():
            if count >= 3:
                target_img = img_idx
                break

        if target_img is not None:
            matching = [t for t in tiles if t["imgIdx"] == target_img]
            # Put 2 in slots manually
            state["slots"].append({
                "id": matching[0]["id"],
                "imgIdx": matching[0]["imgIdx"],
                "img": matching[0]["img"],
            })
            state["slots"].append({
                "id": matching[1]["id"],
                "imgIdx": matching[1]["imgIdx"],
                "img": matching[1]["img"],
            })
            # Remove them from tiles
            state["tiles"] = [
                t for t in tiles
                if t["id"] not in (matching[0]["id"], matching[1]["id"])
            ]
            state["remaining"] = len(state["tiles"])

            # Find the third matching tile (must be unblocked)
            third = None
            for t in state["tiles"]:
                if t["imgIdx"] == target_img:
                    # Check if unblocked
                    blocked = False
                    for other in state["tiles"]:
                        if other["id"] == t["id"]:
                            continue
                        if other.get("layer", 0) <= t.get("layer", 0):
                            continue
                        if (abs(other["x"] - t["x"]) < 80
                                and abs(other["y"] - t["y"]) < 80):
                            blocked = True
                            break
                    if not blocked:
                        third = t
                        break

            if third:
                new_state = game_manager.apply_tile_action(
                    "uuid-1", None,
                    {"type": "select_tile", "tile_id": third["id"]}
                )
                # Triple match should clear all 3 from slots
                assert len(new_state["slots"]) == 0


class TestPersistAndClearState:
    """Tests for persist_state and clear_state methods."""

    def test_persist_creates_backup(self, game_manager):
        """Persisting stores a copy in the backup store."""
        game_manager.init_game_state("uuid-1", 1)
        game_manager.persist_state("uuid-1", None)
        assert ("uuid-1", None) in game_manager._persisted

    def test_persist_is_deep_copy(self, game_manager):
        """Persisted state is independent of active state."""
        state = game_manager.init_game_state("uuid-1", 1)
        game_manager.persist_state("uuid-1", None)
        # Modify active state
        state["level"] = 99
        # Persisted should be unchanged
        assert game_manager._persisted[("uuid-1", None)]["level"] == 1

    def test_clear_removes_both_stores(self, game_manager):
        """Clearing removes from both active and persisted stores."""
        game_manager.init_game_state("uuid-1", 1)
        game_manager.persist_state("uuid-1", None)
        game_manager.clear_state("uuid-1", None)
        assert ("uuid-1", None) not in game_manager._states
        assert ("uuid-1", None) not in game_manager._persisted

    def test_clear_nonexistent_no_error(self, game_manager):
        """Clearing a nonexistent state does not raise."""
        game_manager.clear_state("nonexistent", None)


class TestGenerateLevel:
    """Tests for generate_level method."""

    def test_generates_tiles_for_level(self, game_manager):
        """Generates a non-empty tile list for a valid level."""
        result = game_manager.generate_level(1)
        assert "tiles" in result
        assert len(result["tiles"]) > 0

    def test_tile_count_multiple_of_3(self, game_manager):
        """Generated tile count is always a multiple of 3."""
        for level in [1, 2, 3]:
            result = game_manager.generate_level(level)
            assert len(result["tiles"]) % 3 == 0

    def test_tiles_have_valid_positions(self, game_manager):
        """Tile positions are within board bounds."""
        result = game_manager.generate_level(1)
        for tile in result["tiles"]:
            assert 0 <= tile["x"] <= 600 - 100
            assert 0 <= tile["y"] <= 800 - 100

    def test_tiles_have_incrementing_z(self, game_manager):
        """Tiles have unique, incrementing z-index values."""
        result = game_manager.generate_level(1)
        z_values = [t["z"] for t in result["tiles"]]
        assert z_values == list(range(len(z_values)))


class TestShapePositions:
    """Tests for _get_shape_positions utility."""

    def test_returns_positions_for_circle(self):
        """Circle shape returns positions within bounds."""
        positions = _get_shape_positions("circle", 10)
        assert len(positions) == 10
        for pos in positions:
            assert 0 <= pos["x"] <= 1
            assert 0 <= pos["y"] <= 1

    def test_returns_positions_for_unknown_shape(self):
        """Unknown shape falls back to circle."""
        positions = _get_shape_positions("nonexistent_shape", 5)
        assert len(positions) == 5

    def test_all_shapes_produce_positions(self):
        """Every defined shape can produce at least some positions."""
        for shape_name in SHAPE_TESTS:
            positions = _get_shape_positions(shape_name, 5)
            assert len(positions) > 0, f"Shape {shape_name} produced 0 positions"
