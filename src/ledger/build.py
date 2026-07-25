#!/usr/bin/env python3
"""Build the Estates Ledger single-file app.

    python3 src/ledger/build.py

Reads estates-ledger.template.html, base64-encodes every asset in assets/ and
substitutes it into the matching __PLACEHOLDER__ token, then writes:

    index.html                        committed; GitHub Pages serves this
    dist/estates-ledger-slim.html     gitignored; published as the Claude Artifact

The two differ only in the background video: the artifact viewer fails to render
files much over ~2MB, and the embedded video alone is ~1.6MB of base64, so the
slim build drops the <video> element. Everything else — every feature, every byte
of application code — is identical. The crimson gradient behind the video shows
through unchanged when the element is absent.

Assets are stored as raw binaries, not pre-encoded .b64 text: they are ~25%
smaller in git and diffable as real files.
"""

import base64
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
ASSETS = HERE / "assets"

# placeholder token in the template -> asset file, relative to assets/
ASSET_MAP = {
    "__PLEX_SANS_400__": "fonts/plex-sans-400.woff2",
    "__PLEX_SANS_500__": "fonts/plex-sans-500.woff2",
    "__PLEX_SANS_600__": "fonts/plex-sans-600.woff2",
    "__PLEX_COND_600__": "fonts/plex-cond-600.woff2",
    "__PLEX_COND_700__": "fonts/plex-cond-700.woff2",
    "__PLEX_MONO_400__": "fonts/plex-mono-400.woff2",
    "__PLEX_MONO_500__": "fonts/plex-mono-500.woff2",
    "__PIRATA_400__": "fonts/pirata-400.woff2",
    "__MARK_LOGO__": "logos/mark_cutout.png",
    "__VECTOR_LOGO__": "logos/vector_v_gold.png",
    "__WORDMARK_WATERMARK__": "logos/wordmark_dark_cutout.png",
    "__BG_VIDEO__": "video/loop.mp4",
    "__SITE_IMG_MAYFAIR__": "site-images/mayfair.webp",
}

VIDEO_ELEMENT = re.compile(
    r'<video class="bg-video" id="bgVideo"[^>]*>.*?</video>\s*', re.DOTALL
)


def build() -> int:
    template = (HERE / "estates-ledger.template.html").read_text()

    missing = [n for n, p in ASSET_MAP.items() if not (ASSETS / p).is_file()]
    if missing:
        print(f"ERROR: assets missing for {', '.join(missing)}", file=sys.stderr)
        return 1

    full = template
    for token, relpath in ASSET_MAP.items():
        encoded = base64.b64encode((ASSETS / relpath).read_bytes()).decode("ascii")
        full = full.replace(token, encoded)

    leftover = sorted(set(re.findall(r"__[A-Z0-9_]+__", full)))
    if leftover:
        print(f"ERROR: unsubstituted placeholders: {leftover}", file=sys.stderr)
        return 1

    slim, removed = VIDEO_ELEMENT.subn("", full)
    if removed != 1:
        print(
            f"ERROR: expected exactly 1 <video id=bgVideo> to strip, found {removed}. "
            "The template's video element changed — update VIDEO_ELEMENT.",
            file=sys.stderr,
        )
        return 1

    (ROOT / "index.html").write_text(full)
    dist = ROOT / "dist"
    dist.mkdir(exist_ok=True)
    (dist / "estates-ledger-slim.html").write_text(slim)

    print(f"index.html                     {len(full):>10,} bytes  (GitHub Pages)")
    print(f"dist/estates-ledger-slim.html  {len(slim):>10,} bytes  (Claude Artifact)")
    return 0


if __name__ == "__main__":
    sys.exit(build())
