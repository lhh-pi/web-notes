"""Pydantic data models for notes, highlights, and API request/response schemas."""

from datetime import datetime, timezone
from enum import Enum
from typing import Optional
from uuid import uuid4

from pydantic import BaseModel, Field


def _utc_now() -> str:
    """Return current UTC timestamp in ISO 8601 format."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _new_id() -> str:
    """Generate a short unique ID for a highlight."""
    return uuid4().hex[:8]


class HighlightColor(str, Enum):
    """Supported highlight colors."""

    YELLOW = "yellow"
    GREEN = "green"
    BLUE = "blue"
    RED = "red"


class TextAnchor(BaseModel):
    """Positional fingerprint for re-applying a highlight on page revisit.

    Uses a three-tier recovery strategy:
    1. XPath + offset — precise DOM position
    2. prefix + suffix — fuzzy match when DOM structure shifts
    3. text-only match — fallback when the DOM changes heavily
    """

    text: str = Field(default="", description="The exact highlighted text to locate")
    prefix: str = Field(default="", description="Up to 100 chars of preceding text context")
    suffix: str = Field(default="", description="Up to 100 chars of following text context")
    xpath: str = Field(default="", description="XPath to the START text node")
    offset: int = Field(default=0, description="Character offset within the START text node")
    end_xpath: str = Field(default="", description="XPath to the END text node (empty if same node)", alias="endXpath")
    end_offset: int = Field(default=0, description="Character offset within the END text node", alias="endOffset")


class Highlight(BaseModel):
    """A single highlight annotation within a page."""

    id: str = Field(default_factory=_new_id, description="Unique highlight ID")
    text: str = Field(..., min_length=1, description="The highlighted text content")
    color: HighlightColor = Field(default=HighlightColor.YELLOW, description="Highlight color")
    note: str = Field(default="", description="Markdown note content; empty = pure highlight")
    anchor: TextAnchor = Field(default_factory=TextAnchor, description="Text position fingerprint")
    created: str = Field(default_factory=_utc_now, description="ISO 8601 creation timestamp")

    # Sidebar convenience: whether this highlight has note content
    @property
    def has_note(self) -> bool:
        return bool(self.note.strip())


class PageNote(BaseModel):
    """All highlights and metadata for a single web page."""

    url: str = Field(..., description="Full URL of the annotated page")
    title: str = Field(default="", description="Page title extracted from <title> or <h1>")
    domain: str = Field(default="", description="Domain extracted from the URL")
    highlights: list[Highlight] = Field(default_factory=list, description="All highlights on this page")
    created: str = Field(default_factory=_utc_now, description="ISO 8601 creation timestamp")
    updated: str = Field(default_factory=_utc_now, description="ISO 8601 last-modified timestamp")

    def touch(self) -> None:
        """Update the updated timestamp to now."""
        self.updated = _utc_now()


# ── API request schemas ──────────────────────────────────────────────

class CreateHighlightRequest(BaseModel):
    """Request body for creating or updating a highlight."""

    url: str = Field(..., description="The URL of the page this highlight belongs to")
    title: str = Field(default="", description="Page title")
    domain: str = Field(default="", description="Page domain")
    text: str = Field(..., min_length=1)
    color: HighlightColor = HighlightColor.YELLOW
    note: str = Field(default="")
    anchor: TextAnchor = Field(default_factory=TextAnchor)


class UpdateHighlightRequest(BaseModel):
    """Request body for updating an existing highlight (note or color)."""

    note: Optional[str] = Field(default=None, description="New note content (Markdown)")
    color: Optional[HighlightColor] = Field(default=None, description="New highlight color")


class ExportRequest(BaseModel):
    """Request body for exporting notes."""

    domain: str = Field(default="", description="Domain to export; empty = all domains")


class SearchResult(BaseModel):
    """A single search result."""

    url: str
    title: str
    domain: str
    highlight_id: str
    match_text: str
    note: str
    context: str = Field(default="", description="Snippet of surrounding text for display")


