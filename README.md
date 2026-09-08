# Simulator Cluster

A distributed system for running large-scale game simulations (bingo/slot math models) across multiple machines, coordinated from a central web control panel.

## Overview

The system splits a simulation workload (total spins) across a cluster of nodes, runs them in parallel, polls progress, and merges the results. It ships with a browser-based control panel for managing the cluster, launching simulations, syncing files, browsing history, playing games against a Java server, and more.

## Components

| Component | Role |
|-----------|------|
| **Master** (`master/`) | Central Flask app + web control panel. Orchestrates simulations, splits/allocates work across nodes, polls progress, merges results, and hosts management features (Workers, Config, History, MD5/SHA1, Version, IAM, CICD, Play, File Sync, plugins). |
| **Worker** (`worker/`) | Lightweight Flask service on each worker machine. Receives simulation tasks (`/start`), reports status (`/status`), stops tasks (`/stop`), serves logs (`/logs`), and exposes file operations used by the master. |
| **Launcher** (`launcher/`) | A resident "gatekeeper" service on worker machines. Because the master cannot reach `worker` when its process is down, the launcher stays online to start/stop the worker process itself. |
| **Game** (`game/`) | Standalone game server(s) (e.g. Tile Explorer) used for local play/testing. |

The Master node can also act as a local simulator (it runs the `master` node in allocation alongside remote workers).

## Architecture

```
                +-------------------+
                |   Browser (UI)    |
                +---------+---------+
                          | HTTP
                +---------v---------+
                |      Master       |  Flask control panel + orchestration
                +----+---------+----+
        HTTP         |         |         HTTP
        +------------+         +------------+
        |                                    |
+-------v--------+                  +--------v-------+
|   Launcher     |  start/stop      |   Launcher     |
|  (gatekeeper)  +---------------+  |  (gatekeeper)  |
+-------+--------+               |  +-------+--------+
        | starts                 |          | starts
+-------v--------+               |  +-------v--------+
|    Worker      |  run sims     |  |    Worker      |
+----------------+               |  +----------------+
```

## Project Layout

```
simulator/
├── master/            # Control panel + orchestration (Flask)
│   ├── app.py         # App entry point, route registration
│   ├── blueprints/    # Feature modules: auth, iam, cicd, history,
│   │                  #   simulations, workers, files, version
│   ├── services/      # worker client, run coordinator, file service
│   ├── static/        # JS/CSS/assets for the web UI
│   ├── templates/     # Jinja HTML templates (index.html + includes)
│   ├── data/machine/  # Game machine configs (main.json + per-game JSON)
│   ├── config.py      # Cluster configuration management
│   └── config.json    # Master runtime config (port, nodes, dirs, ...)
├── worker/            # Worker service (Flask)
│   ├── app.py
│   └── config.json    # simulator_dir, production_dir, port
├── launcher/          # Worker process gatekeeper (Flask)
│   ├── app.py
│   └── config.json    # worker exe path, port, auth token
├── game/              # Standalone game server(s)
└── .venv/             # Python virtual environment (local)
```

## Requirements

- Python 3.12+
- Master dependencies: `flask`, `requests`, `psutil`, `pypdf`, `paramiko`, `websocket-client` (plus `pytest`, `hypothesis` for tests)
- Worker dependencies: `flask`, `psutil` (plus `pytest`, `hypothesis` for tests)

## Setup

Create a virtual environment and install dependencies:

```bash
# from the repository root
python3 -m venv .venv

# Windows (PowerShell)
.venv\Scripts\Activate.ps1
# macOS / Linux
source .venv/bin/activate

pip install -r master/requirements.txt
pip install -r worker/requirements.txt
```

On Windows you can also run scripts directly with the venv interpreter without activating:

```powershell
& "e:\python\workSpace\simulator\.venv\Scripts\python.exe" master\app.py
```

## Configuration

- **Master** — `master/config.json`: listening `port`, `simulator_dir`, `production_dir`, allocation mode, poll interval, and the list of `workers` (address, vCPU, percentage, share dir).
- **Worker** — `worker/config.json`: `simulator_dir`, `production_dir`, `port`.
- **Launcher** — `launcher/config.json`: `worker_exe_path`, `worker_cwd`, `port`, `auth_token`.

## Running (from source)

Start each component in its own terminal (with the venv active):

```bash
# Master (control panel) — default port from config.json (e.g. 5555)
python master/app.py

# Worker — default port 5001
python worker/app.py

# Launcher — default port 5099
python launcher/app.py
```

On Linux, workers are commonly run in the background:

```bash
nohup python3 worker/app.py > output.log 2>&1 &
```

Then open the master control panel in a browser at `http://<master-host>:<port>` (e.g. `http://localhost:5555`).

## Building executables (PyInstaller)

Each component has a `.spec` file for a one-file build:

```bash
pip install pyinstaller

cd master && pyinstaller master.spec
cd ../worker && pyinstaller worker.spec
cd ../launcher && pyinstaller launcher.spec
```

The built binaries appear under each component's `dist/` directory.

## Networking notes

- Workers and the master often communicate over a VPN (e.g. ZeroTier). Ensure the master and worker/launcher ports are reachable.
- On Windows, allow the master port through the firewall, for example:

  ```powershell
  New-NetFirewallRule -DisplayName "Allow Flask 5555 (ZeroTier)" `
    -Direction Inbound -Protocol TCP -LocalPort 5555 -Action Allow
  ```

## Testing

Tests use `pytest` (with `hypothesis` for property-based tests):

```bash
# from the repository root, with the venv active
pytest master/tests
pytest worker/tests
```

## Control panel features (Master)

- **Home** — configure nodes and launch Batch/Single simulations, monitor progress.
- **Version** — scan `production_dir` for jar files and record SHA1/SHA256 (simulation & java versions).
- **Workers** — manage worker nodes and health.
- **Config** — edit cluster configuration.
- **History** — browse past simulation results.
- **MD5 / SHA1** — hashing utilities.
- **Plugin** — batch file tools (compare, format, batch delete/override/edit/upload/download), bingo tools (card generation, pattern combination/calculation, statistic analysis).
- **CICD** — build/deploy tooling.
- **Play** — connect to the game server and play bingo/slot machines.
- **IAM** — users, roles, authorities, and menu-based access control.
- **File Sync** — browse and sync files between master and workers.
