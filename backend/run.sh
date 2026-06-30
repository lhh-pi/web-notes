#!/bin/bash
# Web Notes Backend — portable startup script.
# Auto-detects project paths relative to its own location.
# Run directly or via systemd.
#   ./backend/run.sh             — start backend with logging
#   ./backend/run.sh --install   — install systemd service
#   ./backend/run.sh --uninstall — stop and remove systemd service

set -e

# ── Auto-detect paths (relative to this script's location) ──────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
LOG_DIR="$PROJECT_DIR/logs"
HOST="$(hostname)"

SERVICE_NAME="note-sync"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

# ── Uninstall mode ──────────────────────────────────────────────────

if [ "${1:-}" = "--uninstall" ]; then
    echo "=== Removing Web Notes systemd service ==="
    sudo systemctl stop "$SERVICE_NAME" 2>/dev/null || true
    sudo systemctl disable "$SERVICE_NAME" 2>/dev/null || true
    sudo rm -f "$SERVICE_FILE"
    sudo systemctl daemon-reload
    echo "Done. Service removed."
    exit 0
fi

# ── Install mode ────────────────────────────────────────────────────

if [ "${1:-}" = "--install" ]; then
    # If service already exists at a different path, clean it up first
    if [ -f "$SERVICE_FILE" ]; then
        echo "=== Upgrading existing service ==="
        sudo systemctl stop "$SERVICE_NAME" 2>/dev/null || true
    else
        echo "=== Installing Web Notes systemd service ==="
    fi
    echo "  Project : $PROJECT_DIR"
    echo "  User    : $USER"
    echo "  Script  : $SCRIPT_DIR/run.sh"
    echo

    sudo tee "$SERVICE_FILE" > /dev/null << EOF
[Unit]
Description=Web Notes Local Sync Server
After=network.target

[Service]
Type=simple
User=$USER
ExecStart=$SCRIPT_DIR/run.sh
Restart=always
RestartSec=10

[Install]
WantedBy=default.target
EOF

    sudo systemctl daemon-reload
    sudo systemctl enable "$SERVICE_NAME"
    sudo systemctl restart "$SERVICE_NAME"

    echo
    echo "=== Installed. Checking status... ==="
    sleep 1
    sudo systemctl status "$SERVICE_NAME" --no-pager -l 2>&1 | head -20
    echo
    echo "Logs: $LOG_DIR/"
    echo "Health: curl http://127.0.0.1:2463/api/health"
    exit 0
fi

# ── Log cleanup ─────────────────────────────────────────────────────

mkdir -p "$LOG_DIR"
# Delete THIS device's logs older than 1 day
find "$LOG_DIR" -name "backend-${HOST}-*.log" -mtime +0 -delete 2>/dev/null || true
# Safety net: delete ALL device logs older than 7 days (prevents
# accumulation of other devices' synced logs)
find "$LOG_DIR" -name "backend-*.log" -mtime +7 -delete 2>/dev/null || true

LOG_FILE="$LOG_DIR/backend-${HOST}-$(date +%Y-%m-%d).log"

# ── Start backend ───────────────────────────────────────────────────

echo "$(date '+%Y-%m-%d %H:%M:%S') Starting Web Notes backend..." >> "$LOG_FILE"

# Activate conda (auto-detect miniconda path)
if [ -f "$HOME/miniconda3/etc/profile.d/conda.sh" ]; then
    source "$HOME/miniconda3/etc/profile.d/conda.sh"
elif [ -f "$HOME/anaconda3/etc/profile.d/conda.sh" ]; then
    source "$HOME/anaconda3/etc/profile.d/conda.sh"
fi
conda activate note 2>/dev/null || true

cd "$PROJECT_DIR"
exec python -m backend.server >> "$LOG_FILE" 2>&1
