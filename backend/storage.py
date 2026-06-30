"""JSON file storage layer: CRUD operations for page notes.

Storage layout:
    $NOTE_STORAGE_PATH/
    ├── .index.json              # Global search index (url → {title, domain, updated})
    ├── <domain>/                # One directory per domain
    │   └── <slug>.json          # One JSON file per page
    └── ...
"""

import json
import re
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

from .config import NOTE_STORAGE_PATH, INDEX_FILE
from .models import Highlight, PageNote


def _ensure_dir(path: Path) -> None:
    """Create directory if it does not exist."""
    path.mkdir(parents=True, exist_ok=True)


def _domain_from_url(url: str) -> str:
    """Extract the domain from a URL.

    Args:
        url: Full URL string.

    Returns:
        Lowercase domain, e.g. 'github.com'.
    """
    try:
        return urlparse(url).netloc.lower()
    except Exception:
        return "unknown"


def _safe_filename(url: str) -> str:
    """Generate a safe filesystem name from a URL.

    Strips protocol, replaces unsafe characters with hyphens, and
    truncates to a reasonable length.

    Args:
        url: Full URL string.

    Returns:
        Safe filename, e.g. 'python-cpython-issues-1234.json'.
    """
    parsed = urlparse(url)
    raw = (parsed.netloc + parsed.path).strip("/")
    if parsed.query:
        raw += "-" + parsed.query
    # Replace non-alphanumeric sequences with a single hyphen
    safe = re.sub(r"[^a-zA-Z0-9]+", "-", raw).strip("-")[:200]
    return f"{safe}.json"


def get_page_path(url: str) -> Path:
    """Get the deterministic file path for a page's note JSON file.

    Args:
        url: Full page URL.

    Returns:
        Absolute Path to the JSON file (file may not exist yet).
    """
    domain = _domain_from_url(url)
    filename = _safe_filename(url)
    return NOTE_STORAGE_PATH / domain / filename


# ── Index management ──────────────────────────────────────────────────

