"""
Self-update for the web page, so a new version never needs a zip.

Only the page (frontend/index.html) is updated, from one fixed URL in the code or .env. The URL is
never taken from a request. The download is size-capped, must still look like this app, and the
page it replaces is kept beside it as index.html.bak.

No FastAPI or MT5 here on purpose: this is plain Python so it can be tested on its own.
"""

from __future__ import annotations

import hashlib
import urllib.error
import urllib.request
from pathlib import Path

# The page lives in a public repository, so this needs no credentials.
DEFAULT_URL = ("https://raw.githubusercontent.com/rajareddyvakada-create/rajareddy/"
               "refs/heads/claude/stoic-turing-1ozkq1/xm-bridge/frontend/index.html")

MAX_BYTES = 5_000_000
# Things the real page always contains. A download missing any of them is not this app.
MARKERS = (b"<title>XM Trading</title>", b'id="chart"', b"/api/candles")


class UpdateError(Exception):
    """The update could not be fetched or did not look like this app."""


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()[:12]


def version_of(path: Path) -> str | None:
    """A short fingerprint of the page on disk, used to tell versions apart."""
    try:
        return sha(path.read_bytes())
    except OSError:
        return None


def fetch(url: str, timeout: float = 20.0) -> bytes:
    """Download the page and refuse anything that is too big or is not this app."""
    req = urllib.request.Request(url, headers={"User-Agent": "xm-bridge-updater", "Cache-Control": "no-cache"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            if getattr(r, "status", 200) != 200:
                raise UpdateError(f"The server answered {r.status}.")
            data = r.read(MAX_BYTES + 1)
    except urllib.error.HTTPError as e:
        raise UpdateError(f"The server answered {e.code}.") from e
    except Exception as e:                       # offline, DNS, TLS, timeout
        raise UpdateError(f"Couldn't reach the update: {e}") from e

    if len(data) > MAX_BYTES:
        raise UpdateError("The download is far larger than the page should be; ignored.")
    missing = [m.decode() for m in MARKERS if m not in data]
    if missing:
        raise UpdateError("That download is not this app (missing " + ", ".join(missing) + ").")
    return data


def status(page: Path, url: str = DEFAULT_URL) -> dict:
    """Compare the page on disk with the one online."""
    here = version_of(page)
    data = fetch(url)
    there = sha(data)
    return {"current": here, "latest": there, "newer": here != there, "bytes": len(data)}


def apply(page: Path, url: str = DEFAULT_URL) -> dict:
    """Replace the page, keeping the old one as index.html.bak."""
    data = fetch(url)
    here = version_of(page)
    there = sha(data)
    if here == there:
        return {"ok": True, "changed": False, "current": here}
    if page.exists():
        page.with_suffix(page.suffix + ".bak").write_bytes(page.read_bytes())
    page.write_bytes(data)
    return {"ok": True, "changed": True, "from": here, "current": there, "bytes": len(data)}
