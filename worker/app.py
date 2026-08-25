"""Worker Flask 应用与路由。

提供 POST /start、GET /status、POST /stop、GET /logs 端点，
用于接收模拟任务、查询运行状态、停止任务和获取日志。
"""

import json
import os
import sys

# PyInstaller 打包后 exe 所在目录，开发时用 __file__ 所在目录
if getattr(sys, 'frozen', False):
    _base_dir = os.path.dirname(sys.executable)
    # 把 PyInstaller 临时解压目录加到 sys.path，以便导入本地模块
    sys.path.insert(0, sys._MEIPASS)
else:
    _base_dir = os.path.dirname(__file__)

from flask import Flask, jsonify, request

from simulator_runner import SimulatorRunner

app = Flask(__name__)

# PyInstaller 打包后 exe 所在目录，开发时用 __file__ 所在目录
if getattr(sys, 'frozen', False):
    _base_dir = os.path.dirname(sys.executable)
else:
    _base_dir = os.path.dirname(__file__)

# 优先读取 exe 同级目录下的 config.json
_config_path = os.path.join(_base_dir, "config.json")
_config = {}
if os.path.exists(_config_path):
    with open(_config_path, "r", encoding="utf-8") as _f:
        _config = json.load(_f)

SIMULATOR_DIR = os.environ.get("SIMULATOR_DIR", _config.get("simulator_dir", ""))
PRODUCTION_DIR = os.environ.get("PRODUCTION_DIR", _config.get("production_dir", ""))
PORT = int(os.environ.get("PORT", _config.get("port", 5001)))

runner = SimulatorRunner(SIMULATOR_DIR, PRODUCTION_DIR)


@app.route("/start", methods=["POST"])
def start():
    """启动模拟任务。

    请求体: {"spins": int, "job_id": str}
    成功: 200 {"status": "started", "message": "..."}
    冲突: 409 {"error": "Task already running", "job_id": "..."}
    失败: 500 {"error": "Failed to start simulator", "detail": "..."}
    """
    data = request.get_json(force=True)
    spins = data.get("spins")
    job_id = data.get("job_id")
    game_name = data.get("game_name", "")
    interval_count = data.get("interval_count")
    sim_type = data.get("sim_type", "production")
    override_spin_settings = data.get("override_spin_settings", True)
    if not isinstance(override_spin_settings, bool):
        return jsonify({"error": "override_spin_settings must be a boolean"}), 400

    try:
        started = runner.start(
            spins,
            job_id,
            game_name,
            interval_count,
            sim_type,
            override_spin_settings,
        )
    except RuntimeError as exc:
        return jsonify({
            "error": "Failed to start simulator",
            "detail": str(exc),
        }), 500

    if not started:
        return jsonify({
            "error": "Task already running",
            "job_id": job_id,
        }), 409

    return jsonify({
        "status": "started",
        "message": f"Job {job_id} started with {spins} spins",
    })


@app.route("/status", methods=["GET"])
def status():
    """查询运行状态。"""
    return jsonify(runner.get_status())


@app.route("/stop", methods=["POST"])
def stop():
    """停止正在运行的模拟器。"""
    stopped = runner.stop()
    if stopped:
        return jsonify({"status": "stopped", "message": "Simulator stopped"})
    return jsonify({"status": "error", "message": "No running task to stop"}), 400


@app.route("/logs", methods=["GET"])
def logs():
    """获取模拟器输出日志。"""
    since = request.args.get("since", 0, type=int)
    return jsonify(runner.get_logs(since))


@app.route("/files/browse", methods=["GET"])
def browse_files():
    """Browse directory contents on this worker.

    Query param: ?path=absolute/path (defaults to production_dir)
    Special: ?path=__drives__ lists all drive letters (Windows)
    """
    import platform as _plat
    browse_path = request.args.get("path", "")

    # List all drives (Windows)
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

    if not browse_path or browse_path == "default":
        browse_path = PRODUCTION_DIR
    if not browse_path:
        return jsonify({"error": "production_dir not configured in worker config.json"}), 400
    if not os.path.isdir(browse_path):
        return jsonify({"error": f"Directory not found: {browse_path}"}), 404

    full_path = os.path.normpath(browse_path)
    parent = os.path.dirname(full_path)
    if parent == full_path:
        parent = "__drives__" if _plat.system() == "Windows" else ""
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


