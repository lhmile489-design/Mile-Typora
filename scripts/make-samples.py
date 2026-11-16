#!/usr/bin/env python3
"""Generate the large samples M3-6 and AC-13 need (PRD §8.3).

The output directory is testdata/samples, which git ignores: these files are
large by design. Samples:

  large   one 10.5 MiB Markdown file (over the 10 MiB read limit)
  deep    70 nested folders with a Markdown file at the bottom, plus a
          shallow sibling that must still appear
  wide    50,001 entries in one folder (over the 50,000 entry scan bound)
  images  a damaged PNG, a PNG whose header claims more pixels than allowed,
          and an image over the 20 MiB byte limit

Usage:
  python scripts/make-samples.py --only large,deep,images
  python scripts/make-samples.py --only wide --entries 50001
  python scripts/make-samples.py --clean
"""

import argparse
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "testdata" / "samples"
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def chunk(kind: bytes, body: bytes) -> bytes:
    crc = zlib.crc32(kind + body) & 0xFFFFFFFF
    return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", crc)


def tiny_png(width: int, height: int, with_data: bool) -> bytes:
    """A PNG header describing width x height; data makes it a valid 1x1."""
    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    out = PNG_SIGNATURE + chunk(b"IHDR", header)
    if with_data:
        raw = b"\x00\x00\x00\x00"  # filter byte + one RGB pixel
        out += chunk(b"IDAT", zlib.compress(raw))
        out += chunk(b"IEND", b"")
    return out


def make_large() -> None:
    path = ROOT / "large.md"
    with path.open("w", encoding="utf-8", newline="\n") as f:
        f.write("# Large sample\n\n")
        line = "x" * 200 + "\n"
        for _ in range((11 * 1024 * 1024) // len(line)):
            f.write(line)
    print(f"large: {path} ({path.stat().st_size} bytes)")


def make_deep() -> None:
    base = ROOT / "deep"
    current = base
    for i in range(70):
        current = current / f"d{i:02d}"
    current.mkdir(parents=True, exist_ok=True)
    (current / "bottom.md").write_text("# Bottom\n", encoding="utf-8")
    (base / "shallow.md").write_text("# Shallow\n", encoding="utf-8")
    print(f"deep: {base} (70 levels)")


def make_wide(entries: int) -> None:
    base = ROOT / "wide"
    base.mkdir(parents=True, exist_ok=True)
    for i in range(entries):
        (base / f"f{i:05d}.md").touch()
    print(f"wide: {base} ({entries} entries)")


def make_images() -> None:
    base = ROOT / "images"
    base.mkdir(parents=True, exist_ok=True)
    (base / "damaged.png").write_bytes(b"not an image at all")
    (base / "huge-pixels.png").write_bytes(tiny_png(5000, 5001, with_data=False))
    with (base / "too-large.png").open("wb") as f:
        f.write(tiny_png(1, 1, with_data=True))
        f.seek(21 * 1024 * 1024 - 4)
        f.write(b"\x00")
    (base / "images.md").write_text(
        "# Images\n\n"
        "![damaged](damaged.png)\n\n"
        "![huge](huge-pixels.png)\n\n"
        "![large](too-large.png)\n",
        encoding="utf-8",
        newline="\n",
    )
    print(f"images: {base}")


def clean() -> None:
    if not ROOT.exists():
        return
    for child in sorted(ROOT.rglob("*"), reverse=True):
        if child.is_file():
            child.unlink()
        else:
            child.rmdir()
    ROOT.rmdir()
    print(f"removed {ROOT}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--only", default="large,deep,images", help="comma separated: large,deep,wide,images")
    parser.add_argument("--entries", type=int, default=50001, help="entries for the wide sample")
    parser.add_argument("--out", default="", help="write the samples here instead of testdata/samples")
    parser.add_argument("--clean", action="store_true", help="remove the samples and exit")
    args = parser.parse_args()

    global ROOT
    if args.out:
        ROOT = Path(args.out).resolve()

    if args.clean:
        clean()
        return

    wanted = {part.strip() for part in args.only.split(",") if part.strip()}
    ROOT.mkdir(parents=True, exist_ok=True)
    if "large" in wanted:
        make_large()
    if "deep" in wanted:
        make_deep()
    if "wide" in wanted:
        make_wide(args.entries)
    if "images" in wanted:
        make_images()


if __name__ == "__main__":
    main()
