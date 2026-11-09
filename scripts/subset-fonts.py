#!/usr/bin/env python3
"""제목 글꼴(Hahmlet)에서 이 페이지 제목에 쓰인 글자만 남겨 assets/fonts/에 woff2로 만든다.

구글 글꼴로 받으면 Hahmlet은 가변 글꼴 조각을 통째로 받아서 제목 300자에 약 440KB가 든다.
여기서는 쓰는 굵기(700, 800)만 고정 글꼴로 뽑고, 그 굵기를 쓰는 요소의 글자만 남긴다.

제목(카드 제목·섹션 제목 등)을 고치거나 더하면 이 스크립트를 다시 돌려야 한다.
안 돌리면 새 글자만 대체 글꼴(Apple SD Gothic Neo 등)로 보인다.

필요: pip install fonttools brotli
실행: python3 scripts/subset-fonts.py
"""
from __future__ import annotations

import shutil
import sys
import tempfile
import urllib.request
from html.parser import HTMLParser
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = Path(__file__).resolve().parent.parent
HTML = ROOT / "index.html"
OUT = ROOT / "assets" / "fonts"
SOURCE_URL = "https://github.com/google/fonts/raw/main/ofl/hahmlet/Hahmlet%5Bwght%5D.ttf"
LICENSE_URL = "https://github.com/google/fonts/raw/main/ofl/hahmlet/OFL.txt"

# styles.css에서 font-family: var(--font-display)를 쓰는 클래스와 그 굵기.
# styles.css에서 제목 글꼴을 쓰는 곳이 바뀌면 여기도 맞춘다.
WEIGHT_OF_CLASS = {
    "brand__name": 700,
    "record__title": 700,
    "section-head__title": 700,
    "card__title": 700,
    "principle__title": 700,
    "tools-used__title": 700,
    "hero__title": 800,
    "contact__title": 800,
}

# 영문·숫자·문장부호는 제목을 고쳐도 빠지지 않게 늘 넣는다.
ALWAYS = "".join(chr(c) for c in range(0x20, 0x7F)) + "·—–‘’“”…↗→←× "

VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"}


class TitleText(HTMLParser):
    """제목 글꼴 클래스 안에 있는 글자를 굵기별로 모은다."""

    def __init__(self) -> None:
        super().__init__()
        self.stack: list[int | None] = []
        self.chars: dict[int, set[str]] = {700: set(), 800: set()}

    def handle_starttag(self, tag, attrs):
        classes = (dict(attrs).get("class") or "").split()
        weight = next((WEIGHT_OF_CLASS[c] for c in classes if c in WEIGHT_OF_CLASS), None)
        if weight is None and self.stack:
            weight = self.stack[-1]
        if tag not in VOID:
            self.stack.append(weight)

    def handle_endtag(self, tag):
        if tag not in VOID and self.stack:
            self.stack.pop()

    def handle_data(self, data):
        weight = self.stack[-1] if self.stack else None
        if weight:
            self.chars[weight].update(ch for ch in data if not ch.isspace())


def fetch(url: str, dest: Path) -> Path:
    if not dest.exists():
        print(f"받는 중: {url}")
        with urllib.request.urlopen(url) as res, open(dest, "wb") as fh:
            shutil.copyfileobj(res, fh)
    return dest


def build(source: Path, weight: int, text: str, dest: Path) -> None:
    font = TTFont(source, recalcTimestamp=False)  # 같은 글자면 같은 파일이 나오게
    font = instancer.instantiateVariableFont(font, {"wght": weight})
    options = subset.Options()
    options.flavor = "woff2"
    options.hinting = False
    options.desubroutinize = True
    options.layout_features = ["*"]
    options.name_IDs = ["*"]
    subsetter = subset.Subsetter(options)
    subsetter.populate(text=text)
    subsetter.subset(font)
    font.flavor = "woff2"
    font.save(dest)


def main() -> int:
    parser = TitleText()
    parser.feed(HTML.read_text(encoding="utf-8"))
    cache = Path(tempfile.gettempdir()) / "portfolio-fonts"
    cache.mkdir(exist_ok=True)
    source = fetch(SOURCE_URL, cache / "Hahmlet[wght].ttf")

    OUT.mkdir(parents=True, exist_ok=True)
    fetch(LICENSE_URL, OUT / "OFL.txt")
    for weight in (700, 800):
        text = "".join(sorted(parser.chars[weight] | set(ALWAYS)))
        hangul = sum(1 for ch in text if "가" <= ch <= "힣")
        dest = OUT / f"hahmlet-{weight}.woff2"
        build(source, weight, text, dest)
        print(f"{dest.relative_to(ROOT)}: 한글 {hangul}자 · {dest.stat().st_size / 1024:.1f}KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
