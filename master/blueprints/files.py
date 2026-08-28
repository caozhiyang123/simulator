"""Files blueprint - local/remote file operations, batch processing, bingo, sha1, etc."""

import fnmatch
import hashlib
import json as json_module
import os
import shutil
import string
import uuid

import requests as http_requests
from flask import Blueprint, jsonify, request, send_file, current_app

files_bp = Blueprint("files", __name__)

# ---------------------------------------------------------------------------
# Dependencies (set via init_files)
# ---------------------------------------------------------------------------
_config = None
_worker_client = None
_worker_session = None  # raw requests.Session for direct HTTP calls
_base_dir: str = ""
_bundle_dir: str = ""
_raw_config: dict = {}


def init_files(*, config, worker_client, base_dir: str, bundle_dir: str, raw_config: dict = None):
    global _config, _worker_client, _worker_session, _base_dir, _bundle_dir, _raw_config
    _config = config
    _worker_client = worker_client
    _worker_session = worker_client._session
    _base_dir = base_dir
    _bundle_dir = bundle_dir
    _raw_config = raw_config or {}


def _is_remote_addr(addr):
    return _worker_client.is_remote(addr)


def _worker_proxy_post(addr, path, json_body=None, timeout=30, stream=False):
    return _worker_client.proxy_post(addr, path, json_body, timeout, stream)


# ---------------------------------------------------------------------------
# Routes (extracted from app.py)
# ---------------------------------------------------------------------------

@files_bp.route("/files/local/browse", methods=["GET"])
def local_browse():
    """Browse local directory contents using absolute paths.

    Query param: ?path=absolute/path (defaults to production_dir)
    Special: ?path=__drives__ lists all drive letters (Windows)
    """
    browse_path = request.args.get("path", "")

    # List all drives
    if browse_path == "__drives__":
        import string
        drives = []
        for letter in string.ascii_uppercase:
            drive = f"{letter}:/"
            if os.path.isdir(drive):
                drives.append({
                    "name": f"{letter}:",
                    "type": "dir",
                    "size": 0,
                    "full_path": drive,
                })
        return jsonify({"path": "My Computer", "parent": "", "entries": drives})

    if not browse_path:
        browse_path = _config.production_dir
    if not browse_path:
        return jsonify({"error": "production_dir not configured"}), 400

    full_path = os.path.normpath(browse_path)
    if not os.path.isdir(full_path):
        return jsonify({"error": "Directory not found"}), 404

    parent = os.path.dirname(full_path)
    # If at drive root (e.g. E:\), parent goes to drive list
    if parent == full_path:
        parent = "__drives__"
    else:
        parent = parent.replace("\\", "/")

    entries = []
    for name in sorted(os.listdir(full_path)):
        fp = os.path.join(full_path, name)
        entries.append({
            "name": name,
            "type": "dir" if os.path.isdir(fp) else "file",
            "size": os.path.getsize(fp) if os.path.isfile(fp) else 0,
            "full_path": fp.replace("\\", "/"),
        })

    return jsonify({
        "path": full_path.replace("\\", "/"),
        "parent": parent,
        "entries": entries,
    })


@files_bp.route("/files/local/write", methods=["POST"])
def local_write():
    """Write content to a local file.

    Request body: {"path": "absolute/path", "content": "file content"}
    """
    data = request.get_json(force=True)
    file_path = data.get("path", "")
    content = data.get("content", "")
    full_path = os.path.normpath(file_path)
    try:
        with open(full_path, "w", encoding="utf-8") as f:
            f.write(content)
        return jsonify({"status": "ok", "path": file_path})
    except OSError as exc:
        return jsonify({"error": str(exc)}), 500


@files_bp.route("/files/local/delete", methods=["POST"])
def local_delete():
    """Delete local files or directories.

    Request body: {"paths": ["absolute/path1", "absolute/path2"]}
    """
    import shutil
    data = request.get_json(force=True)
    paths = data.get("paths", [])
    results = []
    for p in paths:
        full = os.path.normpath(p)
        try:
            if os.path.isfile(full):
                os.remove(full)
                results.append({"path": p, "status": "deleted"})
            elif os.path.isdir(full):
                shutil.rmtree(full)
                results.append({"path": p, "status": "deleted"})
            else:
                results.append({"path": p, "status": "not found"})
        except OSError as exc:
            results.append({"path": p, "status": "error", "error": str(exc)})
    return jsonify({"results": results})


@files_bp.route("/files/local/mkdir", methods=["POST"])
def local_mkdir():
    """Create a directory locally.

    Request body: {"path": "absolute/path"}
    """
    data = request.get_json(force=True)
    dir_path = data.get("path", "")
    if not dir_path:
        return jsonify({"error": "path is required"}), 400
    full = os.path.normpath(dir_path)
    try:
        os.makedirs(full, exist_ok=True)
        return jsonify({"status": "ok", "path": full.replace("\\", "/")})
    except OSError as exc:
        return jsonify({"error": str(exc)}), 500


@files_bp.route("/files/local/create", methods=["POST"])
def local_create_file():
    """Create an empty file locally.

    Request body: {"path": "absolute/path", "content": ""}
    """
    data = request.get_json(force=True)
    file_path = data.get("path", "")
    content = data.get("content", "")
    if not file_path:
        return jsonify({"error": "path is required"}), 400
    full = os.path.normpath(file_path)
    try:
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "w", encoding="utf-8") as f:
            f.write(content)
        return jsonify({"status": "ok", "path": full.replace("\\", "/")})
    except OSError as exc:
        return jsonify({"error": str(exc)}), 500


@files_bp.route("/files/local/rename", methods=["POST"])
def local_rename():
    """Rename a local file or directory.

    Request body: {"old_path": "absolute/old", "new_path": "absolute/new"}
    """
    data = request.get_json(force=True)
    old_path = os.path.normpath(data.get("old_path", ""))
    new_path = os.path.normpath(data.get("new_path", ""))
    if not old_path or not new_path:
        return jsonify({"error": "old_path and new_path are required"}), 400
    if not os.path.exists(old_path):
        return jsonify({"error": "Source not found"}), 404
    try:
        os.rename(old_path, new_path)
        return jsonify({"status": "ok", "path": new_path.replace("\\", "/")})
    except OSError as exc:
        return jsonify({"error": str(exc)}), 500


@files_bp.route("/files/local/duplicate", methods=["POST"])
def local_duplicate():
    """Duplicate (copy) a local file or directory.

    Request body: {"source": "absolute/path", "dest": "absolute/new_path"}
    """
    import shutil
    data = request.get_json(force=True)
    source = os.path.normpath(data.get("source", ""))
    dest = os.path.normpath(data.get("dest", ""))
    if not source or not dest:
        return jsonify({"error": "source and dest are required"}), 400
    if not os.path.exists(source):
        return jsonify({"error": "Source not found"}), 404
    try:
        if os.path.isdir(source):
            shutil.copytree(source, dest)
        else:
            shutil.copy2(source, dest)
        return jsonify({"status": "ok", "path": dest.replace("\\", "/")})
    except OSError as exc:
        return jsonify({"error": str(exc)}), 500


@files_bp.route("/files/worker/rename", methods=["POST"])
def worker_rename():
    """Rename a file or directory on a remote worker.

    Request body: {"addr": "ip:port", "old_path": "path", "new_path": "path"}
    """
    data = request.get_json(force=True)
    addr = data.get("addr", "")
    if not addr:
        return jsonify({"error": "addr is required"}), 400
    try:
        r = _worker_session.post(f"http://{addr}/files/rename", json={
            "old_path": data.get("old_path", ""),
            "new_path": data.get("new_path", "")
        }, timeout=10)
        return jsonify(r.json()), r.status_code
    except http_requests.RequestException as exc:
        return jsonify({"error": str(exc)}), 500


@files_bp.route("/files/worker/duplicate", methods=["POST"])
def worker_duplicate():
    """Duplicate a file or directory on a remote worker.

    Request body: {"addr": "ip:port", "source": "path", "dest": "path"}
    """
    data = request.get_json(force=True)
    addr = data.get("addr", "")
    if not addr:
        return jsonify({"error": "addr is required"}), 400
    try:
        r = _worker_session.post(f"http://{addr}/files/duplicate", json={
            "source": data.get("source", ""),
            "dest": data.get("dest", "")
        }, timeout=10)
        return jsonify(r.json()), r.status_code
    except http_requests.RequestException as exc:
        return jsonify({"error": str(exc)}), 500


@files_bp.route("/files/worker/mkdir", methods=["POST"])
def worker_mkdir():
    """Create a directory on a remote worker.

    Request body: {"addr": "ip:port", "path": "absolute/path"}
    """
    data = request.get_json(force=True)
    addr = data.get("addr", "")
    dir_path = data.get("path", "")
    if not addr or not dir_path:
        return jsonify({"error": "addr and path are required"}), 400
    try:
        r = _worker_session.post(f"http://{addr}/files/mkdir", json={"path": dir_path}, timeout=10)
        return jsonify(r.json()), r.status_code
    except http_requests.RequestException as exc:
        return jsonify({"error": str(exc)}), 500


@files_bp.route("/files/worker/create", methods=["POST"])
def worker_create_file():
    """Create an empty file on a remote worker.

    Request body: {"addr": "ip:port", "path": "absolute/path", "content": ""}
    """
    data = request.get_json(force=True)
    addr = data.get("addr", "")
    file_path = data.get("path", "")
    content = data.get("content", "")
    if not addr or not file_path:
        return jsonify({"error": "addr and path are required"}), 400
    try:
        r = _worker_session.post(f"http://{addr}/files/write", json={"path": file_path, "content": content}, timeout=10)
        return jsonify(r.json()), r.status_code
    except http_requests.RequestException as exc:
        return jsonify({"error": str(exc)}), 500


@files_bp.route("/bingo/machines", methods=["GET"])
def bingo_machines():
    """List all saved machine pattern lists."""
    path = os.path.join(_base_dir, "data", "machine", "machine_pattern_list.json")
    if not os.path.isfile(path):
        return jsonify({"machines": []})
    with open(path, "r", encoding="utf-8") as f:
        return jsonify({"machines": json_module.load(f)})


@files_bp.route("/bingo/machines", methods=["POST"])
def bingo_machines_save():
    """Save a new machine pattern list."""
    data = request.get_json(force=True)
    machine_id = data.get("machine_id")
    name = data.get("name", "")
    pattern = data.get("pattern", [])
    if not machine_id or not name:
        return jsonify({"error": "machine_id and name are required"}), 400

    path = os.path.join(_base_dir, "data", "machine", "machine_pattern_list.json")
    machines = []
    if os.path.isfile(path):
        with open(path, "r", encoding="utf-8") as f:
            machines = json_module.load(f)

    # Check duplicate
    for m in machines:
        if m["machine_id"] == machine_id:
            m["name"] = name
            m["pattern"] = pattern
            break
    else:
        machines.append({"machine_id": machine_id, "name": name, "pattern": pattern})

    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json_module.dump(machines, f, ensure_ascii=False, indent=2)
    return jsonify({"status": "ok"})


@files_bp.route("/bingo/machines/special", methods=["POST"])
def bingo_machines_special_save():
    """Save a special pattern list to an existing machine."""
    data = request.get_json(force=True)
    machine_id = data.get("machine_id")
    special_name = data.get("special_name", "")
    special_pattern = data.get("special_pattern", [])
    if not machine_id or not special_name:
        return jsonify({"error": "machine_id and special_name are required"}), 400

    path = os.path.join(_base_dir, "data", "machine", "machine_pattern_list.json")
    machines = []
    if os.path.isfile(path):
        with open(path, "r", encoding="utf-8") as f:
            machines = json_module.load(f)

    found = False
    for m in machines:
        if m["machine_id"] == machine_id:
            m[special_name] = special_pattern
            found = True
            break
    if not found:
        return jsonify({"error": f"Machine {machine_id} not found"}), 404

    with open(path, "w", encoding="utf-8") as f:
        json_module.dump(machines, f, ensure_ascii=False, indent=2)
    return jsonify({"status": "ok"})


