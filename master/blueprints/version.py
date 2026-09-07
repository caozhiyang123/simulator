"""Version blueprint - simulation/java version management.

Scans the master's production_dir for jar files and computes SHA1/SHA256:
  - Simulation version: only ``B2BGameSimulator.jar`` files (recursive).
  - Java version: every ``*.jar`` file (recursive).

User-created version records are persisted as JSON files under
``<base_dir>/versions``.
"""

import hashlib
import json
import os
import re
from datetime import datetime, timezone

from flask import Blueprint, jsonify, request

version_bp = Blueprint("version", __name__)

# ---------------------------------------------------------------------------
# Dependencies (set via init_version)
# ---------------------------------------------------------------------------
_config = None
_base_dir: str = ""


def init_version(*, config, base_dir: str):
    global _config, _base_dir
    _config = config
    _base_dir = base_dir


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
_SIMULATION_JAR = "B2BGameSimulator.jar"
_CHUNK = 1024 * 1024  # 1 MiB read chunks


def _versions_dir() -> str:
    return os.path.join(_base_dir, "versions")


def _hash_file(path: str):
    """Compute (sha1, sha256) for a single file, reading in chunks.

    Returns (sha1_hex_upper, sha256_hex_upper) or (None, None) on error.
    """
    sha1 = hashlib.sha1()
    sha256 = hashlib.sha256()
    try:
        with open(path, "rb") as f:
            while True:
                chunk = f.read(_CHUNK)
                if not chunk:
                    break
                sha1.update(chunk)
                sha256.update(chunk)
    except OSError:
        return None, None
    return sha1.hexdigest().upper(), sha256.hexdigest().upper()


def _scan_jars(root: str, only_simulator: bool) -> list:
    """Walk ``root`` recursively and hash matching jar files.

    Args:
        root: directory to scan.
        only_simulator: when True, only ``B2BGameSimulator.jar`` files are
            included; otherwise every ``*.jar`` file is included.

    Returns:
        List of {"path", "sha1", "sha256"} dicts sorted by path.
    """
    results = []
    for dirpath, _dirs, filenames in os.walk(root):
        for name in filenames:
            if not name.lower().endswith(".jar"):
                continue
            if only_simulator and name != _SIMULATION_JAR:
                continue
            full = os.path.join(dirpath, name)
            sha1, sha256 = _hash_file(full)
            results.append({
                "path": full.replace("\\", "/"),
                "name": name,
                "sha1": sha1 or "",
                "sha256": sha256 or "",
            })
    results.sort(key=lambda r: r["path"].casefold())
    return results


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@version_bp.route("/version/scan", methods=["GET"])
def version_scan():
    """Scan production_dir and compute jar hashes.

    Query param: ?type=simulation | java (default: both).

    Returns:
        {
          "production_dir": "...",
          "simulation": [{path, name, sha1, sha256}, ...],
          "java": [{path, name, sha1, sha256}, ...]
        }
    """
    scan_type = request.args.get("type", "").strip().lower()
    prod_dir = _config.production_dir if _config else ""
    if not prod_dir:
        return jsonify({"error": "production_dir not configured"}), 400
    if not os.path.isdir(prod_dir):
        return jsonify({
            "error": f"production_dir not found: {prod_dir}"
        }), 404

    payload = {"production_dir": prod_dir.replace("\\", "/")}
    if scan_type in ("", "simulation"):
        payload["simulation"] = _scan_jars(prod_dir, only_simulator=True)
    if scan_type in ("", "java"):
        payload["java"] = _scan_jars(prod_dir, only_simulator=False)

    resp = jsonify(payload)
    resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
    resp.headers["Pragma"] = "no-cache"
    resp.headers["Expires"] = "0"
    return resp


@version_bp.route("/version/list", methods=["GET"])
def version_list():
    """List all user-created version records (simulation + java)."""
    vdir = _versions_dir()
    records = []
    if os.path.isdir(vdir):
        for fname in sorted(os.listdir(vdir), reverse=True):
            if not fname.endswith(".json"):
                continue
            fpath = os.path.join(vdir, fname)
            try:
                with open(fpath, "r", encoding="utf-8") as f:
                    data = json.load(f)
                data["_filename"] = fname
                records.append(data)
            except (OSError, ValueError):
                continue
    return jsonify({"records": records})


_ID_SAFE = re.compile(r"[^A-Za-z0-9._-]+")


def _safe_component(text: str) -> str:
    text = _ID_SAFE.sub("_", (text or "").strip())
    return text.strip("_") or "unnamed"


@version_bp.route("/version/save", methods=["POST"])
def version_save():
    """Create or update a version record.

    Request body:
        {
          "type": "simulation" | "java",
          "version": "v1.0",
          "files": [{"path": "...", "sha1": "...", "sha256": "..."}, ...],
          "filename": "..."   # optional, when editing an existing record
        }
    """
    data = request.get_json(force=True)
    vtype = (data.get("type") or "").strip().lower()
    version = (data.get("version") or "").strip()
    files = data.get("files") or []

    if vtype not in ("simulation", "java"):
        return jsonify({"error": "type must be 'simulation' or 'java'"}), 400
    if not version:
        return jsonify({"error": "version is required"}), 400

    vdir = _versions_dir()
    os.makedirs(vdir, exist_ok=True)

    filename = (data.get("filename") or "").strip()
    if not filename:
        ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        filename = (
            f"{_safe_component(vtype)}_{_safe_component(version)}_{ts}.json"
        )
    # Guard against path traversal
    filename = os.path.basename(filename)
    fpath = os.path.join(vdir, filename)

    record = {
        "type": vtype,
        "version": version,
        "files": [
            {
                "path": (f.get("path") or "").strip(),
                "sha1": (f.get("sha1") or "").strip(),
                "sha256": (f.get("sha256") or "").strip(),
            }
            for f in files
        ],
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    try:
        with open(fpath, "w", encoding="utf-8") as f:
            json.dump(record, f, ensure_ascii=False, indent=2)
    except OSError as exc:
        return jsonify({"error": str(exc)}), 500

    return jsonify({"status": "ok", "filename": filename})


@version_bp.route("/version/delete", methods=["POST"])
def version_delete():
    """Delete a version record by filename."""
    data = request.get_json(force=True)
    filename = os.path.basename((data.get("filename") or "").strip())
    if not filename:
        return jsonify({"error": "filename is required"}), 400
    fpath = os.path.join(_versions_dir(), filename)
    if not os.path.isfile(fpath):
        return jsonify({"error": "Record not found"}), 404
    try:
        os.remove(fpath)
    except OSError as exc:
        return jsonify({"error": str(exc)}), 500
    return jsonify({"status": "ok"})
