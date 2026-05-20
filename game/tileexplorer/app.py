"""Tile Explorer game server."""
import json
import os

from flask import Flask, jsonify, render_template

app = Flask(__name__)

CONFIG_PATH = os.path.join(os.path.dirname(__file__), "config", "config.json")
STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")

# Load config
with open(CONFIG_PATH, "r", encoding="utf-8") as _f:
    _config = json.load(_f)
PORT = _config.get("port", 5002)


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/config", methods=["GET"])
def get_config():
    """Return level config."""
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        return jsonify(json.load(f))


@app.route("/api/images", methods=["GET"])
def list_images():
    """List all image files in static directory."""
    images = sorted([
        f for f in os.listdir(STATIC_DIR)
        if f.lower().endswith(('.png', '.jpg', '.jpeg'))
    ])
    return jsonify({"images": images})


if __name__ == "__main__":
    print(f"Tile Explorer running on http://127.0.0.1:{PORT}")
    app.run(host="0.0.0.0", port=PORT)
