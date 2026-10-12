"""File service – local file system operations.

Encapsulates browsing, reading, writing, deleting, and batch file
operations on the master's local filesystem.
"""

import fnmatch
import os
import shutil
from typing import Optional


class FileService:
    """Local filesystem operations for the master node."""

    def __init__(self, production_dir: str):
        self._production_dir = production_dir

    # ------------------------------------------------------------------
    # Browse
    # ------------------------------------------------------------------
    def browse(self, path: Optional[str] = None) -> dict:
        """Browse directory contents. Returns dict with path, parent, entries.

        Special: path='__drives__' lists all Windows drive letters.
        """
        if path == "__drives__":
            return self._list_drives()

        browse_path = path or self._production_dir
        if not browse_path:
            return {"error": "production_dir not configured"}

        full_path = os.path.normpath(browse_path)
        if not os.path.isdir(full_path):
            return {"error": "Directory not found"}

        parent = os.path.dirname(full_path)
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

        return {
            "path": full_path.replace("\\", "/"),
            "parent": parent,
            "entries": entries,
        }

    def _list_drives(self) -> dict:
        """List available drive letters (Windows)."""
        import string
        drives = []
        for letter in string.ascii_uppercase:
            drive = f"{letter}:\\"
            if os.path.isdir(drive):
                drives.append({
                    "name": f"{letter}:",
                    "type": "dir",
                    "size": 0,
                    "full_path": drive,
                })
        return {"path": "My Computer", "parent": "", "entries": drives}

    # ------------------------------------------------------------------
    # Read / Write
    # ------------------------------------------------------------------
    def read(self, path: str) -> tuple[Optional[str], Optional[str]]:
        """Read file content. Returns (content, None) or (None, error)."""
        full = os.path.normpath(path)
        if not os.path.isfile(full):
            return None, "File not found"
        try:
            with open(full, "r", encoding="utf-8") as f:
                return f.read(), None
        except OSError as exc:
            return None, str(exc)

    def write(self, path: str, content: str) -> Optional[str]:
        """Write content to file. Returns None on success, error string on failure."""
        full = os.path.normpath(path)
        try:
            with open(full, "w", encoding="utf-8") as f:
                f.write(content)
            return None
        except OSError as exc:
            return str(exc)

    def create(self, path: str, content: str = "") -> Optional[str]:
        """Create a new file (and parent dirs). Returns None or error."""
        full = os.path.normpath(path)
        try:
            os.makedirs(os.path.dirname(full), exist_ok=True)
            with open(full, "w", encoding="utf-8") as f:
                f.write(content)
            return None
        except OSError as exc:
            return str(exc)

    # ------------------------------------------------------------------
    # Delete / Rename / Duplicate / Mkdir
    # ------------------------------------------------------------------
    def delete(self, paths: list[str]) -> list[dict]:
        """Delete files or directories. Returns list of result dicts."""
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
        return results

    def mkdir(self, path: str) -> Optional[str]:
        """Create directory. Returns None or error."""
        full = os.path.normpath(path)
        try:
            os.makedirs(full, exist_ok=True)
            return None
        except OSError as exc:
            return str(exc)

    def rename(self, old_path: str, new_path: str) -> Optional[str]:
        """Rename file/dir. Returns None or error."""
        old = os.path.normpath(old_path)
        new = os.path.normpath(new_path)
        if not os.path.exists(old):
            return "Source not found"
        try:
            os.rename(old, new)
            return None
        except OSError as exc:
            return str(exc)

    def duplicate(self, source: str, dest: str) -> Optional[str]:
        """Copy file/dir. Returns None or error."""
        src = os.path.normpath(source)
        dst = os.path.normpath(dest)
        if not os.path.exists(src):
            return "Source not found"
        try:
            if os.path.isdir(src):
                shutil.copytree(src, dst)
            else:
                shutil.copy2(src, dst)
            return None
        except OSError as exc:
            return str(exc)

    # ------------------------------------------------------------------
    # Batch search (glob / exact filename match)
    # ------------------------------------------------------------------
    def batch_glob_search(
        self, pattern: str, target_dirs: list[str], exclude_dirs: list[str]
    ) -> list[str]:
        """Find all files matching a glob pattern recursively."""
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
                    if fnmatch.fnmatch(f, pattern):
                        found.append(os.path.join(root, f).replace("\\", "/"))

        return found

    def batch_name_search(
        self, filenames: set[str], target_dirs: list[str], exclude_dirs: list[str]
    ) -> list[str]:
        """Find all files matching exact filenames recursively."""
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
                    if f in filenames:
                        found.append(os.path.join(root, f).replace("\\", "/"))

        return found
