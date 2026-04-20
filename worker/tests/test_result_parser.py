"""Unit tests for ResultParser."""

import pytest

from result_parser import ResultParser


# --- Helpers ---

SAMPLE_SEGMENT = """\
SPIN COUNT = 1000000
TOTAL SPEND = 12500000.00
TOTAL WIN = 12125000.00
BASE SPEND = 12500000.00
BASE WIN = 10625000.00
EB SPEND = 0.00
EB WIN = 1500000.00
"""

MULTI_SEGMENT = """\
SPIN COUNT = 500000
TOTAL SPEND = 6000000.00
TOTAL WIN = 5800000.00
BASE SPEND = 6000000.00
BASE WIN = 5000000.00
EB SPEND = 0.00
EB WIN = 800000.00

SPIN COUNT = 1000000
TOTAL SPEND = 12500000.00
TOTAL WIN = 12125000.00
BASE SPEND = 12500000.00
BASE WIN = 10625000.00
EB SPEND = 0.00
EB WIN = 1500000.00
"""


class TestFindLatestResult:
    """Tests for find_latest_result."""

    def test_returns_none_for_missing_dir(self):
        assert ResultParser.find_latest_result("/nonexistent/path") is None

    def test_returns_none_for_empty_dir(self, tmp_path):
        assert ResultParser.find_latest_result(str(tmp_path)) is None

    def test_finds_single_file(self, tmp_path):
        fname = "ShowBingo_9600_50_678_2025.11.26_02.30.28_highest.txt"
        (tmp_path / fname).write_text("data")
        result = ResultParser.find_latest_result(str(tmp_path))
        assert result == str(tmp_path / fname)

    def test_finds_latest_among_multiple(self, tmp_path):
        old = "ShowBingo_9600_50_678_2025.11.26_02.30.28_highest.txt"
        new = "ShowBingo_9600_50_678_2025.12.01_10.00.00_highest.txt"
        (tmp_path / old).write_text("old")
        (tmp_path / new).write_text("new")
        result = ResultParser.find_latest_result(str(tmp_path))
        assert result == str(tmp_path / new)

    def test_ignores_non_highest_files(self, tmp_path):
        highest = "ShowBingo_9600_50_678_2025.11.26_02.30.28_highest.txt"
        other = "ShowBingo_9600_50_678_2025.12.01_10.00.00_result.txt"
        (tmp_path / highest).write_text("data")
        (tmp_path / other).write_text("data")
        result = ResultParser.find_latest_result(str(tmp_path))
        assert result == str(tmp_path / highest)


class TestParse:
    """Tests for parse."""

    def test_parse_single_segment(self, tmp_path):
        f = tmp_path / "result.txt"
        f.write_text(SAMPLE_SEGMENT)
        result = ResultParser.parse(str(f))
        assert result["spins"] == 1000000
        assert result["total_spent"] == 12500000.00
        assert result["total_win"] == 12125000.00
        assert result["base_spent"] == 12500000.00
        assert result["base_win"] == 10625000.00
        assert result["eb_spent"] == 0.00
        assert result["eb_win"] == 1500000.00

    def test_parse_multi_segment_takes_last(self, tmp_path):
        f = tmp_path / "result.txt"
        f.write_text(MULTI_SEGMENT)
        result = ResultParser.parse(str(f))
        # Should get the second (last) segment
        assert result["spins"] == 1000000
        assert result["total_spent"] == 12500000.00

    def test_parse_file_not_found(self):
        with pytest.raises(FileNotFoundError):
            ResultParser.parse("/nonexistent/file.txt")

    def test_parse_empty_file(self, tmp_path):
        f = tmp_path / "empty.txt"
        f.write_text("")
        with pytest.raises(ValueError, match="No SPIN COUNT"):
            ResultParser.parse(str(f))

    def test_parse_missing_field(self, tmp_path):
        f = tmp_path / "bad.txt"
        f.write_text("SPIN COUNT = 100\nTOTAL SPEND = 50.00\n")
        with pytest.raises(ValueError, match="Missing field"):
            ResultParser.parse(str(f))


class TestFormatResult:
    """Tests for format_result."""

    def test_format_contains_all_fields(self):
        result = {
            "spins": 1000000,
            "total_spent": 12500000.00,
            "total_win": 12125000.00,
            "base_spent": 12500000.00,
            "base_win": 10625000.00,
            "eb_spent": 0.00,
            "eb_win": 1500000.00,
        }
        text = ResultParser.format_result(result)
        assert "SPIN COUNT = 1000000" in text
        assert "TOTAL SPEND = 12500000.00" in text
        assert "EB WIN = 1500000.00" in text

    def test_round_trip(self, tmp_path):
        """format_result -> write -> parse should produce equivalent result."""
        original = {
            "spins": 500000,
            "total_spent": 6250000.00,
            "total_win": 6062500.00,
            "base_spent": 6250000.00,
            "base_win": 5312500.00,
            "eb_spent": 0.00,
            "eb_win": 750000.00,
        }
        text = ResultParser.format_result(original)
        f = tmp_path / "roundtrip.txt"
        f.write_text(text)
        parsed = ResultParser.parse(str(f))
        assert parsed == original
