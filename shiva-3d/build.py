"""Inline the cut-out frames and rock textures into a single self-contained index.html."""
import base64
from pathlib import Path

HERE = Path(__file__).parent
MIME = {'.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png'}
SLOTS = {
    '__V0__': 'v0.webp', '__V1__': 'v1.webp', '__V2__': 'v2.webp',
    '__V3__': 'v3.webp', '__V4__': 'v4.webp', '__V5__': 'v5.webp',
    '__ROCK_SIDE__': 'rock_side.jpg',
}

html = (HERE / 'template.html').read_text()
for slot, name in SLOTS.items():
    path = HERE / 'assets' / name
    uri = f"data:{MIME[path.suffix]};base64,{base64.b64encode(path.read_bytes()).decode()}"
    html = html.replace(slot, uri)
(HERE / 'index.html').write_text(html)
print(f"index.html: {len(html) / 1e6:.2f} MB")