@files_bp.route("/bingo/machines/delete", methods=["POST"])
def bingo_machines_delete():
    """Delete a machine from the list."""
    data = request.get_json(force=True)
    machine_id = data.get("machine_id")
    if not machine_id:
        return jsonify({"error": "machine_id is required"}), 400

    path = os.path.join(_base_dir, "data", "machine", "machine_pattern_list.json")
    machines = []
    if os.path.isfile(path):
        with open(path, "r", encoding="utf-8") as f:
            machines = json_module.load(f)

    machines = [m for m in machines if m.get("machine_id") != machine_id]
    with open(path, "w", encoding="utf-8") as f:
        json_module.dump(machines, f, ensure_ascii=False, indent=2)
    return jsonify({"status": "ok"})


@files_bp.route("/bingo/machines/special/delete", methods=["POST"])
def bingo_machines_special_delete():
    """Delete a special pattern from a machine."""
    data = request.get_json(force=True)
    machine_id = data.get("machine_id")
    special_name = data.get("special_name", "")
    if not machine_id or not special_name:
        return jsonify({"error": "machine_id and special_name are required"}), 400

    path = os.path.join(_base_dir, "data", "machine", "machine_pattern_list.json")
    machines = []
    if os.path.isfile(path):
        with open(path, "r", encoding="utf-8") as f:
            machines = json_module.load(f)

    for m in machines:
        if m.get("machine_id") == machine_id:
            if special_name in m:
                del m[special_name]
            break

    with open(path, "w", encoding="utf-8") as f:
        json_module.dump(machines, f, ensure_ascii=False, indent=2)
    return jsonify({"status": "ok"})


@files_bp.route("/bingo/pattern-combination", methods=["POST"])
def bingo_pattern_combination():
    """Generate all valid pattern override combinations from payable list."""
    data = request.get_json(force=True)
    payables = data.get("payables", [])

    if not payables or not isinstance(payables, list):
        return jsonify({"error": "payables must be a non-empty array"}), 400

    # Sort payables by value descending
    payables_sorted = sorted(payables, key=lambda p: p.get("value", 0), reverse=True)

    # Parse formats into integer bitmasks for fast OR/subset operations
    fmt_len = len(payables_sorted[0].get("format", ""))
    for p in payables_sorted:
        fmt = p.get("format", "")
        if len(fmt) != fmt_len:
            return jsonify({"error": f"All formats must have same length. Expected {fmt_len}, got {len(fmt)} for {p.get('alias')}"}), 400
        p["_mask"] = int(fmt, 2)
        p["_required"] = fmt.count("1")

    # Find the bingo pattern (all 1s, type=1)
    bingo_mask = (1 << fmt_len) - 1

    # Generate combinations using iterative approach
    # A valid combination: OR of multiple patterns where the combined format
    # does NOT equal or contain any single pattern with higher value than the combination sum
    results = []

    # First, add each single pattern as a valid combination
    for p in payables_sorted:
        results.append({
            "id": -1,
            "name": p["name"],
            "alias": p["alias"] + ",",
            "format": p["format"],
            "required": str(p["_required"]),
            "value": p["value"],
            "weight": 0.00
        })

    # Now find multi-pattern combinations
    # We need to find sets of patterns where:
    # 1. Their OR doesn't fully contain a higher-value single pattern that isn't part of the set
    # 2. No pattern in the set is a subset of another in the set
    # 3. The combined format is not equal to any single pattern's format
    from itertools import combinations as iter_combinations

    # Build list of non-bingo patterns for combination
    non_bingo = [p for p in payables_sorted if p["_mask"] != bingo_mask]

    # Limit to reasonable depth (2-5 patterns per combo)
    max_depth = min(6, len(non_bingo))

    for size in range(2, max_depth + 1):
        for combo in iter_combinations(range(len(non_bingo)), size):
            patterns = [non_bingo[i] for i in combo]

            # Check no pattern is subset of another in this combo
            masks = [p["_mask"] for p in patterns]
            skip = False
            for i in range(len(masks)):
                for j in range(len(masks)):
                    if i != j and (masks[i] & masks[j]) == masks[i]:
                        skip = True
                        break
                if skip:
                    break
            if skip:
                continue

            # Compute OR of all formats
            combined_mask = 0
            for m in masks:
                combined_mask |= m
            combined_required = bin(combined_mask).count("1")

            # Check if combined equals bingo
            if combined_mask == bingo_mask:
                continue

            # Check: combined format must not fully contain any single pattern
            # with higher value than the sum of this combo
            combo_value = sum(p["value"] for p in patterns)
            is_valid = True
            for p in payables_sorted:
                if p["_mask"] == bingo_mask:
                    continue
                # Skip patterns that are part of this combo
                if p in patterns:
                    continue
                # If combined fully contains this pattern AND this pattern's value >= combo_value
                if (combined_mask & p["_mask"]) == p["_mask"] and p["value"] >= combo_value:
                    is_valid = False
                    break
            if not is_valid:
                continue

            # Check: combined format must not equal any single pattern's format
            is_duplicate = False
            for p in payables_sorted:
                if p["_mask"] == combined_mask:
                    is_duplicate = True
                    break
            if is_duplicate:
                continue

            # Format the combined mask back to string
            combined_fmt = bin(combined_mask)[2:].zfill(fmt_len)

            # Build name and alias
            names = ",".join(p["name"] for p in patterns) + ","
            aliases = ",".join(p["alias"] for p in patterns) + ","

            results.append({
                "id": -1,
                "name": names,
                "alias": aliases,
                "format": combined_fmt,
                "required": str(combined_required),
                "value": combo_value,
                "weight": 0.00
            })

    # Sort by value descending, then by required descending
    results.sort(key=lambda r: (-r["value"], -int(r["required"])))

    # Remove duplicates (same format)
    seen_formats = set()
    unique_results = []
    for r in results:
        if r["format"] not in seen_formats:
            seen_formats.add(r["format"])
            unique_results.append(r)

    return jsonify({"status": "ok", "combinations": {"default": unique_results}, "count": len(unique_results)})


@files_bp.route("/bingo/generate", methods=["POST"])
def bingo_generate():
    """Generate bingo card sets."""
    import random
    data = request.get_json(force=True)
    num_per_card = int(data.get("num_per_card", 0))
    max_cards = int(data.get("max_cards", 0))
    card_size = int(data.get("card_size", 0))
    min_num = int(data.get("min_card_number", 0))
    max_num = int(data.get("max_card_number", 0))
    equal_position = data.get("equal_position", [])

    # Server-side validation
    if num_per_card < 1:
        return jsonify({"error": "num_per_card must be a positive integer"}), 400
    if max_cards < 1:
        return jsonify({"error": "max_cards must be a positive integer"}), 400
    if card_size < 1 or card_size > 10000:
        return jsonify({"error": "card_size must be between 1 and 10000"}), 400
    if min_num < 0:
        return jsonify({"error": "min_card_number must be 0 or greater"}), 400
    if max_num < 1:
        return jsonify({"error": "max_card_number must be a positive integer"}), 400
    if min_num >= max_num:
        return jsonify({"error": "min_card_number must be less than max_card_number"}), 400

    total_pos = num_per_card * max_cards
    numbers = list(range(min_num, max_num + 1))

    # Validate equal_position if provided
    if equal_position:
        if not isinstance(equal_position, list):
            return jsonify({"error": "equal_position must be an array of arrays"}), 400
        for idx, group in enumerate(equal_position):
            if not isinstance(group, list):
                return jsonify({"error": f"equal_position[{idx}] must be an array"}), 400
            for val in group:
                if not isinstance(val, int) or val < 0 or val >= total_pos:
                    return jsonify({"error": f"equal_position[{idx}] contains invalid value {val}, must be in [0, {total_pos - 1}]"}), 400

    total_pos = num_per_card * max_cards
    numbers = list(range(min_num, max_num + 1))

    if not equal_position:
        # Case 1: No equal positions, numbers >= total_pos
        if len(numbers) < total_pos:
            return jsonify({"error": f"Not enough numbers ({len(numbers)}) for {total_pos} positions. Provide equal_position."}), 400
        cards = []
        for i in range(card_size):
            random.shuffle(numbers)
            cards.append(numbers[:total_pos][:])
        return jsonify({"status": "ok", "cards": cards, "card_size": card_size, "positions_per_set": total_pos})
    else:
        # Case 2/3: With equal positions
        # Build position-to-group mapping
        pos_to_group = {}
        for group in equal_position:
            for pos in group:
                pos_to_group[pos] = group

        cards = []
        for i in range(card_size):
            card = [0] * total_pos
            random.shuffle(numbers)
            number_idx = 0
            for j in range(total_pos):
                if card[j] > 0:
                    continue  # Already filled by equal position
                if number_idx >= len(numbers):
                    break
                card[j] = numbers[number_idx]
                # Fill equal positions with same number
                if j in pos_to_group:
                    for eq_pos in pos_to_group[j]:
                        if eq_pos < total_pos and eq_pos != j:
                            card[eq_pos] = numbers[number_idx]
                number_idx += 1
            cards.append(card)
        return jsonify({"status": "ok", "cards": cards, "card_size": card_size, "positions_per_set": total_pos})


@files_bp.route("/files/batch-delete-file-check", methods=["POST"])
def batch_delete_file_check():
    """Recursively find all files matching a glob/wildcard pattern.

    Request body: {
        "pattern": "CalacaBingo*.txt",
        "target_dirs": ["dir1", "dir2"],
        "exclude_dirs": ["ex1"],
        "addr": "master" | "ip:port"
    }
    """
    import fnmatch
    data = request.get_json(force=True)
    addr = data.get("addr", "master").strip() or "master"
    pattern = data.get("pattern", "").strip()
    target_dirs = data.get("target_dirs", [])
    exclude_dirs = data.get("exclude_dirs", [])

    if not pattern:
        return jsonify({"error": "file pattern is required"}), 400
    if not target_dirs:
        return jsonify({"error": "at least one target directory is required"}), 400

    if _is_remote_addr(addr):
        body, status = _worker_proxy_post(addr, "/files/batch-search", {
            "mode": "glob", "pattern": pattern, "target_dirs": target_dirs, "exclude_dirs": exclude_dirs
        })
        return jsonify(body), status

    # Normalize exclude dirs for comparison
    exclude_normalized = [os.path.normpath(d.strip()).lower() for d in exclude_dirs if d.strip()]

    found = []

    for td in target_dirs:
        td = os.path.normpath(td.strip())
        if not os.path.isdir(td):
            continue
        for root, dirs, files in os.walk(td, followlinks=True):
            # Check if current root is under an excluded directory
            root_norm = os.path.normpath(root).lower()
            skip = False
            for ex in exclude_normalized:
                if root_norm == ex or root_norm.startswith(ex + os.sep):
                    skip = True
                    break
            if skip:
                continue
            for f in files:
                if fnmatch.fnmatch(f, pattern):
                    found.append(os.path.join(root, f).replace("\\", "/"))

    return jsonify({"status": "ok", "found": found, "count": len(found)})


def _batch_check_core(addr, sources, target_dirs, exclude_dirs):
    """Recursively find all files matching the source filename(s), on one node.

    Shared by /files/batch-check (single node) and
    /files/batch-multi-check (multiple nodes, looped by the caller).

    Target Directories may use wildcard (``*``/``?``) patterns (e.g.
    ``E:/.../SimC*/math/Game/configuration``); they are resolved to literal
    existing directories first (see _resolve_glob_dirs_core), which also
    means a directory pattern that only makes sense for a DIFFERENT
    selected node (multi-node panels send one combined target_dirs list
    across all nodes) simply resolves to nothing on this node instead of
    causing a hard error.

    Returns: (body_dict, http_status)
    """
    # Get all filenames to search for. Source files always live on the master
    # (that's where the user picked them from); only the basename is searched
    # for on the target node's filesystem.
    filenames = set()
    for s in sources:
        s = s.strip()
        if s:
            filenames.add(os.path.basename(s))

    if not filenames:
        return {"error": "no valid source files provided"}, 400

    resolved_dirs, err_body, status = _resolve_glob_dirs_core(addr, target_dirs, exclude_dirs)
    if err_body is not None:
        return err_body, status
    if not resolved_dirs:
        return {"status": "ok", "found": [], "count": 0}, 200

    if _is_remote_addr(addr):
        return _worker_proxy_post(addr, "/files/batch-search", {
            "mode": "exact", "names": list(filenames),
            "target_dirs": resolved_dirs, "exclude_dirs": exclude_dirs
        })

    # Normalize exclude dirs for comparison
    exclude_normalized = [os.path.normpath(d.strip()).lower() for d in exclude_dirs if d.strip()]

    found = []

    for td in resolved_dirs:
        td = os.path.normpath(td.strip())
        if not os.path.isdir(td):
            continue
        for root, dirs, files in os.walk(td, followlinks=True):
            # Check if current root is under an excluded directory
            root_norm = os.path.normpath(root).lower()
            skip = False
            for ex in exclude_normalized:
                if root_norm == ex or root_norm.startswith(ex + os.sep):
                    skip = True
                    break
            if skip:
                continue
            for f in files:
                if f in filenames:
                    found.append(os.path.join(root, f).replace("\\", "/"))

    return {"status": "ok", "found": found, "count": len(found)}, 200


