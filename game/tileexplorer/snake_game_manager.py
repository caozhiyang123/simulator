"""Snake multiplayer game manager.

Manages real-time snake game state for multiplayer rooms.
The server runs the game loop and broadcasts state to all players.
"""

import json
import math
import os
import random
import uuid

CONFIG_PATH = os.path.join(os.path.dirname(__file__), "config", "snake.json")
GAME_SETTING_PATH = os.path.join(
    os.path.dirname(__file__), "config", "game_setting.json"
)


def _load_snake_config():
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return {}


def _load_game_setting():
    try:
        with open(GAME_SETTING_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return {}


class SnakeGameManager:
    """Manages multiplayer snake game rooms."""

    def __init__(self):
        # {room_code: SnakeGameRoom}
        self._rooms = {}

    def create_room(self, room_code, player_count=2):
        """Create a new snake game room."""
        room = SnakeGameRoom(room_code, player_count)
        self._rooms[room_code] = room
        return room

    def get_room(self, room_code):
        return self._rooms.get(room_code)

    def remove_room(self, room_code):
        self._rooms.pop(room_code, None)


class SnakeGameRoom:
    """A single multiplayer snake game room."""

    def __init__(self, room_code, player_count=2):
        self.room_code = room_code
        self.player_count = player_count
        self.players = {}  # {username: SnakePlayer}
        self.player_order = []  # ordered list of usernames
        self.foods = []
        self.fragments = []
        self.obstacles = []
        self.started = False
        self.difficulty = 1
        self.target_score = 100
        self.winner = None
        self.all_dead = False
        self.rematch_votes = set()

        cfg = _load_snake_config()
        self.config = cfg
        self.grid = cfg.get("board", {}).get("grid_size", 20)
        self.width = cfg.get("board", {}).get("width", 800)
        self.height = cfg.get("board", {}).get("height", 600)

        mp = cfg.get("multiplayer", {})
        key = f"{player_count}player_target_score"
        self.target_score = mp.get(key, 100)
        self.death_fragments = mp.get("death_fragments", 10)
        self.fragment_score = mp.get("fragment_score", 3)

    def add_player(self, username, unique_code):
        """Add a player to the room."""
        if username in self.players:
            return
        player = SnakePlayer(username, unique_code)
        self.players[username] = player
        self.player_order.append(username)

    def is_full(self):
        return len(self.players) >= self.player_count

    def start_game(self, difficulty=1):
        """Initialize game state and start."""
        self.started = True
        self.winner = None
        self.all_dead = False
        self.difficulty = difficulty
        self.rematch_votes.clear()

        cfg = self.config
        level_cfg = self._get_level_config(difficulty)

        # Generate foods
        food_count = level_cfg.get("food_count", 5)
        self.foods = []
        for _ in range(food_count):
            self.foods.append(self._random_pos())

        # Generate obstacles
        obs_count = level_cfg.get("obstacle_count", 0)
        self.obstacles = []
        for _ in range(obs_count):
            self.obstacles.append(self._random_pos())

        self.fragments = []

        # Initialize snakes at different positions
        positions = [
            (self.width // 4, self.height // 2),
            (3 * self.width // 4, self.height // 2),
            (self.width // 2, self.height // 4),
            (self.width // 2, 3 * self.height // 4),
        ]
        directions = [
            {"x": 1, "y": 0},
            {"x": -1, "y": 0},
            {"x": 0, "y": 1},
            {"x": 0, "y": -1},
        ]

        init_len = level_cfg.get("initial_length", 3)
        for i, username in enumerate(self.player_order):
            player = self.players[username]
            px, py = positions[i % len(positions)]
            px = (px // self.grid) * self.grid
            py = (py // self.grid) * self.grid
            d = directions[i % len(directions)]

            segments = []
            for j in range(init_len):
                segments.append({
                    "x": px - j * d["x"] * self.grid,
                    "y": py - j * d["y"] * self.grid,
                })
            player.segments = segments
            player.direction = d
            player.next_direction = d.copy()
            player.alive = True
            player.score = 0

    def tick(self):
        """Advance game by one step. Returns state dict."""
        if not self.started or self.winner or self.all_dead:
            return self.get_state()

        cfg = self.config
        scoring = cfg.get("scoring", {})
        food_score = scoring.get("food_score", 10)

        # Move each alive player
        for username in self.player_order:
            player = self.players[username]
            if not player.alive:
                continue

            player.direction = player.next_direction.copy()
            head = {
                "x": player.segments[0]["x"] + player.direction["x"] * self.grid,
                "y": player.segments[0]["y"] + player.direction["y"] * self.grid,
            }

            # Wall collision
            if head["x"] < 0 or head["x"] >= self.width or head["y"] < 0 or head["y"] >= self.height:
                self._kill_player(username)
                continue

            # Self collision
            if any(s["x"] == head["x"] and s["y"] == head["y"] for s in player.segments):
                self._kill_player(username)
                continue

            # Obstacle collision
            if any(o["x"] == head["x"] and o["y"] == head["y"] for o in self.obstacles):
                self._kill_player(username)
                continue

            player.segments.insert(0, head)

            # Food collision
            ate = False
            for i, f in enumerate(self.foods):
                if head["x"] == f["x"] and head["y"] == f["y"]:
                    player.score += food_score
                    self.foods[i] = self._random_pos()
                    ate = True
                    break

            # Fragment collision
            for i in range(len(self.fragments) - 1, -1, -1):
                frag = self.fragments[i]
                if head["x"] == frag["x"] and head["y"] == frag["y"]:
                    player.score += self.fragment_score
                    self.fragments.pop(i)
                    ate = True
                    break

            if not ate:
                player.segments.pop()

        # Check head-to-head and head-to-body collisions between players
        alive_players = [u for u in self.player_order if self.players[u].alive]
        kills = set()

        for i, u1 in enumerate(alive_players):
            p1 = self.players[u1]
            head1 = p1.segments[0] if p1.segments else None
            if not head1:
                continue

            for j, u2 in enumerate(alive_players):
                if i == j:
                    continue
                p2 = self.players[u2]
                if not p2.segments:
                    continue

                # Head-to-head
                head2 = p2.segments[0]
                if head1["x"] == head2["x"] and head1["y"] == head2["y"]:
                    kills.add(u1)
                    kills.add(u2)
                    continue

                # Head-to-body (u1's head hits u2's body)
                for seg in p2.segments[1:]:
                    if head1["x"] == seg["x"] and head1["y"] == seg["y"]:
                        kills.add(u1)
                        break

        for username in kills:
            if self.players[username].alive:
                self._kill_player(username)

        # Check win condition
        for username in self.player_order:
            p = self.players[username]
            if p.alive and p.score >= self.target_score:
                self.winner = username
                break

        # Check all dead
        if not self.winner:
            alive = [u for u in self.player_order if self.players[u].alive]
            if len(alive) == 0:
                self.all_dead = True

        return self.get_state()

    def set_direction(self, username, direction):
        """Set a player's next direction."""
        player = self.players.get(username)
        if not player or not player.alive:
            return

        dir_map = {
            "up": {"x": 0, "y": -1},
            "down": {"x": 0, "y": 1},
            "left": {"x": -1, "y": 0},
            "right": {"x": 1, "y": 0},
        }
        new_dir = dir_map.get(direction)
        if not new_dir:
            return

        # Prevent 180-degree turn
        if (new_dir["x"] == -player.direction["x"] and new_dir["x"] != 0):
            return
        if (new_dir["y"] == -player.direction["y"] and new_dir["y"] != 0):
            return

        player.next_direction = new_dir

    def vote_rematch(self, username):
        """Record a rematch vote. Returns True if all voted."""
        self.rematch_votes.add(username)
        return len(self.rematch_votes) >= len(self.players)

    def get_state(self):
        """Get serializable game state."""
        return {
            "players": [
                {
                    "username": u,
                    "score": self.players[u].score,
                    "alive": self.players[u].alive,
                    "segments": self.players[u].segments,
                }
                for u in self.player_order
            ],
            "foods": self.foods,
            "fragments": self.fragments,
            "obstacles": self.obstacles,
        }

    def _kill_player(self, username):
        """Kill a player and create fragments from their body."""
        player = self.players[username]
        player.alive = False

        # Create fragments from snake body
        step = max(1, len(player.segments) // self.death_fragments)
        for i in range(0, len(player.segments), step):
            seg = player.segments[i]
            self.fragments.append({"x": seg["x"], "y": seg["y"]})

        player.segments = []

    def _random_pos(self):
        """Generate a random grid-aligned position."""
        for _ in range(100):
            x = random.randint(0, self.width // self.grid - 1) * self.grid
            y = random.randint(0, self.height // self.grid - 1) * self.grid
            if not self._is_occupied(x, y):
                return {"x": x, "y": y}
        return {"x": 0, "y": 0}

    def _is_occupied(self, x, y):
        for p in self.players.values():
            for seg in p.segments:
                if seg["x"] == x and seg["y"] == y:
                    return True
        for o in self.obstacles:
            if o["x"] == x and o["y"] == y:
                return True
        return False

    def _get_level_config(self, lvl):
        levels = self.config.get("levels", {})
        cfg = levels.get(str(lvl))
        if cfg:
            return cfg
        keys = sorted([int(k) for k in levels.keys() if k != "default"])
        for k in reversed(keys):
            if k <= lvl:
                return levels[str(k)]
        return levels.get("default", levels.get("1", {}))


class SnakePlayer:
    """A player in a snake game room."""

    def __init__(self, username, unique_code):
        self.username = username
        self.unique_code = unique_code
        self.segments = []
        self.direction = {"x": 1, "y": 0}
        self.next_direction = {"x": 1, "y": 0}
        self.alive = True
        self.score = 0
