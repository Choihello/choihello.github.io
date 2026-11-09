#!/usr/bin/env python3
"""화면 사진을 WebP 두 벌로 만든다: 이름.webp(1200px), 이름-600.webp(600px).

카드 사진은 데스크톱에서 약 600px, 태블릿에서 최대 750px 너비로 보인다.
고해상도 화면은 1200px, 일반 화면은 600px을 받도록 index.html의 srcset·sizes로 고른다.
JPEG 대신 WebP(품질 85)로 바꾸면 같은 화질에서 크기가 약 60% 준다.

필요: pip install pillow
실행: python3 scripts/make-shots.py 사진.jpg [사진2.png ...]
      (결과는 assets/shots/에 저장. 원본은 그대로 둔다)
"""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

OUT = Path(__file__).resolve().parent.parent / "assets" / "shots"
QUALITY = {1200: 85, 600: 82}


def convert(src: Path) -> None:
    image = Image.open(src).convert("RGB")
    for width, quality in QUALITY.items():
        if image.width < width:
            print(f"{src.name}: 너비가 {image.width}px라 {width}px판은 원본 크기로 만들어요")
        resized = image if image.width <= width else image.resize(
            (width, round(image.height * width / image.width)), Image.LANCZOS)
        name = f"{src.stem}.webp" if width == 1200 else f"{src.stem}-{width}.webp"
        dest = OUT / name
        resized.save(dest, "WEBP", quality=quality, method=6)
        print(f"{dest.name}: {resized.width}×{resized.height} · {dest.stat().st_size / 1024:.0f}KB")


def main(args: list[str]) -> int:
    if not args:
        print(__doc__)
        return 1
    OUT.mkdir(parents=True, exist_ok=True)
    for arg in args:
        convert(Path(arg))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
