#!/usr/bin/env python3
"""Generate the samples docs/develop/性能基线.md measures with.

Writes outside the repository by default, so the development server's watcher
does not lock them. Samples:

  docs/    20 Markdown files of about 100 KiB each
  tree/    100 folders x 20 Markdown files (2,000 files) for scan timings
  media.md 100 inline formulas, 20 block formulas and 6 Mermaid diagrams

Usage: python scripts/make-perf-samples.py [--out DIR]
"""

import argparse
from pathlib import Path
import os
import tempfile


def paragraph(i: int) -> str:
    body = (
        "This paragraph is ordinary reading material for the performance sample. "
        "It has **bold**, *italic*, `code` and a [link](https://example.com). "
    )
    return body * 6 + f" Paragraph {i}.\n\n"


def make_docs(root: Path) -> None:
    docs = root / "docs"
    docs.mkdir(parents=True, exist_ok=True)
    for i in range(1, 21):
        path = docs / f"note-{i:02d}.md"
        with path.open("w", encoding="utf-8", newline="\n") as f:
            f.write(f"# Note {i:02d}\n\n")
            for p in range(40):
                f.write(paragraph(p))
            f.write("```go\nfunc add(a, b int) int { return a + b }\n```\n\n")
            for p in range(40, 80):
                f.write(paragraph(p))
            f.write("- one\n- two\n- three\n\n")
            for p in range(80, 120):
                f.write(paragraph(p))
        size = path.stat().st_size
        if size < 95 * 1024:
            raise SystemExit(f"{path} is only {size} bytes")
    print(f"docs: {docs} (20 files)")


def make_tree(root: Path) -> None:
    tree = root / "tree"
    tree.mkdir(parents=True, exist_ok=True)
    for d in range(100):
        folder = tree / f"folder-{d:03d}"
        folder.mkdir(parents=True, exist_ok=True)
        for n in range(20):
            (folder / f"note-{n:02d}.md").write_text("# note\n", encoding="utf-8")
    print(f"tree: {tree} (2,000 files)")


def make_media(root: Path) -> None:
    path = root / "media.md"
    with path.open("w", encoding="utf-8", newline="\n") as f:
        f.write("# Media\n\n")
        for i in range(100):
            f.write(f"Inline ${i}^2 + x_{i}$ in a sentence.\n\n")
        for i in range(20):
            f.write(f"$$\n\\sum_{{k=1}}^{{{i + 1}}} k = \\frac{{n(n+1)}}{{2}}\n$$\n\n")
        for i in range(6):
            f.write(
                "```mermaid\nflowchart LR\n  A --> B\n  B --> C\n```\n\n"
            )
        for p in range(60):
            f.write(paragraph(p))
    print(f"media: {path}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--out",
        default=os.path.join(tempfile.gettempdir(), "mile-perf-samples"),
        help="output directory",
    )
    args = parser.parse_args()
    root = Path(args.out).resolve()
    root.mkdir(parents=True, exist_ok=True)
    make_docs(root)
    make_tree(root)
    make_media(root)


if __name__ == "__main__":
    main()
