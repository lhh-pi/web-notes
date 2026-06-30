"""Configuration management: reads config.json and .env, provides resolved settings."""

import json
import os
from pathlib import Path

from dotenv import load_dotenv

# Load .env from project root (backend/../.env)
_PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(_PROJECT_ROOT / ".env")

# Load shared config (used by both Python and TypeScript)
with open(_PROJECT_ROOT / "config.json", encoding="utf-8") as _f:
    _shared = json.load(_f)


def _resolve_storage_path(raw: str) -> Path:
    """Resolve a potentially relative path to an absolute path.

    Relative paths are resolved against the project root directory.
    This allows the same .env to work across devices — as long as the
    relative position between code and storage is stable (e.g., both
    under the same OneDrive tree).

    Args:
        raw: Raw value from NOTE_STORAGE_PATH env var.

    Returns:
        Resolved absolute Path.
    """
    path = Path(raw)
    if path.is_absolute():
        return path
    return (_PROJECT_ROOT / path).resolve()


# Server settings — config.json is the source of truth, .env can override
SERVER_HOST: str = os.getenv("SERVER_HOST", _shared["server"]["host"])
SERVER_PORT: int = int(os.getenv("SERVER_PORT", str(_shared["server"]["port"])))

# Storage settings
# Default: notes directory at the same OneDrive root level as the project.
_raw_storage = os.getenv("NOTE_STORAGE_PATH", "../../../../notes")
NOTE_STORAGE_PATH: Path = _resolve_storage_path(_raw_storage)

# Index file for full-text search
INDEX_FILE: Path = NOTE_STORAGE_PATH / ".index.json"