@app.route("/files/upload", methods=["POST"])
def upload_file():
    """Upload a file to a specific absolute path on this worker.

    Form data:
      - file: the file content
      - path: absolute directory path to save into
    """
    target_dir = request.form.get("path", "")
    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400

    if not target_dir:
        target_dir = PRODUCTION_DIR
    target_dir = os.path.normpath(target_dir)

    f = request.files["file"]
    os.makedirs(target_dir, exist_ok=True)
    target_path = os.path.join(target_dir, f.filename)
    f.save(target_path)
    return jsonify({"status": "ok", "path": target_path.replace("\\", "/")})


@app.route("/files/download", methods=["GET"])
def download_file():
    """Download a file from this worker.

    Query param: ?path=absolute/path
    """
    from flask import send_file
    file_path = request.args.get("path", "")
    full = os.path.normpath(file_path)
    if not os.path.isfile(full):
        return jsonify({"error": "File not found"}), 404
    return send_file(full, as_attachment=True)


@app.route("/files/read", methods=["GET"])
def read_file():
    """Read file content for preview.

    Query param: ?path=absolute/path
    """
    file_path = request.args.get("path", "")
    full = os.path.normpath(file_path)
    if not os.path.isfile(full):
        return jsonify({"error": "File not found"}), 404
    try:
        # full=1 param skips the 100KB preview limit (used by statistic analysis)
        limit = None if request.args.get("full") == "1" else 100000
        with open(full, "r", encoding="utf-8") as f:
            content = f.read() if limit is None else f.read(limit)
        return jsonify({"path": file_path, "content": content, "size": os.path.getsize(full)})
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@app.route("/files/mkdir", methods=["POST"])
def mkdir():
    """Create a directory on this worker.

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


@app.route("/files/write", methods=["POST"])
def write_file():
    """Write content to a file on this worker.

    Request body: {"path": "absolute/path", "content": "file content"}
    """
    data = request.get_json(force=True)
    file_path = data.get("path", "")
    content = data.get("content", "")
    full = os.path.normpath(file_path)
    try:
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "w", encoding="utf-8") as f:
            f.write(content)
        return jsonify({"status": "ok", "path": file_path})
    except OSError as exc:
        return jsonify({"error": str(exc)}), 500


@app.route("/files/delete", methods=["POST"])
def delete_files():
    """Delete files or directories on this worker.

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


@app.route("/files/rename", methods=["POST"])
def rename_file():
    """Rename a file or directory on this worker.

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


@app.route("/files/duplicate", methods=["POST"])
def duplicate_file():
    """Duplicate (copy) a file or directory on this worker.

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


@app.route("/files/batch-search", methods=["POST"])
def batch_search():
    """Generic recursive file/directory search used by master's batch plugins.

    Request body: {
        "mode": "exact" | "glob" | "dir_glob",
        "names": ["file1.txt", "file2.jar"],   # mode=exact: match any of these basenames
        "pattern": "CalacaBingo*.txt",          # mode=glob: fnmatch pattern on basename
        "dir_patterns": ["E:/path/*/lib"],      # mode=dir_glob: glob pattern(s) on full dir path
        "target_dirs": ["dir1", "dir2"],        # required for exact/glob modes
        "exclude_dirs": ["ex1"]                 # optional, applies to exact/glob modes
    }
    """
    import fnmatch
    import glob as glob_mod

    data = request.get_json(force=True)
    mode = data.get("mode", "exact")
    names = set(data.get("names", []) or [])
    pattern = data.get("pattern", "").strip()
    dir_patterns = data.get("dir_patterns", [])
    target_dirs = data.get("target_dirs", [])
    exclude_dirs = data.get("exclude_dirs", [])

    found = []

    if mode == "dir_glob":
        if not dir_patterns:
            return jsonify({"error": "dir_patterns is required for mode=dir_glob"}), 400
        exclude_normalized = [os.path.normpath(d.strip()).lower() for d in exclude_dirs if d.strip()]
        for dp in dir_patterns:
            dp = dp.strip()
            matched_dirs = glob_mod.glob(dp) if ("*" in dp or "?" in dp) else [dp]
            for d in matched_dirs:
                d_norm = os.path.normpath(d)
                if not os.path.isdir(d_norm):
                    continue
                d_lower = d_norm.lower()
                skip = False
                for ex in exclude_normalized:
                    if d_lower == ex or d_lower.startswith(ex + os.sep):
                        skip = True
                        break
                if skip:
                    continue
                found.append(d_norm.replace("\\", "/"))
        found = sorted(set(found))
        return jsonify({"status": "ok", "found": found, "count": len(found)})

    # mode == "exact" or "glob": recursive file search under target_dirs
    if not target_dirs:
        return jsonify({"error": "target_dirs is required"}), 400
    if mode == "exact" and not names:
        return jsonify({"error": "names is required for mode=exact"}), 400
    if mode == "glob" and not pattern:
        return jsonify({"error": "pattern is required for mode=glob"}), 400

    exclude_normalized = [os.path.normpath(d.strip()).lower() for d in exclude_dirs if d.strip()]

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
                if mode == "exact":
                    if f in names:
                        found.append(os.path.join(root, f).replace("\\", "/"))
                elif mode == "glob":
                    if fnmatch.fnmatch(f, pattern):
                        found.append(os.path.join(root, f).replace("\\", "/"))

    return jsonify({"status": "ok", "found": found, "count": len(found)})


