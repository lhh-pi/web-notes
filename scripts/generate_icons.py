#!/usr/bin/env python3
"""Generate Web Notes extension icons — polished note/memo with highlight accent."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw


# ── Color palette ──────────────────────────────────────────────────────────

BLUE = (25, 118, 210)          # #1976d2 — primary brand
BLUE_DARK = (13, 71, 161)      # #0d47a1 — deeper blue for small sizes
WHITE = (255, 255, 255)
PAGE_BG = (252, 252, 252)      # slight off-white for page
YELLOW = (255, 213, 79)        # #ffd54f — highlight accent
YELLOW_EDGE = (255, 183, 77)   # #ffb74d — bottom edge of highlight
GREY_BORDER = (200, 200, 200)  # page border
GREY_LINE = (190, 190, 190)    # text line color
FOLD_BG = (240, 240, 240)      # folded paper color
FOLD_SHADOW = (0, 0, 0, 40)    # fold shadow
SHADOW_COLOR = (0, 0, 0, 20)   # drop shadow


def _draw_page(
    draw: ImageDraw.ImageDraw,
    x0: int, y0: int, x1: int, y1: int,
    radius: int,
    fill: tuple[int, int, int],
    outline: tuple[int, int, int],
    width: int,
) -> None:
    """Draw a rounded rectangle page."""
    r = radius
    # Main rectangles
    draw.rectangle((x0 + r, y0, x1 - r, y1), fill=fill)
    draw.rectangle((x0, y0 + r, x1, y1 - r), fill=fill)
    # Corner circles
    draw.pieslice((x0, y0, x0 + 2 * r, y0 + 2 * r), 180, 270, fill=fill)
    draw.pieslice((x1 - 2 * r, y0, x1, y0 + 2 * r), 270, 360, fill=fill)
    draw.pieslice((x0, y1 - 2 * r, x0 + 2 * r, y1), 90, 180, fill=fill)
    draw.pieslice((x1 - 2 * r, y1 - 2 * r, x1, y1), 0, 90, fill=fill)
    # Outline
    if outline and width > 0:
        draw.arc((x0, y0, x0 + 2 * r, y0 + 2 * r), 180, 270, fill=outline, width=width)
        draw.arc((x1 - 2 * r, y0, x1, y0 + 2 * r), 270, 360, fill=outline, width=width)
        draw.arc((x0, y1 - 2 * r, x0 + 2 * r, y1), 90, 180, fill=outline, width=width)
        draw.arc((x1 - 2 * r, y1 - 2 * r, x1, y1), 0, 90, fill=outline, width=width)
        draw.line((x0 + r, y0, x1 - r, y0), fill=outline, width=width)
        draw.line((x0 + r, y1, x1 - r, y1), fill=outline, width=width)
        draw.line((x0, y0 + r, x0, y1 - r), fill=outline, width=width)
        draw.line((x1, y0 + r, x1, y1 - r), fill=outline, width=width)


def _draw_note_icon(size: int) -> Image.Image:
    """Draw a note icon at the given size.

    Design: white page with blue left margin stripe, top-right folded corner,
    yellow highlight strip across the middle, and text lines below.
    """
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    base = 128
    s = size / base

    margin = max(1, int(10 * s))
    shadow_dx = max(1, int(3 * s))
    shadow_dy = max(1, int(3 * s))
    radius = max(2, int(8 * s))
    fold = max(0, int(18 * s)) if size >= 32 else 0
    stripe_w = max(2, int(6 * s))
    hl_h = max(2, int(9 * s))

    # Page bounds (leave room for shadow)
    px0 = margin
    py0 = margin
    px1 = size - margin - shadow_dx
    py1 = size - margin - shadow_dy

    # ── Drop shadow ────────────────────────────────────────────────────
    if size >= 32:
        _draw_page(
            draw,
            px0 + shadow_dx, py0 + shadow_dy,
            px1 + shadow_dx, py1 + shadow_dy,
            radius, fill=(0, 0, 0, 30), outline=(0, 0, 0, 0), width=0,
        )

    # ── Page body ──────────────────────────────────────────────────────
    _draw_page(
        draw, px0, py0, px1, py1, radius,
        fill=PAGE_BG,
        outline=GREY_BORDER,
        width=max(1, int(1.5 * s)),
    )

    # ── Folded corner ──────────────────────────────────────────────────
    if fold > 0:
        # Fold triangle (lighter paper)
        draw.polygon(
            (
                (px1 - fold, py0),
                (px1, py0),
                (px1, py0 + fold),
            ),
            fill=FOLD_BG,
        )
        # Fold crease line
        draw.line(
            ((px1 - fold, py0), (px1, py0 + fold)),
            fill=GREY_BORDER,
            width=max(1, int(1.5 * s)),
        )
        # Inner shadow along the fold
        draw.line(
            ((px1 - fold, py0), (px1 - fold, py0 + fold)),
            fill=(0, 0, 0, 50),
            width=max(1, int(1.5 * s)),
        )

    # ── Blue left margin stripe ────────────────────────────────────────
    stripe_x0 = px0 + max(1, int(2 * s))
    sx1 = px0 + stripe_w
    # Draw as a filled rectangle within the page
    draw.rectangle(
        (stripe_x0, py0 + radius // 2, sx1, py1 - radius // 2),
        fill=BLUE if size >= 32 else BLUE_DARK,
    )

    # ── Yellow highlight strip ─────────────────────────────────────────
    hl_x0 = px0 + stripe_w + max(2, int(10 * s))
    if fold > 0:
        hl_x1 = px1 - max(2, int(12 * s)) - fold // 2
    else:
        hl_x1 = px1 - max(2, int(10 * s))
    hl_y0 = py0 + int(size * 0.38)
    hl_y1 = hl_y0 + hl_h

    if hl_y1 <= py1 - 10 * s:  # ensure it fits
        draw.rectangle((hl_x0, hl_y0, hl_x1, hl_y1), fill=YELLOW)
        # Bottom edge for depth
        if size >= 32:
            draw.line(
                (hl_x0, hl_y1 - 1, hl_x1, hl_y1 - 1),
                fill=YELLOW_EDGE,
                width=max(1, int(2 * s)),
            )

    # ── Text lines ─────────────────────────────────────────────────────
    if size >= 32:
        lx0 = hl_x0
        line_h = max(1, int(2.5 * s))
        gap = max(3, int(7 * s))
        ly = hl_y1 + gap

        line_lengths = [1.0, 0.85, 0.55]  # varying widths
        for i, ratio in enumerate(line_lengths):
            if ly + line_h > py1 - radius:
                break
            lx1 = lx0 + int((hl_x1 - hl_x0) * ratio)
            draw.rectangle((lx0, ly, lx1, ly + line_h), fill=GREY_LINE)
            ly += gap

    return img


def main() -> None:
    """Generate all icon sizes."""
    icons_dir = (
        Path(__file__).resolve().parent.parent / "src" / "assets" / "icons"
    )
    icons_dir.mkdir(parents=True, exist_ok=True)

    for sz in (16, 48, 128):
        icon = _draw_note_icon(sz)
        path = icons_dir / f"icon{sz}.png"
        icon.save(path, "PNG", optimize=True)
        kb = path.stat().st_size / 1024
        print(f"  icon{sz}.png  ({sz:3d}x{sz:<3d})  {kb:.1f} KB")

    print(f"\nSaved to {icons_dir}")


if __name__ == "__main__":
    main()