@files_bp.route("/files/batch-check", methods=["POST"])
def batch_check():
    """Recursively find all files matching the source filename(s).

    Request body: {
        "sources": ["path1", "path2"],  // multiple sources (new)
        "source": "path",               // single source (backward compat)
        "target_dirs": ["dir1", "dir2"],
        "exclude_dirs": ["ex1"],
        "addr": "master" | "ip:port"
    }
    """
    data = request.get_json(force=True)
    addr = data.get("addr", "master").strip() or "master"
    sources = data.get("sources", [])
    source = data.get("source", "").strip()
    target_dirs = data.get("target_dirs", [])
    exclude_dirs = data.get("exclude_dirs", [])
    # Backward compat: support single source
    if not sources and source:
        sources = [source]
    # Backward compat: support single target_dir
    if not target_dirs and data.get("target_dir"):
        target_dirs = [data.get("target_dir", "").strip()]

    if not sources:
        return jsonify({"error": "source file path is required"}), 400
    if not target_dirs:
        return jsonify({"error": "at least one target directory is required"}), 400

    body, status = _batch_check_core(addr, sources, target_dirs, exclude_dirs)
    return jsonify(body), status


@files_bp.route("/files/batch-multi-check", methods=["POST"])
def batch_multi_check():
    """Recursively find all files matching the source filename(s), across MULTIPLE nodes.

    Request body: {
        "sources": [...], "target_dirs": [...], "exclude_dirs": [...],
        "addrs": ["master", "ip:port", ...]
    }
    Returns: {"status": "ok", "results": {addr: {"found":[...],"count":n} | {"error":...}}}
    """
    data = request.get_json(force=True)
    addrs = data.get("addrs", [])
    sources = data.get("sources", [])
    target_dirs = data.get("target_dirs", [])
    exclude_dirs = data.get("exclude_dirs", [])

    if not addrs:
        return jsonify({"error": "at least one node is required"}), 400
    if not sources:
        return jsonify({"error": "source file path is required"}), 400
    if not target_dirs:
        return jsonify({"error": "at least one target directory is required"}), 400

    results = {}
    for raw_addr in addrs:
        addr = (raw_addr or "master").strip() or "master"
        body, _status = _batch_check_core(addr, sources, target_dirs, exclude_dirs)
        results[addr] = body

    return jsonify({"status": "ok", "results": results})


def _batch_override_core(addr, sources, target_dirs, exclude_dirs):
    """Recursively find and replace files matching source filename(s), on one node.

    Shared by /files/batch-override (single node) and
    /files/batch-multi-override (multiple nodes, looped by the caller).

    Target Directories may use wildcard (``*``/``?``) patterns and/or be a
    combined list spanning multiple nodes (multi-node panel); resolved to
    this node's literal existing directories up front via
    _resolve_glob_dirs_core, so a pattern/dir belonging to a different node
    resolves to nothing here instead of raising "Directory not found".

    Returns: (body_dict, http_status)
    """
    import shutil

    resolved_dirs, err_body, status = _resolve_glob_dirs_core(addr, target_dirs, exclude_dirs)
    if err_body is not None:
        return err_body, status
    if not resolved_dirs:
        return {
            "status": "ok", "replaced": [],
            "errors": [f"No matching target directories found on {addr}"],
            "count": 0,
        }, 200
    target_dirs = resolved_dirs

    if _is_remote_addr(addr):
        # Source File paths are interpreted relative to the SELECTED NODE's
        # filesystem, same as Target/Exclude Directories -- not always the
        # master. Two cases are supported per source path:
        #   1. The path exists on the master's local disk: it is uploaded to
        #      a scratch dir on the worker first, then used as the override
        #      source (lets you push a file from master onto remote workers).
        #   2. The path does NOT exist on master (e.g. it is actually a path
        #      on the worker itself, as when source and target both live on
        #      the same remote node): it is passed through unchanged and the
        #      worker validates/uses it directly on its own filesystem.
        remote_scratch = f"__kirobatch_override_{uuid.uuid4().hex[:8]}"
        remote_sources = []
        upload_errors = []
        for s in sources:
            s = s.strip()
            if not s:
                continue
            s_norm = os.path.normpath(s)
            if os.path.isfile(s_norm):
                # Case 1: exists on master -- stage it onto the worker.
                basename = os.path.basename(s_norm)
                try:
                    with open(s_norm, "rb") as f:
                        files = {"file": (basename, f)}
                        r = _worker_session.post(
                            f"http://{addr}/files/upload",
                            data={"path": remote_scratch},
                            files=files,
                            timeout=120,
                        )
                    if r.ok:
                        remote_sources.append(r.json().get("path", ""))
                    else:
                        upload_errors.append(f"{basename} - upload failed ({r.status_code})")
                except http_requests.RequestException as exc:
                    upload_errors.append(f"{basename} - {str(exc)}")
            else:
                # Case 2: not on master -- assume it is already a valid path
                # on the worker itself; let the worker validate it.
                remote_sources.append(s)

        if not remote_sources:
            return {"error": "; ".join(upload_errors) or "no valid source files provided"}, 400

        body, status = _worker_proxy_post(addr, "/files/batch-override", {
            "sources": remote_sources, "target_dirs": target_dirs, "exclude_dirs": exclude_dirs
        })
        if isinstance(body, dict) and upload_errors:
            body["errors"] = upload_errors + (body.get("errors") or [])
        return body, status

    # Validate and build source map: filename -> full path
    source_map = {}
    source_errors = []
    for s in sources:
        s = s.strip()
        if not s:
            continue
        s_norm = os.path.normpath(s)
        if not os.path.isfile(s_norm):
            source_errors.append(f"Source file not found: {s}")
            continue
        source_map[os.path.basename(s_norm)] = s_norm

    if not source_map:
        error_msg = "; ".join(source_errors) if source_errors else "no valid source files provided"
        return {"error": error_msg}, 400

    # Normalize exclude dirs
    exclude_normalized = [os.path.normpath(d.strip()).lower() for d in exclude_dirs if d.strip()]

    replaced = []
    errors = list(source_errors)  # Include source file not found errors

    for td in target_dirs:
        td = os.path.normpath(td.strip())
        if not os.path.isdir(td):
            errors.append(f"Directory not found: {td}")
            continue
        for root, dirs, files in os.walk(td, followlinks=True):
            # Check if current root is under an excluded directory
            root_norm = os.path.normpath(root).lower()
            skip = False
            for ex in exclude_normalized:
                if root_norm == ex or root_norm.startswith(ex + os.sep):
                    skip = True
                    break
            if skip:
                continue
            for f in files:
                if f in source_map:
                    target_path = os.path.join(root, f)
                    if os.path.normpath(target_path) == source_map[f]:
                        continue
                    try:
                        shutil.copy2(source_map[f], target_path)
                        replaced.append(target_path.replace("\\", "/"))
                    except Exception as exc:
                        errors.append(f"{target_path.replace(chr(92), '/')} - {str(exc)}")

    return {"status": "ok", "replaced": replaced, "errors": errors, "count": len(replaced)}, 200


@files_bp.route("/files/batch-override", methods=["POST"])
def batch_override():
    """Recursively find and replace files matching the source filename(s).

    Request body: {
        "sources": ["path1", "path2"],  // multiple sources (new), always local to master
        "source": "path",               // single source (backward compat)
        "target_dirs": ["dir1"],
        "exclude_dirs": ["ex1"],
        "addr": "master" | "ip:port"
    }
    """
    data = request.get_json(force=True)
    addr = data.get("addr", "master").strip() or "master"
    sources = data.get("sources", [])
    source = data.get("source", "").strip()
    target_dirs = data.get("target_dirs", [])
    exclude_dirs = data.get("exclude_dirs", [])
    # Backward compat: support single source
    if not sources and source:
        sources = [source]
    # Backward compat
    if not target_dirs and data.get("target_dir"):
        target_dirs = [data.get("target_dir", "").strip()]

    if not sources:
        return jsonify({"error": "source file path is required"}), 400
    if not target_dirs:
        return jsonify({"error": "at least one target directory is required"}), 400

    body, status = _batch_override_core(addr, sources, target_dirs, exclude_dirs)
    return jsonify(body), status


@files_bp.route("/files/batch-multi-override", methods=["POST"])
def batch_multi_override():
    """Recursively find and replace files matching source filename(s), across MULTIPLE nodes.

    Request body: {
        "sources": [...], "target_dirs": [...], "exclude_dirs": [...],
        "addrs": ["master", "ip:port", ...]
    }
    Returns: {"status": "ok", "results": {addr: {"replaced":[...],"errors":[...]} | {"error":...}}}
    """
    data = request.get_json(force=True)
    addrs = data.get("addrs", [])
    sources = data.get("sources", [])
    target_dirs = data.get("target_dirs", [])
    exclude_dirs = data.get("exclude_dirs", [])

    if not addrs:
        return jsonify({"error": "at least one node is required"}), 400
    if not sources:
        return jsonify({"error": "source file path is required"}), 400
    if not target_dirs:
        return jsonify({"error": "at least one target directory is required"}), 400

    results = {}
    for raw_addr in addrs:
        addr = (raw_addr or "master").strip() or "master"
        body, _status = _batch_override_core(addr, sources, target_dirs, exclude_dirs)
        results[addr] = body

    return jsonify({"status": "ok", "results": results})


@files_bp.route("/files/batch-delete", methods=["POST"])
def batch_delete():
    """Delete a list of files.

    Request body: {"files": ["/full/path/to/file1", ...], "addr": "master" | "ip:port"}
    """
    data = request.get_json(force=True)
    addr = data.get("addr", "master").strip() or "master"
    files = data.get("files", [])

    if not files:
        return jsonify({"error": "no files provided for deletion"}), 400

    if _is_remote_addr(addr):
        body, status = _worker_proxy_post(addr, "/files/batch-delete-files", {"files": files})
        return jsonify(body), status

    deleted = []
    errors = []

    for file_path in files:
        file_path = file_path.strip()
        if not file_path:
            continue
        file_path_norm = os.path.normpath(file_path)
        if not os.path.isfile(file_path_norm):
            errors.append(f"File not found: {file_path}")
            continue
        try:
            os.remove(file_path_norm)
            deleted.append(file_path_norm.replace("\\", "/"))
        except Exception as exc:
            errors.append(f"{file_path_norm.replace(chr(92), '/')} - {str(exc)}")

    return jsonify({"status": "ok", "deleted": deleted, "errors": errors, "count": len(deleted)})


# ---------------------------------------------------------------------------
# Batch Edit File (properties file key=value editing)
# ---------------------------------------------------------------------------

@files_bp.route("/files/batch-edit-check", methods=["POST"])
def batch_edit_check():
    """Recursively find all files matching the given filename.

    Request body: {"filename": "name.ext", "target_dirs": ["dir1"], "exclude_dirs": ["ex1"], "addr": "master" | "ip:port"}
    """
    data = request.get_json(force=True)
    addr = data.get("addr", "master").strip() or "master"
    filename = data.get("filename", "").strip()
    target_dirs = data.get("target_dirs", [])
    exclude_dirs = data.get("exclude_dirs", [])

    if not filename:
        return jsonify({"error": "filename is required"}), 400
    if not target_dirs:
        return jsonify({"error": "at least one target directory is required"}), 400

    if _is_remote_addr(addr):
        body, status = _worker_proxy_post(addr, "/files/batch-search", {
            "mode": "exact", "names": [filename], "target_dirs": target_dirs, "exclude_dirs": exclude_dirs
        })
        return jsonify(body), status

    exclude_normalized = [os.path.normpath(d.strip()).lower() for d in exclude_dirs if d.strip()]
    found = []

    for td in target_dirs:
        td = os.path.normpath(td.strip())
        if not os.path.isdir(td):
            continue
        for root, dirs, files in os.walk(td, followlinks=True):
            root_norm = os.path.normpath(root).lower()
            skip = False
            for ex in exclude_normalized:
                if root_norm == ex or root_norm.startswith(ex + os.sep):
                    skip = True
                    break
            if skip:
                continue
            for f in files:
                if f == filename:
                    found.append(os.path.join(root, f).replace("\\", "/"))

    return jsonify({"status": "ok", "found": found, "count": len(found)})


