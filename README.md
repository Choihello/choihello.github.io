# 최광범 · Choihello 포트폴리오

https://choihello.github.io/ — 지금 응답하는 서비스와 도구, 공모전 출품작을 모은 한 장짜리 포트폴리오입니다. 빌드 단계가 없습니다.

```bash
python3 -m http.server 5190   # 그다음 http://localhost:5190 을 엽니다
```

`index.html`을 바로 열어도 보이지만, 웹 글꼴과 "지금 다시 재기" 버튼은 `http://`로 열 때 가장 정확합니다.

## 파일

| 파일 | 내용 |
| --- | --- |
| `index.html` | 내용 전부 (프로젝트 카드, 문구, 링크) |
| `styles.css` | 색·글꼴 토큰은 맨 위 `:root`에 있습니다 |
| `main.js` | 응답 기록 다시 재기(잠든 서버면 한 번 더), 쌓아 둔 기록 막대·요약, 연결 주소 복사 |
| `sky.js` | 첫 화면의 작은 3D 행성 (three.js). 서비스마다 불빛 하나가 떠 있고, 응답이 늦을수록 높이 떠요. 끌어서 돌리고 불빛을 누르면 소개 카드로 이동. 목록 행을 가리키거나 다시 재는 동안에는 그 불빛이 앞으로 오게 돌아요 |
| `scripts/record-pings.mjs` | 응답 기록 쌓기. 응답 기록 목록의 서비스를 두 번씩 재서 `data/pings.json`에 한 줄 더함 (Node 18+, 의존성 없음) |
| `data/pings.json` | 쌓아 둔 응답 기록 (최근 30일, 한 줄이 한 번) |
| `.github/workflows/record-pings.yml` | 하루 한 번(18:23 KST) `record-pings.mjs`를 돌리고 기록을 커밋 |
| `assets/vendor/three-sky.min.js` | three.js r170 (MIT) 중 `sky.js`가 쓰는 것만 묶은 파일 (`scripts/build-three.sh`). 행성 색은 `styles.css`의 `--planet-*`·`--paper`·`--night*` 토큰을 읽어요 |
| `assets/fonts/` | 제목 글꼴 Hahmlet(OFL) 700·800에서 제목에 쓴 글자만 남긴 woff2 (`scripts/subset-fonts.py`) |
| `assets/shots/` | 프로젝트 화면. `이름.webp`(1200px)와 `이름-600.webp` 두 벌 (`scripts/make-shots.py`) |
| `assets/og.jpg` | 링크 공유 미리보기 (1200×630) |

## 어떤 프로젝트를 넣었나

- 3개월 넘게 커밋이 없고 지금 돌아가는 서비스도 없는 저장소, 포크 저장소는 뺐습니다.
- 공모전에 낸 작품은 기간과 상관없이 넣었습니다.
- 소스가 비공개인 프로젝트는 코드 링크 없이 "소스 비공개"로 표시했습니다.

## 응답 기록 쌓기

```bash
node scripts/record-pings.mjs --src mac   # 이 Mac에서 한 번 재서 기록에 더하기
node scripts/record-pings.mjs --dry       # 재기만 하고 기록은 안 바꾸기
```

- 서비스마다 두 번 잽니다. Fly.io 서비스(plan-lint, startup-law-mcp)는 `fly.toml`이
  `min_machines_running = 0`이라 쉬면 멈추고, 첫 요청에 깨어나느라 2~3초가 걸립니다.
  첫 응답이 1.5초보다 늦고 두 번째보다 1초 넘게 느리면 화면에서 ‘잠들어 있다 깨어나며 응답’(노랑)으로 표시합니다.