@app.route("/files/batch-override", methods=["POST"])
def batch_override_worker():
    """Recursively find and replace files matching source filename(s), on this worker.

    Request body: {"sources": ["path1", ...], "target_dirs": ["dir1"], "exclude_dirs": ["ex1"]}
    """
    import shutil
    data = request.get_json(force=True)
    sources = data.get("sources", [])
    target_dirs = data.get("target_dirs", [])
    exclude_dirs = data.get("exclude_dirs", [])

    if not sources:
        return jsonify({"error": "source file path is required"}), 400
    if not target_dirs:
        return jsonify({"error": "at least one target directory is required"}), 400

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
        return jsonify({"error": error_msg}), 400

    exclude_normalized = [os.path.normpath(d.strip()).lower() for d in exclude_dirs if d.strip()]
    replaced = []
    errors = list(source_errors)

    for td in target_dirs:
        td = os.path.normpath(td.strip())
        if not os.path.isdir(td):
            errors.append(f"Directory not found: {td}")
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
                if f in source_map:
                    target_path = os.path.join(root, f)
                    if os.path.normpath(target_path) == source_map[f]:
                        continue
                    try:
                        shutil.copy2(source_map[f], target_path)
                        replaced.append(target_path.replace("\\", "/"))
                    except Exception as exc:
                        errors.append(f"{target_path.replace(chr(92), '/')} - {str(exc)}")

    return jsonify({"status": "ok", "replaced": replaced, "errors": errors, "count": len(replaced)})


@app.route("/files/batch-delete-files", methods=["POST"])
def batch_delete_files_worker():
    """Delete a list of files on this worker.

    Request body: {"files": ["/full/path/to/file1", ...]}
    """
    data = request.get_json(force=True)
    files = data.get("files", [])

    if not files:
        return jsonify({"error": "no files provided for deletion"}), 400

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


@app.route("/files/batch-edit-apply", methods=["POST"])
def batch_edit_apply_worker():
    """Batch edit .properties files on this worker: update existing keys or append new ones.

    Request body: {
        "filename": "stresstest.properties",
        "contents": ["key=value", ...],
        "target_dirs": ["dir1"],
        "exclude_dirs": []
    }
    """
    data = request.get_json(force=True)
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

    kv_pairs = []
    for item in contents:
        item = item.strip()
        if "=" in item:
            key, value = item.split("=", 1)
            kv_pairs.append((key.strip(), value.strip()))
        else:
            kv_pairs.append((item.strip(), ""))

    if not kv_pairs:
        return jsonify({"error": "no valid key=value pairs found in contents"}), 400

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
            with open(file_path, "r", encoding="utf-8") as fh:
                lines = fh.readlines()

            keys_updated = set()
            new_lines = []

            for line in lines:
                stripped = line.rstrip("\n").rstrip("\r")
                matched = False
                for key, value in kv_pairs:
                    if stripped.startswith(key) and "=" in stripped:
                        line_key = stripped.split("=", 1)[0].strip()
                        if line_key == key:
                            new_lines.append(f"{key}={value}\n")
                            keys_updated.add(key)
                            matched = True
                            break
                if not matched:
                    new_lines.append(line if line.endswith("\n") else line + "\n")

            for key, value in kv_pairs:
                if key not in keys_updated:
                    if new_lines and not new_lines[-1].endswith("\n"):
                        new_lines[-1] += "\n"
                    new_lines.append(f"{key}={value}\n")

            with open(file_path, "w", encoding="utf-8") as fh:
                fh.writelines(new_lines)

            updated.append(file_path.replace("\\", "/"))
        except Exception as exc:
            errors.append(f"{file_path.replace(chr(92), '/')} - {str(exc)}")

    return jsonify({"status": "ok", "updated": updated, "errors": errors, "count": len(updated)})