@files_bp.route("/files/batch-edit-apply", methods=["POST"])
def batch_edit_apply():
    """Batch edit .properties files: update existing keys or append new ones.

    Request body: {
        "filename": "stresstest.properties",
        "contents": ["WildEastGameIds=200", "openCardAmount=1"],
        "target_dirs": ["D:\\tools2"],
        "exclude_dirs": [],
        "addr": "master" | "ip:port"
    }
    """
    data = request.get_json(force=True)
    addr = data.get("addr", "master").strip() or "master"
    filename = data.get("filename", "").strip()
    contents = data.get("contents", [])
    target_dirs = data.get("target_dirs", [])
    exclude_dirs = data.get("exclude_dirs", [])

    if not filename:
        return jsonify({"error": "filename is required"}), 400
    if not contents:
        return jsonify({"error": "at least one content entry is required"}), 400
    if not target_dirs:
        return jsonify({"error": "at least one target directory is required"}), 400
    if not filename.endswith(".properties"):
        return jsonify({"error": "Batch Edit currently only supports .properties files"}), 400

    if _is_remote_addr(addr):
        body, status = _worker_proxy_post(addr, "/files/batch-edit-apply", {
            "filename": filename, "contents": contents, "target_dirs": target_dirs, "exclude_dirs": exclude_dirs
        })
        return jsonify(body), status

    # Parse contents into key=value pairs
    kv_pairs = []
    for item in contents:
        item = item.strip()
        if "=" in item:
            key, value = item.split("=", 1)
            kv_pairs.append((key.strip(), value.strip()))
        else:
            # Treat as key with empty value
            kv_pairs.append((item.strip(), ""))

    if not kv_pairs:
        return jsonify({"error": "no valid key=value pairs found in contents"}), 400

    # Find all matching files
    exclude_normalized = [os.path.normpath(d.strip()).lower() for d in exclude_dirs if d.strip()]
    found_files = []

    for td in target_dirs:
        td = os.path.normpath(td.strip())
        if not os.path.isdir(td):
            continue
        for root, dirs, files in os.walk(td, followlinks=True):
            root_norm = os.path.normpath(root).lower()
            skip = False
            for ex in exclude_normalized:
                if root_norm == ex or root_norm.startswith(ex + os.sep):
                    skip = True
                    break
            if skip:
                continue
            for f in files:
                if f == filename:
                    found_files.append(os.path.join(root, f))

    updated = []
    errors = []

    for file_path in found_files:
        try:
            # Read current content
            with open(file_path, "r", encoding="utf-8") as fh:
                lines = fh.readlines()

            # Track which keys have been updated
            keys_updated = set()
            new_lines = []

            for line in lines:
                stripped = line.rstrip("\n").rstrip("\r")
                matched = False
                for key, value in kv_pairs:
                    # Check if line starts with the key (handle key= or key =)
                    if stripped.startswith(key) and "=" in stripped:
                        line_key = stripped.split("=", 1)[0].strip()
                        if line_key == key:
                            new_lines.append(f"{key}={value}\n")
                            keys_updated.add(key)
                            matched = True
                            break
                if not matched:
                    new_lines.append(line if line.endswith("\n") else line + "\n")

            # Append keys that were not found in the file
            for key, value in kv_pairs:
                if key not in keys_updated:
                    # Ensure there's a newline before appending
                    if new_lines and not new_lines[-1].endswith("\n"):
                        new_lines[-1] += "\n"
                    new_lines.append(f"{key}={value}\n")

            # Write back
            with open(file_path, "w", encoding="utf-8") as fh:
                fh.writelines(new_lines)

            updated.append(file_path.replace("\\", "/"))
        except Exception as exc:
            errors.append(f"{file_path.replace(chr(92), '/')} - {str(exc)}")

    return jsonify({"status": "ok", "updated": updated, "errors": errors, "count": len(updated)})


@files_bp.route("/files/batch-edit-read", methods=["POST"])
def batch_edit_read():
    """Read the content of a file for preview/editing.

    Request body: {"path": "/full/path/to/file", "addr": "master" | "ip:port"}
    """
    data = request.get_json(force=True)
    addr = data.get("addr", "master").strip() or "master"
    file_path = data.get("path", "").strip()

    if not file_path:
        return jsonify({"error": "path is required"}), 400

    if _is_remote_addr(addr):
        # /files/read on the worker is a GET endpoint; proxy via query params.
        try:
            r = _worker_session.get(f"http://{addr}/files/read", params={"path": file_path}, timeout=10)
            try:
                return jsonify(r.json()), r.status_code
            except ValueError:
                return jsonify({"error": "Worker returned non-JSON"}), 500
        except http_requests.RequestException as exc:
            return jsonify({"error": str(exc)}), 500

    file_path = os.path.normpath(file_path)
    if not os.path.isfile(file_path):
        return jsonify({"error": f"File not found: {file_path}"}), 404

    try:
        with open(file_path, "r", encoding="utf-8") as fh:
            content = fh.read()
        return jsonify({"status": "ok", "content": content})
    except UnicodeDecodeError:
        # Try latin-1 as fallback
        try:
            with open(file_path, "r", encoding="latin-1") as fh:
                content = fh.read()
            return jsonify({"status": "ok", "content": content})
        except Exception as exc:
            return jsonify({"error": f"Cannot read file (binary?): {str(exc)}"}), 400
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@files_bp.route("/files/batch-edit-save", methods=["POST"])
def batch_edit_save():
    """Save edited content back to a file.

    Request body: {"path": "/full/path/to/file", "content": "new content", "addr": "master" | "ip:port"}
    """
    data = request.get_json(force=True)
    addr = data.get("addr", "master").strip() or "master"
    file_path = data.get("path", "").strip()
    content = data.get("content", "")

    if not file_path:
        return jsonify({"error": "path is required"}), 400

    if _is_remote_addr(addr):
        body, status = _worker_proxy_post(addr, "/files/write", {"path": file_path, "content": content})
        return jsonify(body), status

    file_path = os.path.normpath(file_path)
    if not os.path.isfile(file_path):
        return jsonify({"error": f"File not found: {file_path}"}), 404

    try:
        with open(file_path, "w", encoding="utf-8") as fh:
            fh.write(content)
        return jsonify({"status": "ok", "message": "File saved successfully"})
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


# ---------------------------------------------------------------------------
# Shared directory-pattern resolution (glob-aware, per-node)
# ---------------------------------------------------------------------------

def _resolve_glob_dirs_core(addr, dir_patterns, exclude_dirs):
    """Resolve directory glob patterns to literal, existing directories on one node.

    Shared by Batch Upload/Override/Download's Target Directories handling.
    Target Directories may contain wildcard (``*``/``?``) segments (e.g.
    ``E:/.../SimC*/math/Game/configuration``) AND, in the multi-node panels,
    a single combined list covering every selected node even though each
    node's production_dir root differs (or doesn't exist at all on other
    nodes/platforms). Resolving each node's applicable, EXISTING directories
    up front -- instead of matching file-search/copy logic against the raw
    unresolved patterns everywhere else -- means:
      1. Wildcard patterns actually expand to real directories (os.path.isdir
         on a literal "*" string is always False, so without this step glob
         patterns silently matched nothing).
      2. A directory that belongs to a DIFFERENT selected node (not this
         one) is simply absent from the resolved list, rather than causing
         a hard "Directory not found" error for this node's request.

    Returns: (found_dirs, error_body_or_None, http_status)
    """
    import glob

    if _is_remote_addr(addr):
        body, status = _worker_proxy_post(addr, "/files/batch-search", {
            "mode": "dir_glob", "dir_patterns": dir_patterns, "exclude_dirs": exclude_dirs
        })
        if status != 200 or not isinstance(body, dict):
            err = body if isinstance(body, dict) else {
                "error": f"resolve directories failed (status {status})"
            }
            return [], err, status
        return body.get("found", []), None, 200

    exclude_normalized = [os.path.normpath(d.strip()).lower() for d in exclude_dirs if d.strip()]
    found = []

    for td in dir_patterns:
        td = td.strip()
        if not td:
            continue
        # Use glob to expand wildcard patterns; treat as a literal path
        # otherwise (glob.glob would return [] for a literal nonexistent
        # path just the same as os.path.isdir would report False below).
        matched_dirs = glob.glob(td) if ("*" in td or "?" in td) else [td]

        for d in matched_dirs:
            d_norm = os.path.normpath(d)
            if not os.path.isdir(d_norm):
                continue
            # Check exclusion
            d_lower = d_norm.lower()
            skip = False
            for ex in exclude_normalized:
                if d_lower == ex or d_lower.startswith(ex + os.sep):
                    skip = True
                    break
            if skip:
                continue
            found.append(d_norm.replace("\\", "/"))

    # Remove duplicates and sort
    return sorted(set(found)), None, 200


# ---------------------------------------------------------------------------
# Batch Upload File (glob pattern directory matching + file copy)
# ---------------------------------------------------------------------------

def _batch_up_check_core(addr, src_files, target_dirs, exclude_dirs):
    """Find directories matching glob patterns for batch upload, on one node.

    Shared by /files/batch-up-check (single node) and
    /files/batch-multi-up-check (multiple nodes, looped by the caller).

    Returns: (body_dict, http_status)
    """
    found, err_body, status = _resolve_glob_dirs_core(addr, target_dirs, exclude_dirs)
    if err_body is not None:
        return err_body, status
    return {"status": "ok", "found": found, "count": len(found)}, 200


@files_bp.route("/files/batch-up-check", methods=["POST"])
def batch_up_check():
    """Find directories matching glob patterns for batch upload.

    Target directories support * wildcard patterns (glob).
    Request body: {
        "src_files": ["VBWildBallLogic.jar", "VBWildEastBingoLogic.jar"],
        "target_dirs": ["E:/python/workSpace/temp/ShowBingoSim/*/simulator/B2BGameSimulator/lib"],
        "exclude_dirs": [],
        "addr": "master" | "ip:port"
    }
    """
    data = request.get_json(force=True)
    addr = data.get("addr", "master").strip() or "master"
    src_files = data.get("src_files", [])
    target_dirs = data.get("target_dirs", [])
    exclude_dirs = data.get("exclude_dirs", [])

    if not src_files:
        return jsonify({"error": "at least one source file is required"}), 400
    if not target_dirs:
        return jsonify({"error": "at least one target directory is required"}), 400

    body, status = _batch_up_check_core(addr, src_files, target_dirs, exclude_dirs)
    return jsonify(body), status


@files_bp.route("/files/batch-multi-up-check", methods=["POST"])
def batch_multi_up_check():
    """Find directories matching glob patterns for batch upload, across MULTIPLE nodes.

    Selected nodes are expected to share an identical production_dir
    subdirectory structure, so the same target_dirs/exclude_dirs patterns
    are applied to every selected node; each node is still searched
    independently (glob results can differ per node, e.g. different drive
    letters or partially-synced directories).

    Request body: {
        "src_files": [...], "target_dirs": [...], "exclude_dirs": [...],
        "addrs": ["master", "ip:port", ...]
    }
    Returns: {"status": "ok", "results": {addr: {"found":[...],"count":n} | {"error":...}}}
    """
    data = request.get_json(force=True)
    addrs = data.get("addrs", [])
    src_files = data.get("src_files", [])
    target_dirs = data.get("target_dirs", [])
    exclude_dirs = data.get("exclude_dirs", [])

    if not addrs:
        return jsonify({"error": "at least one node is required"}), 400
    if not src_files:
        return jsonify({"error": "at least one source file is required"}), 400
    if not target_dirs:
        return jsonify({"error": "at least one target directory is required"}), 400

    results = {}
    for raw_addr in addrs:
        addr = (raw_addr or "master").strip() or "master"
        body, _status = _batch_up_check_core(addr, src_files, target_dirs, exclude_dirs)
        results[addr] = body

    return jsonify({"status": "ok", "results": results})


