"""Full-text search across all notes.

For a personal-use scale (hundreds to low thousands of notes),
a simple in-memory scan is fast enough. Upgrade to Whoosh if
the note count grows beyond ~10,000.
"""

from .models import SearchResult
from .storage import iter_all_notes


def search(query: str, limit: int = 50) -> list[SearchResult]:
    """Search all notes for the given query string.

    Performs a case-insensitive substring match against:
    - Highlighted text
    - Note content
    - Page title

    Args:
        query: Search keywords.
        limit: Maximum number of results to return.

    Returns:
        List of SearchResult, sorted by relevance (longer match = higher score).
    """
    if not query or not query.strip():
        return []

    q = query.lower().strip()
    results: list[SearchResult] = []

    for page in iter_all_notes():
        for h in page.highlights:
            # Compute a simple relevance score: total matched character length
            score = 0
            match_text = ""
            context = ""

            # Search in highlighted text
            if q in h.text.lower():
                score += len(q)
                match_text = h.text
                context = _snippet(h.text, q, max_len=120)

            # Search in note content (bonus: notes are more important)
            if h.note and q in h.note.lower():
                score += len(q) * 2
                match_text = h.text
                context = _snippet(h.note, q, max_len=120)

            # Search in page title
            if q in page.title.lower():
                score += len(q) // 2
                if not match_text:
                    match_text = h.text
                if not context:
                    context = f"Title: {page.title}"

            # Search in URL (match the domain or path)
            if q in page.url.lower():
                score += len(q)
                if not match_text:
                    match_text = h.text
                if not context:
                    context = f"URL: {page.url}"

            if score > 0:
                results.append(
                    SearchResult(
                        url=page.url,
                        title=page.title,
                        domain=page.domain,
                        highlight_id=h.id,
                        match_text=match_text or h.text,
                        note=h.note,
                        context=context,
                    )
                )
                # Attach score for sorting (not part of the model)
                results[-1]._score = score  # type: ignore[attr-defined]

    # Sort by relevance score descending, then take top N
    results.sort(key=lambda r: getattr(r, "_score", 0), reverse=True)
    return results[:limit]


def _snippet(text: str, query: str, max_len: int = 120) -> str:
    """Extract a snippet of text around the query match.

    Args:
        text: Full text to extract from.
        query: The search term.
        max_len: Maximum snippet length.

    Returns:
        A text snippet with '...' padding if truncated.
    """
    idx = text.lower().find(query.lower())
    if idx == -1:
        return text[:max_len]

    start = max(0, idx - max_len // 2)
    end = min(len(text), idx + len(query) + max_len // 2)
    snippet = text[start:end]
    if start > 0:
        snippet = "..." + snippet
    if end < len(text):
        snippet = snippet + "..."
    return snippet