@app.route("/files/batch-up-upload", methods=["POST"])
def batch_up_upload_worker():
    """Copy source files (already on this worker) to target directories on this worker.

    Request body: {"src_files": ["path1", ...], "target_dirs": ["dir1", ...]}
    """
    import shutil

    data = request.get_json(force=True)
    src_files = data.get("src_files", [])
    target_dirs = data.get("target_dirs", [])

    if not src_files:
        return jsonify({"error": "at least one source file is required"}), 400
    if not target_dirs:
        return jsonify({"error": "at least one target directory is required"}), 400

    copied = []
    errors = []

    for src in src_files:
        src = src.strip()
        if not src:
            continue
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

    return jsonify({"status": "ok", "copied": copied, "errors": errors, "count": len(copied)})


@app.route("/files/batch-dl-download", methods=["POST"])
def batch_dl_download_worker():
    """Create a zip of selected files (on this worker) preserving relative dir structure.

    Request body: {"files": ["/full/path/to/file1", ...], "target_dirs": ["dir1"]}
    """
    import shutil
    import zipfile
    from flask import send_file

    data = request.get_json(force=True)
    files = data.get("files", [])
    target_dirs = data.get("target_dirs", [])

    if not files:
        return jsonify({"error": "no files selected"}), 400
    if not target_dirs:
        return jsonify({"error": "at least one target directory is required"}), 400

    base_dir = os.path.normpath(target_dirs[0].strip())
    if not os.path.isdir(base_dir):
        return jsonify({"error": f"Target directory not found: {base_dir}"}), 404

    temp_dir = os.path.join(base_dir, "temp")
    zip_path = os.path.join(base_dir, "temp.zip")

    if os.path.exists(temp_dir):
        shutil.rmtree(temp_dir)
    if os.path.exists(zip_path):
        os.remove(zip_path)

    os.makedirs(temp_dir, exist_ok=True)

    for file_path in files:
        file_path_norm = os.path.normpath(file_path)
        if not os.path.isfile(file_path_norm):
            continue

        rel_path = None
        for td in target_dirs:
            td_norm = os.path.normpath(td.strip())
            if file_path_norm.lower().startswith(td_norm.lower() + os.sep):
                rel_path = os.path.relpath(file_path_norm, td_norm)
                break
        if rel_path is None:
            rel_path = os.path.basename(file_path_norm)

        dest_path = os.path.join(temp_dir, rel_path)
        dest_dir = os.path.dirname(dest_path)
        os.makedirs(dest_dir, exist_ok=True)
        try:
            shutil.copy2(file_path_norm, dest_path)
        except Exception:
            pass

    try:
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for root, dirs, zip_files in os.walk(temp_dir):
                for f in zip_files:
                    abs_path = os.path.join(root, f)
                    arc_name = os.path.join("temp", os.path.relpath(abs_path, temp_dir))
                    zf.write(abs_path, arc_name)
    except Exception as exc:
        return jsonify({"error": f"Failed to create zip: {str(exc)}"}), 500

    shutil.rmtree(temp_dir, ignore_errors=True)

    if not os.path.isfile(zip_path):
        return jsonify({"error": "Failed to create zip file"}), 500

    return send_file(zip_path, as_attachment=True, download_name="temp.zip")


@app.route("/sysinfo", methods=["GET"])
def sysinfo():
    """Return system CPU and memory info."""
    import psutil
    cpu_pct = psutil.cpu_percent(interval=0.5)
    mem = psutil.virtual_memory()
    return jsonify({
        "cpu_percent": cpu_pct,
        "cpu_count": psutil.cpu_count(),
        "mem_total_mb": round(mem.total / 1024 / 1024),
        "mem_used_mb": round(mem.used / 1024 / 1024),
        "mem_percent": mem.percent,
    })


if __name__ == "__main__":
    print(f"Worker listening on 0.0.0.0:{PORT}")
    print(f"SIMULATOR_DIR: {SIMULATOR_DIR}")
    print(f"PRODUCTION_DIR: {PRODUCTION_DIR}")
    app.run(host="0.0.0.0", port=PORT)