def _batch_up_upload_core(addr, src_files, target_dirs):
    """Copy source files to all selected target directories, on one node.

    Shared by /files/batch-up-upload (single node) and
    /files/batch-multi-up-upload (multiple nodes, looped by the caller).

    Returns: (body_dict, http_status)
    """
    import shutil

    if _is_remote_addr(addr):
        # Source File paths are interpreted relative to the SELECTED NODE's
        # filesystem, same as Target Directories. Two cases per source path:
        #   1. Exists on master's local disk: stage it onto the worker via
        #      upload (lets you push a file from master onto a worker).
        #   2. Does NOT exist on master (e.g. it is actually a path on the
        #      worker itself, when source and target both live on the same
        #      remote node): pass it through unchanged, worker validates it.
        remote_scratch = f"__kirobatch_upload_{uuid.uuid4().hex[:8]}"
        remote_sources = []
        errors = []
        for src in src_files:
            src = src.strip()
            if not src:
                continue
            src_path = os.path.normpath(src)
            if os.path.isfile(src_path):
                try:
                    with open(src_path, "rb") as f:
                        files = {"file": (os.path.basename(src_path), f)}
                        r = _worker_session.post(
                            f"http://{addr}/files/upload",
                            data={"path": remote_scratch},
                            files=files,
                            timeout=120,
                        )
                    if r.ok:
                        remote_sources.append(r.json().get("path", ""))
                    else:
                        errors.append(f"{os.path.basename(src_path)} - upload failed ({r.status_code})")
                except http_requests.RequestException as exc:
                    errors.append(f"{os.path.basename(src_path)} - {str(exc)}")
            else:
                remote_sources.append(src)

        if not remote_sources:
            return {"error": "; ".join(errors) or "no valid source files provided"}, 400

        body, status = _worker_proxy_post(addr, "/files/batch-up-upload", {
            "src_files": remote_sources, "target_dirs": target_dirs
        })
        if isinstance(body, dict) and errors:
            body["errors"] = errors + (body.get("errors") or [])
        return body, status

    copied = []
    errors = []

    for src in src_files:
        src = src.strip()
        if not src:
            continue

        # Determine if src is a full path or just a filename
        src_path = os.path.normpath(src)
        if not os.path.isfile(src_path):
            errors.append(f"Source file not found: {src}")
            continue

        filename = os.path.basename(src_path)

        for td in target_dirs:
            td_norm = os.path.normpath(td.strip())
            if not os.path.isdir(td_norm):
                errors.append(f"Target directory not found: {td}")
                continue
            dest_path = os.path.join(td_norm, filename)
            try:
                shutil.copy2(src_path, dest_path)
                copied.append(dest_path.replace("\\", "/"))
            except Exception as exc:
                errors.append(f"{dest_path.replace(chr(92), '/')} - {str(exc)}")

    return {"status": "ok", "copied": copied, "errors": errors, "count": len(copied)}, 200


@files_bp.route("/files/batch-up-upload", methods=["POST"])
def batch_up_upload():
    """Copy source files to all selected target directories.

    For each source file name, search the system for that file (using the same
    name in the working directory or provided path), then copy it to each
    selected target directory.

    Request body: {
        "src_files": ["VBWildBallLogic.jar", "VBWildEastBingoLogic.jar"],  // always local to master
        "target_dirs": ["E:/path/to/dir1", "E:/path/to/dir2"],
        "addr": "master" | "ip:port"
    }
    """
    data = request.get_json(force=True)
    addr = data.get("addr", "master").strip() or "master"
    src_files = data.get("src_files", [])
    target_dirs = data.get("target_dirs", [])

    if not src_files:
        return jsonify({"error": "at least one source file is required"}), 400
    if not target_dirs:
        return jsonify({"error": "at least one target directory is required"}), 400

    body, status = _batch_up_upload_core(addr, src_files, target_dirs)
    return jsonify(body), status


@files_bp.route("/files/batch-multi-up-upload", methods=["POST"])
def batch_multi_up_upload():
    """Copy source files to target directories on MULTIPLE selected nodes.

    Each node's production_dir/simulator_dir subdirectory structure is
    assumed identical, so the same target directory glob patterns are
    re-expanded independently per node (mirroring /files/batch-up-check)
    before uploading, since actual matching directories can still differ
    slightly per node (e.g. partially synced trees). A node with zero
    matching directories is reported as an error for that node rather
    than failing the whole request.

    Runs sequentially per selected node (source files are always read from
    master's local disk). A failure on one node does not stop the rest.

    Request body: {
        "src_files": [...], "target_dirs": [...], "exclude_dirs": [...],
        "addrs": ["master", "ip:port", ...]
    }
    Returns: {"status": "ok", "results": {addr: {"copied":[...],"errors":[...]} | {"error":...}}}
    """
    data = request.get_json(force=True)
    addrs = data.get("addrs", [])
    src_files = data.get("src_files", [])
    target_dirs = data.get("target_dirs", [])
    exclude_dirs = data.get("exclude_dirs", [])

    if not addrs:
        return jsonify({"error": "at least one node is required"}), 400
    if not src_files:
        return jsonify({"error": "at least one source file is required"}), 400
    if not target_dirs:
        return jsonify({"error": "at least one target directory is required"}), 400

    results = {}
    for raw_addr in addrs:
        addr = (raw_addr or "master").strip() or "master"
        check_body, check_status = _batch_up_check_core(addr, src_files, target_dirs, exclude_dirs)
        if check_status != 200 or not isinstance(check_body, dict):
            results[addr] = check_body if isinstance(check_body, dict) else {
                "error": f"check failed (status {check_status})"
            }
            continue
        found_dirs = check_body.get("found", [])
        if not found_dirs:
            results[addr] = {"error": "no matching target directories found"}
            continue
        body, _status = _batch_up_upload_core(addr, src_files, found_dirs)
        results[addr] = body

    return jsonify({"status": "ok", "results": results})


# ---------------------------------------------------------------------------
# Batch Download File (wildcard search + zip download)
# ---------------------------------------------------------------------------

def _batch_dl_check_core(addr, filename, target_dirs, exclude_dirs):
    """Recursively find files matching the given filename, on one node.

    Shared by /files/batch-dl-check (single node) and
    /files/batch-multi-dl-check (multiple nodes, looped by the caller).

    Target Directories may use wildcard (``*``/``?``) patterns and/or be a
    combined list spanning multiple nodes (multi-node panel); resolved to
    this node's literal existing directories up front via
    _resolve_glob_dirs_core.

    Returns: (body_dict, http_status)
    """
    import fnmatch

    resolved_dirs, err_body, status = _resolve_glob_dirs_core(addr, target_dirs, exclude_dirs)
    if err_body is not None:
        return err_body, status
    if not resolved_dirs:
        return {"status": "ok", "found": [], "count": 0}, 200

    use_wildcard = "*" in filename or "?" in filename

    if _is_remote_addr(addr):
        return _worker_proxy_post(addr, "/files/batch-search", {
            "mode": "glob" if use_wildcard else "exact",
            "pattern": filename,
            "names": [filename],
            "target_dirs": resolved_dirs, "exclude_dirs": exclude_dirs
        })

    exclude_normalized = [os.path.normpath(d.strip()).lower() for d in exclude_dirs if d.strip()]
    found = []

    for td in resolved_dirs:
        td = os.path.normpath(td.strip())
        if not os.path.isdir(td):
            continue
        for root, dirs, files in os.walk(td, followlinks=True):
            root_norm = os.path.normpath(root).lower()
            skip = False
            for ex in exclude_normalized:
                if root_norm == ex or root_norm.startswith(ex + os.sep):
                    skip = True
                    break
            if skip:
                continue
            for f in files:
                if use_wildcard:
                    if fnmatch.fnmatch(f, filename):
                        found.append(os.path.join(root, f).replace("\\", "/"))
                else:
                    if f == filename:
                        found.append(os.path.join(root, f).replace("\\", "/"))

    return {"status": "ok", "found": found, "count": len(found)}, 200


@files_bp.route("/files/batch-dl-check", methods=["POST"])
def batch_dl_check():
    """Recursively find files matching the given filename (supports * wildcard).

    Request body: {"filename": "CalacaBingo*.txt", "target_dirs": ["dir1"], "exclude_dirs": ["ex1"], "addr": "master" | "ip:port"}
    """
    data = request.get_json(force=True)
    addr = data.get("addr", "master").strip() or "master"
    filename = data.get("filename", "").strip()
    target_dirs = data.get("target_dirs", [])
    exclude_dirs = data.get("exclude_dirs", [])

    if not filename:
        return jsonify({"error": "filename is required"}), 400
    if not target_dirs:
        return jsonify({"error": "at least one target directory is required"}), 400

    body, status = _batch_dl_check_core(addr, filename, target_dirs, exclude_dirs)
    return jsonify(body), status


@files_bp.route("/files/batch-multi-dl-check", methods=["POST"])
def batch_multi_dl_check():
    """Recursively find files matching the given filename, across MULTIPLE nodes.

    Request body: {
        "filename": "...", "target_dirs": [...], "exclude_dirs": [...],
        "addrs": ["master", "ip:port", ...]
    }
    Returns: {"status": "ok", "results": {addr: {"found":[...],"count":n} | {"error":...}}}
    """
    data = request.get_json(force=True)
    addrs = data.get("addrs", [])
    filename = data.get("filename", "").strip()
    target_dirs = data.get("target_dirs", [])
    exclude_dirs = data.get("exclude_dirs", [])

    if not addrs:
        return jsonify({"error": "at least one node is required"}), 400
    if not filename:
        return jsonify({"error": "filename is required"}), 400
    if not target_dirs:
        return jsonify({"error": "at least one target directory is required"}), 400

    results = {}
    for raw_addr in addrs:
        addr = (raw_addr or "master").strip() or "master"
        body, _status = _batch_dl_check_core(addr, filename, target_dirs, exclude_dirs)
        results[addr] = body

    return jsonify({"status": "ok", "results": results})


def _sanitize_node_folder_name(addr: str) -> str:
    """Turn a node address into a filesystem/zip-path-safe folder name."""
    return (addr or "master").replace(":", "_").replace("\\", "_").replace("/", "_")


def _filter_target_dirs_for_files(target_dirs, files):
    """Return only the target_dirs that are an ancestor of at least one file.

    In multi-node batch download, `target_dirs` is a COMBINED list covering
    ALL selected nodes (e.g. Master's "E:/python/.../ShowBingoSim" AND a
    Linux worker's "/home/ubuntu/temp/sim.../temp"). Forwarding the whole
    combined list to a single node is wrong: that node's own
    /files/batch-dl-download endpoint picks target_dirs[0] as its zip
    staging base directory, and if some OTHER node's path happens to be
    first, it doesn't exist on this node at all -- causing
    "Target directory not found" even though this node's own files were
    found successfully during Check.

    Pure string comparison (no os.path) is used deliberately: `files` are
    already-found paths using forward slashes, but they may describe a
    remote Linux filesystem while master itself runs on Windows, so
    platform-dependent path functions (os.path.normpath/os.sep) would give
    wrong answers for the other platform's paths.
    """
    if not files:
        return []
    normalized_files = [f.replace("\\", "/").lower() for f in files]
    relevant = []
    for td in target_dirs:
        td_norm = td.strip().replace("\\", "/").rstrip("/").lower()
        if not td_norm:
            continue
        for f in normalized_files:
            if f == td_norm or f.startswith(td_norm + "/"):
                relevant.append(td)
                break
    return relevant


