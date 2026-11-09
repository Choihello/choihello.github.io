#!/bin/sh
# sky.js가 쓰는 three.js 부분만 묶어 assets/vendor/three-sky.min.js를 만든다.
# three.js 전체(압축 약 171KB) 대신 쓰는 것만(약 123KB) 받게 하려는 것.
#
# 무엇을 묶을지는 sky.js에 나오는 `THREE.이름`을 읽어서 정한다. sky.js에서 새 이름을 쓰기 시작하면
# 이 스크립트만 다시 돌리면 된다. (npm으로 three와 esbuild를 임시 폴더에 받아 쓰고 지운다.)
#
# 실행: sh scripts/build-three.sh
set -eu
cd "$(dirname "$0")/.."

THREE_VERSION=0.170.0
OUT=assets/vendor/three-sky.min.js

NAMES=$(grep -o 'THREE\.[A-Za-z0-9_]*' sky.js | sed 's/THREE\.//' | sort -u | paste -sd, - | sed 's/,/, /g')
[ -n "$NAMES" ] || { echo "sky.js에서 THREE.이름을 찾지 못했어요" >&2; exit 1; }

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
echo "export { $NAMES } from \"three\";" > "$TMP/entry.js"
(cd "$TMP" && npm init -y >/dev/null && npm install --silent --no-audit --no-fund "three@$THREE_VERSION" esbuild@0.24 >/dev/null)

"$TMP/node_modules/.bin/esbuild" "$TMP/entry.js" --bundle --format=esm --minify \
  --legal-comments=inline --target=es2020 --log-level=warning --outfile="$OUT"

echo "묶은 것: $NAMES"
echo "$OUT $(wc -c < "$OUT" | tr -d ' ') bytes (gzip $(gzip -9c "$OUT" | wc -c | tr -d ' '))"
