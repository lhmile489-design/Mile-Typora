"""App icon assets for Mile Typora, from the design source image.

    python -I scripts/make-icons.py "docs/images/深色背景上的橙角MT文档图标.png"

Writes:
    resources/icon.png      1024x1024 transparent, the built app's icon
    resources/icon-dev.png  1024x1024 with a DEV badge, the development app's icon
    public/icon.png          256x256 transparent, the page icon (favicon)

The source is flattened onto a dark backdrop with no alpha. Its black letters
are the same color as that backdrop, so alpha cannot come from color distance
alone: the backdrop and the drop shadow are found by flood filling inward from
the border, and everything the fill cannot reach stays opaque. Edges are
softened, then their color is unpremultiplied so they carry no dark fringe.

Requires Pillow and NumPy: python -m pip install pillow numpy
"""

import sys
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
CANVAS = 1024
ARTWORK = 0.86  # the artwork's share of the canvas edge
FILL_TOLERANCE = 90  # how far from the backdrop color the fill spreads (includes the shadow)


def backdrop(arr: np.ndarray) -> np.ndarray:
    h, w, _ = arr.shape
    corners = arr[[0, 0, h - 1, h - 1], [0, w - 1, 0, w - 1]]
    return corners.mean(axis=0)


def outside_region(arr: np.ndarray, bg: np.ndarray) -> np.ndarray:
    """Flood fill the backdrop from the border; True where the fill reached."""
    h, w, _ = arr.shape
    near = (np.abs(arr.astype(np.int16) - bg.astype(np.int16)).max(axis=2) <= FILL_TOLERANCE)
    seen = np.zeros((h, w), dtype=bool)
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if near[y, x] and not seen[y, x]:
                seen[y, x] = True
                q.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if near[y, x] and not seen[y, x]:
                seen[y, x] = True
                q.append((y, x))
    while q:
        y, x = q.popleft()
        for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if 0 <= ny < h and 0 <= nx < w and near[ny, nx] and not seen[ny, nx]:
                seen[ny, nx] = True
                q.append((ny, nx))
    return seen


def extract(src: Path) -> Image.Image:
    rgb = Image.open(src).convert("RGB")
    arr = np.asarray(rgb, dtype=np.float32)
    bg = backdrop(arr)

    solid = ~outside_region(arr, bg)
    alpha = Image.fromarray((solid * 255).astype(np.uint8), "L").filter(ImageFilter.GaussianBlur(0.8))
    a = np.asarray(alpha, dtype=np.float32) / 255.0

    # Unpremultiply: the pixel was composited over the backdrop.
    safe = np.where(a > 0, a, 1.0)[..., None]
    color = np.clip((arr - (1.0 - a[..., None]) * bg) / safe, 0, 255)

    out = np.dstack([color, a * 255]).astype(np.uint8)
    return Image.fromarray(out, "RGBA")


def square(art: Image.Image, canvas: int, share: float) -> Image.Image:
    bbox = art.getbbox()
    if bbox is None:
        raise SystemExit("the source image has no artwork outside the backdrop")
    art = art.crop(bbox)
    edge = round(canvas * share)
    scale = edge / max(art.width, art.height)
    art = art.resize(
        (max(1, round(art.width * scale)), max(1, round(art.height * scale))),
        Image.LANCZOS,
    )
    out = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    out.alpha_composite(art, ((canvas - art.width) // 2, (canvas - art.height) // 2))
    return out


def dev_badge(icon: Image.Image) -> Image.Image:
    out = icon.copy()
    d = ImageDraw.Draw(out)
    size = out.width
    label = "DEV"
    font = ImageFont.load_default(size=max(16, size // 14))
    left, top, right, bottom = d.textbbox((0, 0), label, font=font)
    pad_x, pad_y = size // 26, size // 34
    w, h = right - left + pad_x * 2, bottom - top + pad_y * 2
    x1 = y1 = size - size // 20
    x0, y0 = x1 - w, y1 - h
    d.rounded_rectangle((x0, y0, x1, y1), radius=h // 2, fill=(255, 140, 26, 255))
    d.text((x0 + pad_x - left, y0 + pad_y - top), label, font=font, fill=(28, 29, 32, 255))
    return out


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    src = Path(sys.argv[1])
    if not src.is_absolute():
        src = (Path.cwd() / src).resolve()
    icon = square(extract(src), CANVAS, ARTWORK)
    (ROOT / "resources").mkdir(exist_ok=True)
    (ROOT / "public").mkdir(exist_ok=True)
    icon.save(ROOT / "resources" / "icon.png")
    dev_badge(icon).save(ROOT / "resources" / "icon-dev.png")
    icon.resize((256, 256), Image.LANCZOS).save(ROOT / "public" / "icon.png")
    print("wrote resources/icon.png, resources/icon-dev.png, public/icon.png")


if __name__ == "__main__":
    main()
