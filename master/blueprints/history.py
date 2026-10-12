"""History blueprint – list / load / query / export / delete simulation runs."""

import io
import os
import zipfile

from flask import Blueprint, jsonify, request, send_file

history_bp = Blueprint("history", __name__)

# ---------------------------------------------------------------------------
# Dependencies (set via init_history)
# ---------------------------------------------------------------------------
_history_store = None
_poller = None


def init_history(history_store, poller):
    """Inject runtime dependencies."""
    global _history_store, _poller
    _history_store = history_store
    _poller = poller


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@history_bp.route("/history/list", methods=["GET"])
def history_list():
    """List all saved simulation runs."""
    return jsonify({"runs": _history_store.list_runs()})


@history_bp.route("/history/load", methods=["GET"])
def history_load():
    """Load a specific run's data."""
    filename = request.args.get("filename", "")
    if not filename:
        return jsonify({"error": "filename required"}), 400
    data = _history_store.load_run(filename)
    if data is None:
        return jsonify({"error": "not found"}), 404
    return jsonify(data)


@history_bp.route("/history/query", methods=["GET"])
def history_query():
    """Query runs by model name and/or date range."""
    model_name = request.args.get("model", "")
    start_date = request.args.get("start", "")
    end_date = request.args.get("end", "")
    results = _history_store.query(model_name, start_date, end_date)
    return jsonify({"results": results})


@history_bp.route("/history/export", methods=["POST"])
def history_export():
    """Package selected history files as a zip."""
    data = request.get_json(force=True)
    filenames = data.get("filenames", [])

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for fname in filenames:
            fpath = os.path.join(_history_store._data_dir, fname)
            if os.path.isfile(fpath):
                zf.write(fpath, fname)

    buf.seek(0)
    return send_file(
        buf,
        mimetype="application/zip",
        as_attachment=True,
        download_name="history_export.zip",
    )


@history_bp.route("/history/delete", methods=["POST"])
def history_delete():
    """Delete history files."""
    data = request.get_json(force=True)
    filenames = data.get("filenames", [])
    results = []
    for fname in filenames:
        fpath = os.path.join(_history_store._data_dir, fname)
        try:
            if os.path.isfile(fpath):
                os.remove(fpath)
                results.append({"filename": fname, "status": "deleted"})
            else:
                results.append({"filename": fname, "status": "not found"})
        except OSError as exc:
            results.append({"filename": fname, "status": "error", "error": str(exc)})
    return jsonify({"results": results})


@history_bp.route("/history/save", methods=["POST"])
def history_save():
    """Manually save current aggregated results to history."""
    snapshot = _poller.get_snapshot()
    nodes_data = snapshot.get("nodes", {})
    all_model_results: dict[str, list[dict]] = {}
    for name, info in nodes_data.items():
        model_results = info.get("model_results", {})
        for model_name, model_data in model_results.items():
            if model_name not in all_model_results:
                all_model_results[model_name] = []
            all_model_results[model_name].append(model_data)

    if not all_model_results:
        return jsonify({"error": "No data to save"}), 400

    filename = _history_store.save_run(all_model_results)
    return jsonify({"status": "saved", "filename": filename})