def _batch_dl_add_node_to_zip(combined_zf, addr, files, target_dirs, errors):
    """Add one node's selected files into an already-open combined zip.

    Files are placed under a subfolder named after the node (e.g.
    "master/" or "10_10_34_26_5002/"), preserving each file's relative
    path from whichever target directory it matched -- same relative
    layout as the existing single-node download, just namespaced per node
    so multiple nodes' files never collide in the combined zip.

    Any per-file/per-node failure is appended to `errors` (mutated
    in-place) rather than raised, so one bad node/file does not abort the
    whole multi-node download.
    """
    import io
    import zipfile

    node_folder = _sanitize_node_folder_name(addr)

    # target_dirs here is the raw combined list from the request (possibly
    # containing wildcard patterns and/or directories belonging to OTHER
    # selected nodes). Resolve wildcards to this node's literal existing
    # directories first, then keep only the ones that are actually an
    # ancestor of at least one of this node's found files -- both steps
    # are needed: resolving handles glob patterns, filtering handles the
    # combined multi-node list.
    resolved_dirs, _err, _status = _resolve_glob_dirs_core(addr, target_dirs, [])
    node_target_dirs = _filter_target_dirs_for_files(resolved_dirs, files)
    if not node_target_dirs:
        errors.append(f"{addr}: none of the provided target directories match this node's found files")
        return

    if _is_remote_addr(addr):
        r, status = _worker_proxy_post(addr, "/files/batch-dl-download", {
            "files": files, "target_dirs": node_target_dirs
        }, timeout=60, stream=True)
        if status != 200:
            try:
                err_body = r.json()
                errors.append(f"{addr}: {err_body.get('error', 'download failed')}")
            except Exception:
                errors.append(f"{addr}: worker returned status {status}")
            return
        try:
            content = r.content
            inner_zip = zipfile.ZipFile(io.BytesIO(content))
        except Exception as exc:
            errors.append(f"{addr}: invalid zip data from worker - {exc}")
            return
        for name in inner_zip.namelist():
            # Worker's zip entries are prefixed with "temp/" (built via
            # os.path.join, which uses "\\" on Windows workers) -- strip
            # that leading segment regardless of which separator was used,
            # then re-root under this node's folder in the combined zip.
            name_normalized = name.replace("\\", "/")
            rel = name_normalized.split("/", 1)[1] if "/" in name_normalized else name_normalized
            try:
                combined_zf.writestr(f"{node_folder}/{rel}", inner_zip.read(name))
            except Exception as exc:
                errors.append(f"{addr}: {name} - {exc}")
        return

    # Local (master) files: write directly into the combined zip, no
    # intermediate temp folder needed since we already have a live
    # ZipFile handle.
    for file_path in files:
        file_path_norm = os.path.normpath(file_path)
        if not os.path.isfile(file_path_norm):
            errors.append(f"{addr}: File not found: {file_path}")
            continue

        rel_path = None
        for td in node_target_dirs:
            td_norm = os.path.normpath(td.strip())
            if file_path_norm.lower().startswith(td_norm.lower() + os.sep):
                rel_path = os.path.relpath(file_path_norm, td_norm)
                break
        if rel_path is None:
            rel_path = os.path.basename(file_path_norm)

        arcname = f"{node_folder}/{rel_path.replace(chr(92), '/')}"
        try:
            combined_zf.write(file_path_norm, arcname)
        except Exception as exc:
            errors.append(f"{addr}: {file_path} - {exc}")


@files_bp.route("/files/batch-multi-dl-download", methods=["POST"])
def batch_multi_dl_download():
    """Download files from MULTIPLE selected nodes as a single combined zip.

    Each node's files are placed under a subfolder named after that node
    (e.g. "master/", "10.10.34.26_5002/") inside one zip, so selecting N
    nodes results in ONE download instead of N separate manual downloads.

    Request body: {
        "target_dirs": ["dir1"],
        "addrs": ["master", "ip:port", ...],
        "per_node_files": {"master": ["/full/path/1", ...], "ip:port": [...]}
    }
    """
    import io
    import zipfile
    from flask import send_file

    data = request.get_json(force=True)
    addrs = data.get("addrs", [])
    target_dirs = data.get("target_dirs", [])
    per_node_files = data.get("per_node_files", {})

    if not addrs:
        return jsonify({"error": "at least one node is required"}), 400
    if not target_dirs:
        return jsonify({"error": "at least one target directory is required"}), 400
    if not per_node_files or not any(per_node_files.values()):
        return jsonify({"error": "no files selected for any node"}), 400

    errors = []
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as combined_zf:
        for raw_addr in addrs:
            addr = (raw_addr or "master").strip() or "master"
            files = per_node_files.get(addr) or per_node_files.get(raw_addr) or []
            if not files:
                continue
            _batch_dl_add_node_to_zip(combined_zf, addr, files, target_dirs, errors)
        if errors:
            combined_zf.writestr("errors.txt", "\n".join(errors))

    if len(buf.getvalue()) == 0:
        return jsonify({"error": "; ".join(errors) or "no files were downloaded"}), 500

    buf.seek(0)
    return send_file(
        buf,
        mimetype="application/zip",
        as_attachment=True,
        download_name="batch_multi_download.zip",
    )


@files_bp.route("/files/batch-dl-download", methods=["POST"])
def batch_dl_download():
    """Create a zip of selected files preserving relative directory structure.

    The zip is created under a 'temp' folder in the first target directory,
    preserving the relative paths from that target directory.

    Request body: {"files": ["/full/path/to/file1", ...], "target_dirs": ["dir1"], "addr": "master" | "ip:port"}
    """
    import shutil
    import zipfile
    from flask import send_file, Response

    data = request.get_json(force=True)
    addr = data.get("addr", "master").strip() or "master"
    files = data.get("files", [])
    target_dirs = data.get("target_dirs", [])

    if not files:
        return jsonify({"error": "no files selected"}), 400
    if not target_dirs:
        return jsonify({"error": "at least one target directory is required"}), 400

    if _is_remote_addr(addr):
        r, status = _worker_proxy_post(addr, "/files/batch-dl-download", {
            "files": files, "target_dirs": target_dirs
        }, timeout=60, stream=True)
        if status != 200:
            try:
                return jsonify(r.json()), status
            except Exception:
                return jsonify({"error": f"Worker returned {status}"}), status
        return Response(
            r.iter_content(chunk_size=8192),
            headers={"Content-Disposition": "attachment; filename=temp.zip",
                     "Content-Type": r.headers.get("Content-Type", "application/zip")}
        )

    # Use the first target directory as the base for temp folder
    base_dir = os.path.normpath(target_dirs[0].strip())
    if not os.path.isdir(base_dir):
        return jsonify({"error": f"Target directory not found: {base_dir}"}), 404

    temp_dir = os.path.join(base_dir, "temp")
    zip_path = os.path.join(base_dir, "temp.zip")

    # Remove existing temp folder and zip
    if os.path.exists(temp_dir):
        shutil.rmtree(temp_dir)
    if os.path.exists(zip_path):
        os.remove(zip_path)

    # Create temp folder and copy files preserving relative structure
    os.makedirs(temp_dir, exist_ok=True)

    errors = []
    for file_path in files:
        file_path_norm = os.path.normpath(file_path)
        if not os.path.isfile(file_path_norm):
            errors.append(f"File not found: {file_path}")
            continue

        # Determine relative path from the matching target directory
        rel_path = None
        for td in target_dirs:
            td_norm = os.path.normpath(td.strip())
            if file_path_norm.lower().startswith(td_norm.lower() + os.sep):
                rel_path = os.path.relpath(file_path_norm, td_norm)
                break

        if rel_path is None:
            # Fallback: use filename only
            rel_path = os.path.basename(file_path_norm)

        dest_path = os.path.join(temp_dir, rel_path)
        dest_dir = os.path.dirname(dest_path)
        os.makedirs(dest_dir, exist_ok=True)

        try:
            shutil.copy2(file_path_norm, dest_path)
        except Exception as exc:
            errors.append(f"{file_path} - {str(exc)}")

    # Create zip file
    try:
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for root, dirs, zip_files in os.walk(temp_dir):
                for f in zip_files:
                    abs_path = os.path.join(root, f)
                    arc_name = os.path.join("temp", os.path.relpath(abs_path, temp_dir))
                    zf.write(abs_path, arc_name)
    except Exception as exc:
        return jsonify({"error": f"Failed to create zip: {str(exc)}"}), 500

    # Clean up temp folder (keep zip for download)
    shutil.rmtree(temp_dir, ignore_errors=True)

    if not os.path.isfile(zip_path):
        return jsonify({"error": "Failed to create zip file"}), 500

    return send_file(zip_path, as_attachment=True, download_name="temp.zip")


# ---------------------------------------------------------------------------
# Bingo Machine Statistic Analysis
# ---------------------------------------------------------------------------

def _parse_last_block(content: str) -> dict:
    """Parse the LAST QUANTITY block from a simulator result .txt file.

    The file may contain multiple blocks (one per checkpoint). Each block
    starts with "QUANTITY:" (possibly preceded by other text on the same
    line if the prior block's last value had no trailing newline — a known
    quirk of some simulator output). We want only the last block's
    key-value data (the final accumulated totals).

    Returns: dict with:
      - field_name_upper -> numeric_value_str (for standard KEY: VALUE lines)
      - "_pattern_count" -> list of (pattern_name, count_value) tuples
    """
    import re

    # Find ALL positions where "QUANTITY:" appears (may not be at line start
    # if the previous block's TOTAL SPENT line had no trailing newline).
    positions = [m.start() for m in re.finditer(r"QUANTITY\s*:", content)]
    if not positions:
        return {}

    # Take everything from the LAST "QUANTITY:" occurrence to end of file
    last_block = content[positions[-1]:]

    # Parse all KEY: VALUE lines
    result = {}
    for line in last_block.splitlines():
        line = line.strip()
        m = re.match(
            r"^([A-Z][A-Z0-9_ ]*?)\s*[:]\s*([\d.]+)$", line
        )
        if m:
            key = m.group(1).strip()
            val = m.group(2).strip()
            result[key] = val

    # Also check for KEY:VALUE that might be on a line with other preceding
    # text (e.g. "...6456770QUANTITY: 20" on a single line — we already
    # sliced from "QUANTITY:" so this is handled). But trailing values like
    # TOTAL WON may appear on lines after "card,winning,count" — since we
    # iterate all lines in last_block, they're captured.

    # Parse "pattern   count" section
    pattern_counts = []
    in_pattern_count = False
    for line in last_block.splitlines():
        stripped = line.strip()
        if re.match(r"^pattern\s+count", stripped, re.IGNORECASE):
            in_pattern_count = True
            continue
        if in_pattern_count:
            if re.match(r"^pattern\s+hit", stripped, re.IGNORECASE) or re.match(r"^time:", stripped):
                in_pattern_count = False
                continue
            # Format 1 (Bingo): each line is "name,      count,"
            m_pc = re.match(r"^(.+?),\s+([\d.]+),\s*$", stripped)
            if m_pc:
                pattern_counts.append((m_pc.group(1).strip(), m_pc.group(2).strip()))
                continue
            # Format 2 (Slot): all on one line, semicolon-separated
            # "3COW:114912.0000000;5DONKEY:2582.0000000;..."
            if ":" in stripped and ";" in stripped:
                for part in stripped.split(";"):
                    part = part.strip()
                    if not part:
                        continue
                    m_slot = re.match(r"^(.+?):([\d.]+)$", part)
                    if m_slot:
                        pattern_counts.append((m_slot.group(1).strip(), m_slot.group(2).strip()))

    if pattern_counts:
        result["_pattern_count"] = pattern_counts

    return result


def _extract_sim_folder(filepath: str) -> str:
    """Extract the SimC* folder name from a full file path.

    E.g. ".../ShowBingoSim/SimC1/math/..." -> "SimC1"
         ".../temp/SimC2/math/..." -> "SimC2"
         ".../temp/SimC1LB/math/..." -> "SimC1LB"
         ".../temp/SimC10/math/..." -> "SimC10"
    """
    import re
    # Normalize to forward slashes for consistent matching
    fp = filepath.replace("\\", "/")
    m = re.search(r"/(SimC\d+[A-Za-z]*)/", fp)
    return m.group(1) if m else "unknown"


def _extract_base_name(filepath: str) -> str:
    """Extract the base filename without timestamp suffix.

    E.g. "CalacaBingo_96_medium_vi_2026.08.24_16.15.24.txt"
      -> "CalacaBingo_96_medium_vi"

    The convention is: <game_name>_<date>_<time>.txt where date is
    YYYY.MM.DD and time is HH.MM.SS — so we strip the last two
    underscore-separated segments that look like dates/times + extension.
    """
    import re
    name = filepath.replace("\\", "/").rsplit("/", 1)[-1]  # basename
    # Remove .txt extension
    if name.lower().endswith(".txt"):
        name = name[:-4]
    # Strip trailing _YYYY.MM.DD_HH.MM.SS pattern
    name = re.sub(r"_\d{4}\.\d{2}\.\d{2}_\d{2}\.\d{2}\.\d{2}$", "", name)
    return name