def _load_index() -> dict[str, dict]:
    """Load the global search index from disk.

    Returns:
        Dictionary mapping URL → {title, domain, updated}. Empty dict if
        the index file does not exist or is corrupted.
    """
    if not INDEX_FILE.exists():
        return {}
    try:
        with open(INDEX_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return {}


def _save_index(index: dict[str, dict]) -> None:
    """Persist the global search index to disk atomically.

    Args:
        index: The full index dictionary to save.
    """
    _ensure_dir(INDEX_FILE.parent)
    tmp = INDEX_FILE.with_suffix(".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, indent=2)
    tmp.replace(INDEX_FILE)


def _update_index(url: str, title: str, domain: str, highlight_count: int = 0) -> None:
    """Add or update an entry in the global search index.

    Args:
        url: Page URL (used as the index key).
        title: Current page title.
        domain: Page domain.
        highlight_count: Number of highlights on this page.
    """
    index = _load_index()
    index[url] = {
        "title": title,
        "domain": domain,
        "updated": PageNote(  # We only need the timestamp; abuse PageNote's default factory
            url=url, domain=domain
        ).updated,
        "highlight_count": highlight_count,
    }
    _save_index(index)


def _remove_from_index(url: str) -> None:
    """Remove a URL entry from the global search index.

    Args:
        url: Page URL to remove.
    """
    index = _load_index()
    index.pop(url, None)
    _save_index(index)


# ── CRUD operations ───────────────────────────────────────────────────

def get_notes(url: str) -> Optional[PageNote]:
    """Load all highlights and notes for a given URL.

    Args:
        url: Full page URL.

    Returns:
        PageNote if the file exists, None otherwise.
    """
    path = get_page_path(url)
    if not path.exists():
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return PageNote(**data)
    except (json.JSONDecodeError, OSError, TypeError):
        return None


def save_highlight(
    url: str,
    title: str,
    domain: str,
    highlight: Highlight,
) -> PageNote:
    """Create a new highlight or update an existing one for a page.

    If a highlight with the same ID already exists, it is replaced.
    Otherwise the highlight is appended to the page's highlight list.

    Args:
        url: Full page URL.
        title: Page title.
        domain: Page domain.
        highlight: The Highlight object to save.

    Returns:
        The updated PageNote.
    """
    path = get_page_path(url)
    note = get_notes(url)

    if note is None:
        note = PageNote(url=url, title=title, domain=domain)

    # Update metadata
    if title:
        note.title = title
    if domain:
        note.domain = domain

    # Replace existing highlight with same ID, or append
    replaced = False
    for i, h in enumerate(note.highlights):
        if h.id == highlight.id:
            note.highlights[i] = highlight
            replaced = True
            break
    if not replaced:
        note.highlights.append(highlight)

    note.touch()

    # Write to disk
    _ensure_dir(path.parent)
    tmp = path.with_suffix(".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(note.model_dump_json(indent=2, exclude_none=True))
    tmp.replace(path)

    # Update global index
    _update_index(url, note.title, note.domain, len(note.highlights))

    return note


def update_highlight(
    url: str,
    highlight_id: str,
    note_text: Optional[str] = None,
    color: Optional[str] = None,
) -> Optional[PageNote]:
    """Update a highlight's note or color in-place.

    Args:
        url: Full page URL.
        highlight_id: The highlight's unique ID.
        note_text: New Markdown note content (None = no change).
        color: New highlight color string (None = no change).

    Returns:
        Updated PageNote, or None if the page or highlight was not found.
    """
    page = get_notes(url)
    if page is None:
        return None

    for h in page.highlights:
        if h.id == highlight_id:
            if note_text is not None:
                h.note = note_text
            if color is not None:
                # Validate color
                from backend.models import HighlightColor

                h.color = HighlightColor(color)
            page.touch()
            # Re-save the full page
            path = get_page_path(url)
            _ensure_dir(path.parent)
            tmp = path.with_suffix(".tmp")
            with open(tmp, "w", encoding="utf-8") as f:
                f.write(page.model_dump_json(indent=2, exclude_none=True))
            tmp.replace(path)
            _update_index(url, page.title, page.domain)
            return page

    return None


def delete_highlight(url: str, highlight_id: str) -> Optional[PageNote]:
    """Delete a highlight from a page.

    If the page has no highlights left after deletion, the file is removed.

    Args:
        url: Full page URL.
        highlight_id: The highlight's unique ID.

    Returns:
        Updated PageNote (empty highlights list), or None if not found.
    """
    page = get_notes(url)
    if page is None:
        return None

    page.highlights = [h for h in page.highlights if h.id != highlight_id]
    page.touch()

    path = get_page_path(url)
    if not page.highlights:
        # Remove empty files to keep the storage clean
        path.unlink(missing_ok=True)
        _remove_from_index(url)
    else:
        _ensure_dir(path.parent)
        tmp = path.with_suffix(".tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(page.model_dump_json(indent=2, exclude_none=True))
        tmp.replace(path)
        _update_index(url, page.title, page.domain)

    return page


def list_pages() -> list[dict]:
    """List all indexed pages sorted by last updated (newest first).

    Reads actual note files for accurate highlight_count, and repairs
    stale index entries in the process.
    """
    index = _load_index()
    entries = []
    needs_save = False
    for url, info in index.items():
        note = get_notes(url)
        count = len(note.highlights) if note else 0
        # Repair stale index entry
        if info.get("highlight_count", -1) != count:
            info["highlight_count"] = count
            needs_save = True
        entries.append({
            "url": url,
            "title": info.get("title", ""),
            "domain": info.get("domain", ""),
            "updated": info.get("updated", ""),
            "highlight_count": count,
        })
    if needs_save:
        _save_index(index)
    entries.sort(key=lambda e: e["updated"], reverse=True)
    return entries


def delete_page(url: str) -> bool:
    """Delete the entire note file for a URL and remove it from the index.

    If the file no longer exists, still cleans up the index entry
    (handles stale entries from renames or manual file removal).

    Args:
        url: Full page URL to delete.

    Returns:
        True if the index entry was cleaned up.
    """
    path = get_page_path(url)
    if path.exists():
        path.unlink()
        # Clean up empty domain directory
        domain_dir = path.parent
        if domain_dir.is_dir() and not any(domain_dir.iterdir()):
            domain_dir.rmdir()
    _remove_from_index(url)
    return True


def list_domains() -> list[str]:
    """List all domain directories that contain notes.

    Returns:
        Sorted list of domain names.
    """
    if not NOTE_STORAGE_PATH.exists():
        return []
    domains = []
    for d in NOTE_STORAGE_PATH.iterdir():
        if d.is_dir() and not d.name.startswith("."):
            if any(f.suffix == ".json" for f in d.iterdir()):
                domains.append(d.name)
    return sorted(domains)


def iter_all_notes() -> list[PageNote]:
    """Iterate over all page note files and return them as PageNote objects.

    Returns:
        List of all PageNote objects across all domains.
    """
    results: list[PageNote] = []
    if not NOTE_STORAGE_PATH.exists():
        return results
    for domain_dir in NOTE_STORAGE_PATH.iterdir():
        if not domain_dir.is_dir() or domain_dir.name.startswith("."):
            continue
        for note_file in domain_dir.glob("*.json"):
            try:
                with open(note_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                results.append(PageNote(**data))
            except (json.JSONDecodeError, OSError, TypeError):
                continue
    return results
