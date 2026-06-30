"""Export notes as Markdown."""

from __future__ import annotations

import io
from datetime import datetime, timezone

from .storage import iter_all_notes


def export_to_markdown(domain: str = "") -> str:
    """Export all notes (optionally filtered by domain) as a Markdown string.

    Args:
        domain: If non-empty, export only notes from this domain.

    Returns:
        A Markdown string suitable for saving as a .md file.
    """
    pages = list(iter_all_notes())
    if domain:
        pages = [p for p in pages if p.domain == domain]

    if not pages:
        return "*No notes found.*"

    # Sort by domain, then by title
    pages.sort(key=lambda p: (p.domain, p.title))

    buf = io.StringIO()
    buf.write("# Exported Notes\n\n")
    buf.write(
        f"*Exported on {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}*\n\n"
    )

    current_domain = ""
    for page in pages:
        # Domain heading
        if page.domain != current_domain:
            current_domain = page.domain
            buf.write(f"## {current_domain}\n\n")

        # Page heading
        title = page.title or page.url
        buf.write(f"### [{title}]({page.url})\n\n")
        buf.write(f"*Updated: {page.updated}*\n\n")

        for hl in page.highlights:
            buf.write(f"> {hl.text}\n\n")
            buf.write(f"> Color: {hl.color.value}\n\n")
            if hl.note:
                buf.write(f"{hl.note}\n\n")
            buf.write("---\n\n")

    return buf.getvalue()