def _group_key(filepath: str) -> str:
    """Build a grouping key: normalized SimCX + base_name (without timestamp).

    Files with the same group key across nodes should be merged.
    SimC1 and SimC1LB are treated as the same instance (normalized to SimC1).
    """
    import re
    sim_folder = _extract_sim_folder(filepath)
    # Normalize: strip trailing letters after digits so SimC1LB -> SimC1
    m = re.match(r"^(SimC\d+)", sim_folder)
    normalized = m.group(1) if m else sim_folder
    return normalized + "/" + _extract_base_name(filepath)


@files_bp.route("/statistic-analysis/config", methods=["GET"])
def statistic_analysis_config():
    """Return the configured statistic fields for each game type."""
    raw = _raw_config.get("statistic_analysis", {})
    return jsonify({"bingo": raw.get("bingo", []), "slot": raw.get("slot", [])})


@files_bp.route("/statistic-analysis/merge", methods=["POST"])
def statistic_analysis_merge():
    """Merge statistics from multiple simulator result files across nodes.

    Request body: {
        "game_type": "bingo" | "slot",
        "per_node_files": {"master": [...], "ip:port": [...]},
        "addrs": ["master", "ip:port", ...]
    }

    The endpoint:
      1. Reads each selected file's content (local or via worker proxy)
      2. Parses the LAST QUANTITY block from each file
      3. Groups files by (SimC folder + base name without timestamp)
      4. For each group, sums the configured numeric fields
      5. Returns the merged results + source file info per group
    """
    data = request.get_json(force=True)
    game_type = data.get("game_type", "").strip().lower()
    per_node_files = data.get("per_node_files", {})
    addrs = data.get("addrs", [])

    sa_config = _raw_config.get("statistic_analysis", {})
    fields = sa_config.get(game_type, [])
    if not fields:
        return jsonify({"error": f"No statistic fields configured for game type: {game_type}"}), 400
    if not per_node_files or not any(per_node_files.values()):
        return jsonify({"error": "No files provided"}), 400

    # Step 1 & 2: Read and parse each file
    # Structure: {group_key: [{parsed_data, source_file, addr}, ...]}
    groups: dict[str, list] = {}
    errors = []

    for raw_addr in addrs:
        addr = (raw_addr or "master").strip() or "master"
        files = per_node_files.get(addr) or per_node_files.get(raw_addr) or []
        for filepath in files:
            # Read file content
            content = None
            if _is_remote_addr(addr):
                try:
                    r = _worker_session.get(
                        f"http://{addr}/files/read",
                        params={"path": filepath, "full": "1"},
                        timeout=30,
                    )
                    if r.ok:
                        rdata = r.json()
                        content = rdata.get("content", "")
                    else:
                        try:
                            err_msg = r.json().get("error", f"status {r.status_code}")
                        except Exception:
                            err_msg = f"status {r.status_code}"
                        errors.append(f"{addr}: {filepath} - {err_msg}")
                        continue
                except http_requests.RequestException as exc:
                    errors.append(f"{addr}: {filepath} - {exc}")
                    continue
            else:
                fpath = os.path.normpath(filepath)
                if not os.path.isfile(fpath):
                    errors.append(f"{addr}: {filepath} - file not found")
                    continue
                try:
                    with open(fpath, "r", encoding="utf-8", errors="replace") as f:
                        content = f.read()
                except Exception as exc:
                    errors.append(f"{addr}: {filepath} - {exc}")
                    continue

            parsed = _parse_last_block(content)
            if not parsed:
                errors.append(f"{addr}: {filepath} - no QUANTITY block found")
                continue

            key = _group_key(filepath)
            if key not in groups:
                groups[key] = []
            groups[key].append({
                "data": parsed,
                "source": filepath,
                "addr": addr,
            })

    # Step 3 & 4: Merge each group
    include_pattern_count = sa_config.get("pattern_count", False)
    # Fields that should NOT be summed — just take the value from the first
    # file (e.g. QUANTITY is always the same across files in a group, summing
    # it would double/triple it incorrectly).
    no_sum_fields = set(
        f.upper() for f in sa_config.get("no_sum", [])
    )
    merged_results = []
    for key in sorted(groups.keys()):
        entries = groups[key]
        merged = {}
        for field in fields:
            field_upper = field.upper()
            if field_upper in no_sum_fields:
                # Take value from the first entry that has it (not summed)
                val = None
                for entry in entries:
                    val_str = entry["data"].get(field_upper)
                    if val_str is not None:
                        try:
                            v = float(val_str)
                            val = int(v) if v == int(v) else round(v, 7)
                        except ValueError:
                            pass
                        break
                merged[field] = val
            else:
                total = 0.0
                found_any = False
                for entry in entries:
                    val_str = entry["data"].get(field_upper)
                    if val_str is not None:
                        try:
                            total += float(val_str)
                            found_any = True
                        except ValueError:
                            pass
                if found_any:
                    # Keep as int if no decimal part
                    merged[field] = int(total) if total == int(total) else round(total, 7)
                else:
                    merged[field] = None

        # Merge pattern counts (sum same pattern names across files)
        merged_patterns = None
        if include_pattern_count:
            pattern_totals = {}  # {pattern_name: total_count}
            pattern_order = []   # preserve first-seen order
            for entry in entries:
                pc_list = entry["data"].get("_pattern_count", [])
                for pname, pval in pc_list:
                    try:
                        val = float(pval)
                    except ValueError:
                        continue
                    if pname not in pattern_totals:
                        pattern_totals[pname] = 0.0
                        pattern_order.append(pname)
                    pattern_totals[pname] += val
            if pattern_totals:
                merged_patterns = [
                    {"pattern": p, "count": int(pattern_totals[p]) if pattern_totals[p] == int(pattern_totals[p]) else pattern_totals[p]}
                    for p in pattern_order
                ]

        sources = [{"file": e["source"], "addr": e["addr"]} for e in entries]
        result_entry = {
            "group": key,
            "sim_folder": _extract_sim_folder(entries[0]["source"]),
            "base_name": _extract_base_name(entries[0]["source"]),
            "merged": merged,
            "sources": sources,
            "file_count": len(entries),
        }
        if merged_patterns is not None:
            result_entry["pattern_count"] = merged_patterns
        merged_results.append(result_entry)

    return jsonify({
        "status": "ok",
        "game_type": game_type,
        "fields": fields,
        "include_pattern_count": include_pattern_count,
        "results": merged_results,
        "errors": errors,
    })


@files_bp.route("/files/local/download", methods=["GET"])
def local_download():
    """Download a local file."""
    from flask import send_file
    file_path = request.args.get("path", "")
    full_path = os.path.normpath(file_path)
    if not os.path.isfile(full_path):
        return jsonify({"error": "File not found"}), 404
    return send_file(full_path, as_attachment=True)


@files_bp.route("/files/worker/download", methods=["GET"])
def worker_download():
    """Download a file from a remote worker (proxy)."""
    addr = request.args.get("addr", "")
    file_path = request.args.get("path", "")
    if not addr or not file_path:
        return jsonify({"error": "addr and path are required"}), 400
    try:
        # Try /files/download first (new endpoint)
        r = _worker_session.get(f"http://{addr}/files/download", params={"path": file_path}, timeout=30, stream=True)
        if r.status_code == 200:
            from flask import Response
            filename = os.path.basename(file_path)
            headers = {"Content-Disposition": f"attachment; filename={filename}"}
            if r.headers.get("Content-Type"):
                headers["Content-Type"] = r.headers["Content-Type"]
            return Response(r.iter_content(chunk_size=8192), headers=headers)
        # Fallback: use /files/read for text files (older workers)
        r2 = _worker_session.get(f"http://{addr}/files/read", params={"path": file_path}, timeout=30)
        if r2.status_code == 200:
            data = r2.json()
            content = data.get("content", "")
            from flask import Response
            filename = os.path.basename(file_path)
            return Response(
                content.encode("utf-8"),
                headers={
                    "Content-Disposition": f"attachment; filename={filename}",
                    "Content-Type": "application/octet-stream",
                }
            )
        return jsonify({"error": f"Worker returned {r.status_code}"}), r.status_code
    except http_requests.RequestException as exc:
        return jsonify({"error": str(exc)}), 500


@files_bp.route("/files/local/read", methods=["GET"])
def local_read():
    """Read a local file content for preview or transfer.

    Query param: ?path=absolute/path&preview=1 (preview returns JSON with content)
    """
    from flask import send_file
    file_path = request.args.get("path", "")
    preview = request.args.get("preview", "")
    full_path = os.path.normpath(file_path)
    if not os.path.isfile(full_path):
        return jsonify({"error": "File not found"}), 404
    if preview:
        try:
            with open(full_path, "r", encoding="utf-8") as f:
                content = f.read(100000)
            return jsonify({"path": file_path, "content": content, "size": os.path.getsize(full_path)})
        except Exception as exc:
            return jsonify({"error": str(exc)}), 500
    return send_file(full_path, as_attachment=True)


@files_bp.route("/files/production-dir", methods=["GET"])
def files_production_dir():
    """Return a single node's resolved production_dir path.

    Used by the Batch Upload/Override/Download File "multi-node" panels to
    auto-fill Target Directories with each selected node's production_dir
    root -- nodes share an identical subdirectory structure BELOW that
    root, but the root itself (drive letter on Windows, or an entirely
    different path on Linux workers) differs per node, so it cannot be
    hardcoded on the frontend.

    Query param: ?addr=master | ip:port

    Returns: {"addr": ..., "production_dir": "..."}  or  {"error": "..."}
    """
    addr = request.args.get("addr", "master").strip() or "master"

    if not _is_remote_addr(addr):
        prod_dir = _config.production_dir
        if not prod_dir:
            return jsonify({"error": "production_dir not configured for master"}), 400
        return jsonify({"addr": addr, "production_dir": prod_dir.replace("\\", "/")})

    # Remote worker: reuse its /files/browse with an empty path, which
    # resolves to (and returns) the worker's own PRODUCTION_DIR without
    # requiring a dedicated endpoint on the worker side.
    try:
        r = _worker_session.get(
            f"http://{addr}/files/browse", params={"path": ""}, timeout=10
        )
        try:
            data = r.json()
        except ValueError:
            return jsonify({"error": f"Worker returned non-JSON (status {r.status_code})"}), 500
        if not r.ok:
            return jsonify(data), r.status_code
        prod_dir = data.get("path", "")
        if not prod_dir:
            return jsonify({"error": "Worker did not return a production_dir path"}), 500
        return jsonify({"addr": addr, "production_dir": prod_dir})
    except http_requests.RequestException as exc:
        return jsonify({"error": str(exc)}), 500


@files_bp.route("/files/worker/browse", methods=["GET"])
def worker_browse():
    """Proxy: browse a worker's directory (absolute path).

    Query params: ?addr=ip:port&path=absolute/path (empty = worker's production_dir)
    """
    addr = request.args.get("addr", "")
    browse_path = request.args.get("path", "")
    if not addr:
        return jsonify({"error": "addr required"}), 400
    try:
        r = _worker_session.get(
            f"http://{addr}/files/browse",
            params={"path": browse_path}, timeout=10
        )
        try:
            data = r.json()
        except ValueError:
            return jsonify({"error": f"Worker returned non-JSON (status {r.status_code})"}), 500
        return jsonify(data), r.status_code
    except http_requests.RequestException as exc:
        return jsonify({"error": str(exc)}), 500


@files_bp.route("/files/master/upload", methods=["POST"])
def master_upload():
    """Upload a file from the browser to the master filesystem.

    Form data: target_dir (absolute path on master)
    File: file (multipart file upload)
    """
    target_dir = request.form.get("target_dir", "")
    if not target_dir:
        return jsonify({"error": "target_dir required"}), 400

    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400

    uploaded = request.files["file"]
    if not uploaded.filename:
        return jsonify({"error": "Empty filename"}), 400

    # Ensure target directory exists
    os.makedirs(target_dir, exist_ok=True)
    dest_path = os.path.join(target_dir, uploaded.filename)
    try:
        uploaded.save(dest_path)
        return jsonify({"status": "ok", "path": dest_path})
    except OSError as exc:
        return jsonify({"error": str(exc)}), 500


