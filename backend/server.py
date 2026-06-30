"""FastAPI server entry point.

Starts the local HTTP API that the Chrome extension communicates with.
Run as:  python -m backend.server  (from project root)
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from .config import NOTE_STORAGE_PATH, SERVER_HOST, SERVER_PORT
from .export import export_to_markdown
from .models import (
    CreateHighlightRequest,
    Highlight,
    TextAnchor,
    UpdateHighlightRequest,
)
from .search import search
from .storage import (
    delete_highlight,
    delete_page,
    get_notes,
    list_domains,
    list_pages,
    save_highlight,
    update_highlight,
)


def _ensure_storage_dir() -> None:
    """Create the notes storage directory on startup if missing."""
    NOTE_STORAGE_PATH.mkdir(parents=True, exist_ok=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown events."""
    _ensure_storage_dir()
    yield


app = FastAPI(
    title="Web Notes API",
    version="0.1.0",
    lifespan=lifespan,
)

# Allow requests from Chrome extension content scripts
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/notes")
def api_get_notes(url: str = Query(..., description="Full page URL")):
    """Retrieve all highlights and notes for a given page URL."""
    note = get_notes(url)
    if note is None:
        return {"url": url, "highlights": []}
    return note.model_dump()


@app.post("/api/notes")
def api_create_highlight(req: CreateHighlightRequest):
    """Create a new highlight (or update if same ID exists)."""
    highlight = Highlight(
        text=req.text,
        color=req.color,
        note=req.note,
        anchor=req.anchor or TextAnchor(),
    )
    page = save_highlight(
        url=req.url,
        title=req.title,
        domain=req.domain,
        highlight=highlight,
    )
    return page.model_dump()


@app.patch("/api/notes/{highlight_id}")
def api_update_highlight(
    highlight_id: str,
    req: UpdateHighlightRequest,
    url: str = Query(..., description="Page URL"),
):
    """Update a highlight's note content or color."""
    result = update_highlight(
        url=url,
        highlight_id=highlight_id,
        note_text=req.note,
        color=req.color.value if req.color else None,
    )
    if result is None:
        raise HTTPException(status_code=404, detail="Highlight not found")
    return result.model_dump()


@app.delete("/api/notes/{highlight_id}")
def api_delete_highlight(
    highlight_id: str,
    url: str = Query(..., description="Page URL"),
):
    """Delete a highlight from a page."""
    result = delete_highlight(url=url, highlight_id=highlight_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Highlight not found")
    return {"deleted": highlight_id, "url": url}


@app.get("/api/search")
def api_search(q: str = Query(..., min_length=1, description="Search query")):
    """Full-text search across all notes."""
    results = search(q)
    return {"query": q, "count": len(results), "results": [r.model_dump() for r in results]}


@app.get("/api/domains")
def api_list_domains():
    """List all domain directories that have notes."""
    domains = list_domains()
    return {"domains": domains}


@app.get("/api/pages")
def api_list_pages():
    """List all indexed pages with metadata, newest first."""
    pages = list_pages()
    return {"pages": pages}


@app.delete("/api/pages")
def api_delete_page(url: str = Query(..., description="Page URL to delete entirely")):
    """Delete all highlights for a page URL (also cleans stale index entries)."""
    delete_page(url)
    return {"deleted": url}


@app.get("/api/export")
def api_export(domain: str = Query(default="", description="Domain to export; empty = all")):
    """Export notes as Markdown."""
    markdown = export_to_markdown(domain)
    from fastapi.responses import PlainTextResponse

    filename = f"notes-{domain or 'all'}.md"
    return PlainTextResponse(
        content=markdown,
        media_type="text/markdown; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.get("/api/health")
def api_health():
    """Health check endpoint."""
    return {
        "status": "ok",
        "storage_path": str(NOTE_STORAGE_PATH),
        "storage_exists": NOTE_STORAGE_PATH.exists(),
    }


if __name__ == "__main__":
    import uvicorn

    _ensure_storage_dir()
    print(f"Web Notes API starting on {SERVER_HOST}:{SERVER_PORT}")
    print(f"Storage path: {NOTE_STORAGE_PATH}")
    uvicorn.run(app, host=SERVER_HOST, port=SERVER_PORT, log_level="info")
