#!/usr/bin/env python3
"""Generate the Estates Ledger PWA icons from the Metropolitan Gaming mark.

    python3 src/ledger/make-icons.py

Writes icon-{180,192,512}.png and icon-512-maskable.png to the repo root, where
GitHub Pages serves them next to index.html and manifest.json.

Not part of build.py: the icons only change if the source mark or the brand
colours change, and keeping PIL out of the normal build keeps that dependency-free.
Re-run this by hand if you change assets/logos/mark_cutout.png.

The mark is a transparent cutout, so every icon gets the crimson brand background
painted behind it — a transparent PWA icon renders as a black blob on some Android
launchers. Maskable gets extra padding because launchers crop to a circle: the
spec's safe zone is the middle 80%, so the mark occupies ~55% to survive the crop.
"""

from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
MARK = Path(__file__).resolve().parent / "assets" / "logos" / "mark_cutout.png"

BG = (43, 10, 16)  # #2B0A10 — the dark crimson the app's dark theme uses

# (filename, canvas px, fraction of the canvas the mark may occupy)
TARGETS = [
    ("icon-180.png", 180, 0.72),           # iOS apple-touch-icon
    ("icon-192.png", 192, 0.72),
    ("icon-512.png", 512, 0.72),
    ("icon-512-maskable.png", 512, 0.55),  # cropped to a circle by launchers
]


def main() -> int:
    mark = Image.open(MARK).convert("RGBA")

    for name, size, fraction in TARGETS:
        canvas = Image.new("RGBA", (size, size), BG + (255,))
        box = int(size * fraction)
        scale = min(box / mark.width, box / mark.height)
        w, h = max(1, round(mark.width * scale)), max(1, round(mark.height * scale))
        resized = mark.resize((w, h), Image.LANCZOS)
        canvas.paste(resized, ((size - w) // 2, (size - h) // 2), resized)
        # flatten to RGB: no alpha, so launchers can't render it as a dark blob
        canvas.convert("RGB").save(ROOT / name, "PNG", optimize=True)
        print(f"{name:<24} {size}x{size}  mark at {int(fraction * 100)}%")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