@files_bp.route("/files/remote/upload-browser", methods=["POST"])
def remote_upload_browser():
    """Upload a file from the browser to a remote worker.

    Form data: addr, target_dir (absolute path on worker)
    File: file (multipart file upload)
    """
    addr = request.form.get("addr", "")
    target_dir = request.form.get("target_dir", "")

    if not addr:
        return jsonify({"error": "addr required"}), 400

    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400

    uploaded = request.files["file"]
    if not uploaded.filename:
        return jsonify({"error": "Empty filename"}), 400

    try:
        files = {"file": (uploaded.filename, uploaded.stream,
                          uploaded.content_type)}
        r = _worker_session.post(
            f"http://{addr}/files/upload",
            data={"path": target_dir},
            files=files,
            timeout=60,
        )
        return jsonify(r.json()), r.status_code
    except http_requests.RequestException as exc:
        return jsonify({"error": str(exc)}), 500


@files_bp.route("/files/worker/upload", methods=["POST"])
def worker_upload():
    """Upload a local file to a worker.

    Form data: addr, rel_dir (target dir on worker), local_path (absolute path on master)
    """
    addr = request.form.get("addr", "")
    rel_dir = request.form.get("rel_dir", "")
    local_path = request.form.get("local_path", "")

    if not addr or not local_path:
        return jsonify({"error": "addr and local_path required"}), 400

    full_local = os.path.normpath(local_path)
    if not os.path.isfile(full_local):
        return jsonify({"error": "Local file not found"}), 404

    try:
        with open(full_local, "rb") as f:
            files = {"file": (os.path.basename(full_local), f)}
            r = _worker_session.post(
                f"http://{addr}/files/upload",
                data={"path": rel_dir},
                files=files,
                timeout=120,
            )
        return jsonify(r.json()), r.status_code
    except http_requests.RequestException as exc:
        return jsonify({"error": str(exc)}), 500


@files_bp.route("/files/worker/read", methods=["GET"])
def worker_read():
    """Proxy: read a file on a worker for preview.

    Query params: ?addr=ip:port&path=absolute/path
    """
    addr = request.args.get("addr", "")
    file_path = request.args.get("path", "")
    if not addr or not file_path:
        return jsonify({"error": "addr and path required"}), 400
    try:
        r = _worker_session.get(
            f"http://{addr}/files/read",
            params={"path": file_path}, timeout=10
        )
        try:
            return jsonify(r.json()), r.status_code
        except ValueError:
            return jsonify({"error": "Worker returned non-JSON"}), 500
    except http_requests.RequestException as exc:
        return jsonify({"error": str(exc)}), 500


@files_bp.route("/files/worker/write", methods=["POST"])
def worker_write():
    """Proxy: write file content on a worker.

    Request body: {"addr": "ip:port", "path": "absolute/path", "content": "..."}
    """
    data = request.get_json(force=True)
    addr = data.get("addr", "")
    file_path = data.get("path", "")
    content = data.get("content", "")
    if not addr or not file_path:
        return jsonify({"error": "addr and path required"}), 400
    try:
        r = _worker_session.post(
            f"http://{addr}/files/write",
            json={"path": file_path, "content": content},
            timeout=10,
        )
        return jsonify(r.json()), r.status_code
    except http_requests.RequestException as exc:
        return jsonify({"error": str(exc)}), 500


@files_bp.route("/files/worker/delete", methods=["POST"])
def worker_delete():
    """Proxy: delete files on a worker.

    Request body: {"addr": "ip:port", "paths": ["abs/path1", ...]}
    """
    data = request.get_json(force=True)
    addr = data.get("addr", "")
    paths = data.get("paths", [])
    if not addr or not paths:
        return jsonify({"error": "addr and paths required"}), 400
    try:
        r = _worker_session.post(
            f"http://{addr}/files/delete",
            json={"paths": paths},
            timeout=10,
        )
        return jsonify(r.json()), r.status_code
    except http_requests.RequestException as exc:
        return jsonify({"error": str(exc)}), 500


@files_bp.route("/sha1/history", methods=["GET"])
def sha1_history():
    """List all saved SHA1 computation results."""
    import json as jm
    sha1_dir = os.path.join(_base_dir, "sha1")
    if not os.path.isdir(sha1_dir):
        return jsonify({"records": []})
    records = []
    for fname in sorted(os.listdir(sha1_dir), reverse=True):
        if not fname.endswith('.json'):
            continue
        fpath = os.path.join(sha1_dir, fname)
        try:
            with open(fpath, "r", encoding="utf-8") as f:
                data = jm.load(f)
            # Extract timestamp from filename: sha1_YYYYMMDD_HHMMSS.json
            ts_part = fname.replace("sha1_", "").replace(".json", "")
            records.append({
                "filename": fname,
                "directory": data.get("directory", ""),
                "timestamp": ts_part,
                "file_count": len(data.get("results", [])),
            })
        except Exception:
            continue
    return jsonify({"records": records})


@files_bp.route("/sha1/load", methods=["GET"])
def sha1_load():
    """Load a specific SHA1 result file.

    Query param: ?filename=sha1_20260518_063456.json
    """
    import json as jm
    filename = request.args.get("filename", "")
    sha1_dir = os.path.join(_base_dir, "sha1")
    fpath = os.path.join(sha1_dir, filename)
    if not os.path.isfile(fpath):
        return jsonify({"error": "File not found"}), 404
    with open(fpath, "r", encoding="utf-8") as f:
        return jsonify(jm.load(f))


@files_bp.route("/sha1/compute", methods=["POST"])
def sha1_compute():
    """Compute SHA1 for all JSON files in a directory, or extract SHA1 from a PDF.

    Request body: {"path": "absolute/path/to/directory_or_pdf"}
    If path points to a .pdf file, extract SHA1 entries from the PDF content.
    Returns: {"results": [{"filename": str, "sha1": str}], "saved_to": str, "source": "directory"|"pdf"}
    """
    import hashlib as hl
    data = request.get_json(force=True)
    dir_path = data.get("path", "").strip()

    if not dir_path:
        return jsonify({"error": "Path is required"}), 400

    # Remove invisible Unicode characters (e.g. \u202a, \u200b from copy-paste)
    import re as _re
    dir_path = _re.sub(r'[\u200b\u200c\u200d\u200e\u200f\u202a\u202b\u202c\u202d\u202e\ufeff\u2060\u2061\u2062\u2063\u2064\u2066\u2067\u2068\u2069\u00a0]', '', dir_path)
    dir_path = dir_path.strip()

    # Normalize path for Windows compatibility
    dir_path = os.path.normpath(dir_path)

    # Check if path is a PDF file
    if dir_path.lower().endswith('.pdf'):
        if os.path.isfile(dir_path):
            return _compute_sha1_from_pdf(dir_path)
        else:
            return jsonify({"error": f"PDF file not found: {dir_path}"}), 404

    if not os.path.isdir(dir_path):
        return jsonify({"error": f"Directory not found: {dir_path}"}), 404

    results = []
    for root, dirs, files in os.walk(dir_path):
        dirs.sort()
        for fname in sorted(files):
            if not fname.lower().endswith('.json'):
                continue
            fpath = os.path.join(root, fname)
            rel_dir = os.path.relpath(root, dir_path)
            if rel_dir == '.':
                rel_dir = ''
            sha1 = hl.sha1(open(fpath, 'rb').read()).hexdigest().upper()
            results.append({"filename": fname, "subdir": rel_dir.replace("\\", "/"), "sha1": sha1})

    # Save results
    sha1_dir = os.path.join(_base_dir, "sha1")
    os.makedirs(sha1_dir, exist_ok=True)
    from datetime import datetime, timezone
    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    save_name = f"sha1_{ts}.json"
    save_path = os.path.join(sha1_dir, save_name)
    import json as jm
    with open(save_path, "w", encoding="utf-8") as f:
        jm.dump({"directory": dir_path, "results": results}, f, indent=2)

    return jsonify({"results": results, "saved_to": save_name, "source": "directory"})


def _compute_sha1_from_pdf(pdf_path: str):
    """Extract SHA1 entries from a PDF file.

    Looks for lines matching pattern: filename.json,SHA-1,<hex_hash>
    """
    import json as jm
    from datetime import datetime, timezone

    try:
        import pypdf
    except ImportError:
        try:
            import PyPDF2 as pypdf
        except ImportError:
            return jsonify({"error": "PDF library not installed. Please install pypdf: pip install pypdf"}), 500

    try:
        text = ""
        with open(pdf_path, "rb") as f:
            reader = pypdf.PdfReader(f)
            for page in reader.pages:
                page_text = page.extract_text()
                if page_text:
                    text += page_text + "\n"
    except Exception as exc:
        return jsonify({"error": f"Failed to read PDF: {exc}"}), 500

    # Parse SHA1 entries from PDF text
    # PDF contains a table with columns: File Name, Version, Location, Function, Digital Signature Type, Digital Signature
    # After text extraction, columns may be separated by spaces, tabs, or other whitespace
    import re
    results = []

    # Pattern 1: filename.json/jar followed by SHA-1 and a 40-char hex string
    # Handles comma-separated: filename.json,SHA-1,HEXHASH
    # Handles space-separated (from table extraction): filename.json ... SHA-1 ... HEXHASH
    pattern = re.compile(
        r'([A-Za-z0-9_\-\.]+\.(?:json|jar))\s*[,\s]\s*(?:N/A|v[\d\.]+)?\s*[,\s]\s*(?:Server|Client)?\s*[,\s]\s*(?:Game\s*(?:Configuration|Logic))?\s*[,\s]\s*SHA-?1\s*[,\s]\s*([0-9A-Fa-f]{40})',
        re.IGNORECASE
    )
    for match in pattern.finditer(text):
        filename = match.group(1)
        sha1_hash = match.group(2).upper()
        results.append({"filename": filename, "sha1": sha1_hash})

    # If pattern 1 didn't match, try a simpler pattern
    if not results:
        # Simpler: just find filename followed eventually by SHA-1 and hex hash on same line or nearby
        pattern2 = re.compile(
            r'([A-Za-z0-9_\-\.]+\.(?:json|jar))\b.*?SHA-?1\s*[,\s]*([0-9A-Fa-f]{40})',
            re.IGNORECASE
        )
        for match in pattern2.finditer(text):
            filename = match.group(1)
            sha1_hash = match.group(2).upper()
            results.append({"filename": filename, "sha1": sha1_hash})

    # If still no results, try finding SHA-1 hash near filenames across lines
    if not results:
        # Find all filenames and all hashes, then pair them by order
        filenames = re.findall(r'([A-Za-z0-9_\-\.]+\.(?:json|jar))\b', text)
        hashes = re.findall(r'\b([0-9A-Fa-f]{40})\b', text)
        if filenames and hashes and len(filenames) == len(hashes):
            for fname, h in zip(filenames, hashes):
                results.append({"filename": fname, "sha1": h.upper()})

    if not results:
        # Return extracted text snippet for debugging
        text_preview = text[:500].replace('\n', '\\n') if text else "(empty)"
        return jsonify({"error": f"No SHA1 entries found in PDF. Extracted text preview: {text_preview}"}), 400

    # Save results
    sha1_dir = os.path.join(_base_dir, "sha1")
    os.makedirs(sha1_dir, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    save_name = f"sha1_{ts}.json"
    save_path = os.path.join(sha1_dir, save_name)
    with open(save_path, "w", encoding="utf-8") as f:
        jm.dump({"directory": pdf_path, "results": results}, f, indent=2)

    return jsonify({"results": results, "saved_to": save_name, "source": "pdf"})


@files_bp.route("/family/images", methods=["GET"])
def family_images():
    """List all images in static/family directory."""
    family_dir = os.path.join(current_app.static_folder, "family")
    if not os.path.isdir(family_dir):
        return jsonify({"images": []})
    images = [f for f in os.listdir(family_dir)
              if f.lower().endswith(('.png', '.jpg', '.jpeg', '.gif', '.webp'))]
    return jsonify({"images": images})


@files_bp.route("/history/page")
def history_page():
    """Render the history replay page."""
    return render_template("history.html")