- 4xx는 서버가 살아 있다는 뜻이라 응답으로 셉니다(startup-law-mcp `/mcp`는 GET에 406). 5xx와 연결 실패는 응답 없음입니다.
- 서비스 목록은 `index.html`의 응답 기록 행(`.ping[data-url]`)에서 읽습니다. 행을 더하거나 빼면 다음 기록부터 반영됩니다.
- `.github/workflows/record-pings.yml`이 하루 한 번(18:23 KST) 재고 기록을 커밋합니다. `"src"`는 어디서 쟀는지(`gha`는 GitHub Actions)입니다.
- GitHub 예약 실행은 정시에 돈다는 보장이 없어서, 화면은 ‘하루에 한 번’을 약속하지 않고
  실제로 잰 횟수와 마지막으로 잰 시각을 보여 줍니다. 더 촘촘히 재려면 바깥 크론이 `workflow_dispatch`를 보내면 됩니다.
- `data/pings.json`을 못 읽으면(파일 없음, `file://`로 열기) 막대 없이 처음 적어 둔 문구가 그대로 보입니다.

## 용량을 지키려고 하는 일

처음엔 사이트 전체가 약 2.1MB였고, 대부분이 화면 사진(JPEG 1.1MB)과 제목 글꼴(구글 글꼴 Hahmlet 약 440KB)이었습니다.

| 고칠 때 | 다시 돌릴 것 | 필요한 것 |
| --- | --- | --- |
| 제목(카드·섹션·원칙 제목, 첫 화면·연락 제목)을 고치거나 더함 | `python3 scripts/subset-fonts.py` | `pip install fonttools brotli` |
| 화면 사진을 새로 넣음 (1200px 너비로 찍기) | `python3 scripts/make-shots.py 사진.png` → `index.html`에 다른 카드처럼 `srcset`·`sizes` 적기 | `pip install pillow` |
| `sky.js`에서 `THREE.새이름`을 씀 | `sh scripts/build-three.sh` | Node·npm |

- 제목 글꼴을 다시 안 만들면 새로 들어간 글자만 대체 글꼴로 보입니다. 본문 글꼴(IBM Plex Sans KR)은 구글 글꼴이 글자 조각을 나눠 보내서 그대로 둡니다.
- 공유 미리보기 `assets/og.jpg`는 SNS가 가장 잘 읽는 JPEG로 둡니다.

## 고칠 때

- 화면 짜임: 첫 화면과 맨 끝 연락 칸은 밤하늘이고, 그 사이 본문은 지평선(`.horizon`) 위로 올라온 밝은 바탕입니다.
  작품은 상자 없이 사진과 글을 나란히 두고, 사진 아래 줄(`.shot__cap`)에 응답 칩과 커밋 수·날짜를 적습니다.
  잰 값(응답 시간·날짜·커밋 수)은 고정폭 글꼴(`--font-mono`)로 씁니다.
- 첫 화면을 고치면 `assets/og.jpg`(1200×630)도 새로 찍으세요. 머리 줄을 빼고 첫 화면 위쪽을 찍은 그림입니다.
- 응답 시간·커밋 수·날짜는 손으로 적은 값입니다. 새로 잰 값으로 바꾸려면 `index.html`에서 `응답 71ms` 같은 문구와
  `record-when`의 시각을 함께 고치세요. 사진 아래 칩과 응답 기록 목록은 같은 `data-id`/`data-for`로 묶여 있습니다.
- 행성 그림은 응답 기록 행의 `data-ms`(응답 시간), `data-short`(이름표에 쓰는 짧은 이름), `data-card`(불빛을 누르면 갈 카드 제목 id)를 읽습니다.
  응답 시간을 고칠 때 `data-ms`도 같이 바꾸세요. WebGL이 안 되는 브라우저에서는 그림만 숨고 목록은 그대로 보입니다.
- `styles.css`·`main.js`·`sky.js`를 고치면 `index.html`에서 그 파일 주소 뒤 `?v=` 값을 바꾸세요. 안 바꾸면 브라우저가 예전 파일을 그대로 써서 화면이 깨질 수 있어요.
- GitHub Pages가 `main` 브랜치 루트를 그대로 내보냅니다. `main`에 올리면 1~2분 뒤 반영됩니다.
- 주소를 바꾸면 `index.html` 위쪽 `og:url`·`og:image`·`canonical`의 절대 주소도 함께 바꾸세요.
