// 응답 기록: 버튼을 누르면 각 서비스에 요청을 보내 응답 시간을 잰다.
// no-cors 요청이라 상태 코드는 읽을 수 없고, 서버가 무엇이든 돌려주면 '응답'으로 센다.

const TIMEOUT_MS = 12000;
// 첫 응답이 이보다 늦고, 다시 잰 값보다 WAKE_GAP 넘게 느리면 '잠들어 있다 깨어남'으로 본다.
// Fly.io 서비스는 쉬면 멈췄다가 첫 요청에 깨어나서 2~3초가 걸린다.
const WAKE_MS = 1500;
const WAKE_GAP = 1000;
const LOG_TICKS = 30; // 하루 한 번 재고 30일 치를 남기니 한 달이 꽉 찬다

function formatMs(ms) {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}초`;
}

// 마지막 글자에 받침이 있으면 withBatchim. 영문은 l·m·n·r로 끝날 때(엘·엠·엔·알) 받침으로 본다.
// 요약 문장 속 서비스 이름이 하이픈(plan-lint)에서 줄바꿈되지 않게 묶는다.
function nobr(text) {
  const escaped = text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  return `<span class="nobr">${escaped}</span>`;
}

function josa(word, withBatchim, without) {
  const ch = word.trim().slice(-1);
  const code = ch.charCodeAt(0);
  const batchim = code >= 0xac00 && code <= 0xd7a3 ? (code - 0xac00) % 28 !== 0 : /[lmnr]/i.test(ch);
  return word + (batchim ? withBatchim : without);
}

function nameWithJosa(name, withBatchim, without) {
  return nobr(name) + josa(name, withBatchim, without).slice(name.length);
}

// ms는 응답했을 때만 넘긴다. 행의 data-ms에 남기고, 응답 거리 그림(sky.js)에 알린다.
function setState(id, state, text, ms) {
  const targets = document.querySelectorAll(
    `.ping[data-id="${id}"] .js-status, .js-status[data-for="${id}"]`
  );
  targets.forEach((el) => {
    el.dataset.state = state;
    el.textContent = text;
  });
  const row = document.querySelector(`.ping[data-id="${id}"]`);
  if (row && ms != null) row.dataset.ms = String(ms);
  document.dispatchEvent(new CustomEvent("ping:update", { detail: { id, state, ms } }));
}

async function ping(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const sep = url.includes("?") ? "&" : "?";
  const started = performance.now();
  try {
    await fetch(`${url}${sep}_=${Date.now()}`, {
      mode: "no-cors",
      cache: "no-store",
      signal: controller.signal,
    });
    return { ok: true, ms: Math.round(performance.now() - started) };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}

function nowLabel() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())} 이 브라우저`;
}

function initRecord() {
  const button = document.getElementById("measure");
  const summary = document.getElementById("record-summary");
  const when = document.getElementById("record-when");
  const rows = [...document.querySelectorAll(".ping[data-url]")];
  if (!button || rows.length === 0) return;

  button.addEventListener("click", async () => {
    button.disabled = true;
    button.textContent = "재는 중…";
    rows.forEach((row) => setState(row.dataset.id, "wait", "대기"));

    let okCount = 0;
    const woke = [];
    // 한 곳씩 차례로 잰다. 동시에 보내면 서로의 시간이 섞인다.
    for (const [i, row] of rows.entries()) {
      const id = row.dataset.id;
      const name = row.querySelector(".ping__name").textContent;
      const step = `재는 중 · ${i + 1}/${rows.length} ${name}`;
      summary.textContent = step;
      setState(id, "run", "재는 중");
      let result = await ping(row.dataset.url);
      // 늦거나 응답이 없으면 한 번 더 잰다. 잠들어 있던 서버라면 두 번째는 깨어난 뒤의 시간이다.
      if (!result.ok || result.ms > WAKE_MS) {
        summary.textContent = `${step} · ${result.ok ? `첫 응답이 ${formatMs(result.ms)} 걸려서` : "응답이 없어서"} 한 번 더 재요`;
        setState(id, "run", "다시 재는 중");
        const again = await ping(row.dataset.url);
        if (again.ok) {
          if (!result.ok || result.ms - again.ms > WAKE_GAP) woke.push({ name, first: result.ok ? result.ms : null });
          result = again;
        }
      }
      if (result.ok) {
        okCount += 1;
        setState(id, "ok", `응답 ${formatMs(result.ms)}`, result.ms);
      } else {
        setState(id, "fail", "응답 없음");
      }
    }

    when.textContent = nowLabel();
    let text =
      okCount === rows.length
        ? `방금 이 브라우저에서 쟀어요. ${rows.length}곳 모두 응답했어요.`
        : `방금 이 브라우저에서 쟀어요. ${rows.length}곳 중 ${okCount}곳이 응답했어요. 응답 없는 곳은 잠시 뒤 다시 재 보세요.`;
    if (woke.length) {
      const list = woke.map((w) => `${nobr(w.name)} 첫 응답 ${w.first == null ? "없음" : formatMs(w.first)}`).join(", ");
      text += ` 잠들어 있던 서버는 깨운 뒤 한 번 더 쟀어요(${list}). 목록에는 두 번째 값을 적었어요.`;
    }
    summary.innerHTML = text;
    button.disabled = false;
    button.textContent = "다시 재기";
  });
}

// ── 쌓아 둔 기록 (data/pings.json) ──
// GitHub Actions가 scripts/record-pings.mjs로 서비스마다 두 번씩 재서 한 줄씩 쌓는다.
// 한 줄: {t, src, r: {id: [다시 잰 ms, 첫 ms, 상태 코드]}}. 파일을 못 읽으면 처음 적어 둔 문구를 그대로 둔다.

function classify(entry) {
  if (!entry) return "none";
  const [ms, first, code] = entry;
  if (ms == null || (code != null && code >= 500)) return "fail";
  if (first == null || (first > WAKE_MS && first - ms > WAKE_GAP)) return "wake";
  return "ok";
}

function dateLabel(t) {
  const d = new Date(t);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function agoLabel(t) {
  const min = Math.round((Date.now() - Date.parse(t)) / 60000);
  if (min < 2) return "방금";
  if (min < 60) return `${min}분 전`;
  const hours = Math.round(min / 60);
  return hours < 48 ? `${hours}시간 전` : `${Math.round(hours / 24)}일 전`;
}

const KIND_TEXT = { ok: "응답", wake: "잠들어 있다 깨어나며 응답", fail: "응답 없음" };

function tickTitle(run, entry, kind) {
  let text = `${dateLabel(run.t)} · ${KIND_TEXT[kind]}`;
  if (kind === "wake") text += entry[1] == null ? " (첫 요청은 응답 없음)" : ` (첫 응답 ${formatMs(entry[1])})`;
  return text;
}

function historySummary(runs, stats) {
  const first = runs[0];
  const span = Date.now() - Date.parse(first.t) > 29.5 * 86400000
    ? "지난 30일 동안"
    : `${new Date(first.t).getMonth() + 1}월 ${new Date(first.t).getDate()}일부터`;
  const missed = stats.filter((s) => s.fail > 0);
  let text = `${span} ${runs.length}번 쟀는데, `;
  if (missed.length === 0) {
    text += `${stats.length}곳 모두 매번 응답했어요.`;
  } else {
    text += `${stats.length}곳 중 ${stats.length - missed.length}곳은 매번 응답했어요.`;
    for (const s of missed.slice(0, 2)) text += ` ${nameWithJosa(s.name, "은", "는")} ${s.seen}번 중 ${s.fail}번 응답이 없었어요.`;
    if (missed.length > 2) text += ` 나머지 ${missed.length - 2}곳도 응답이 없던 때가 있어요.`;
  }
  const sleepy = stats.filter((s) => s.wake > 0);
  if (sleepy.length === 1) {
    text += ` ${nameWithJosa(sleepy[0].name, "은", "는")} ${sleepy[0].seen}번 중 ${sleepy[0].wake}번 잠들어 있다가 깨어났어요.`;
  } else if (sleepy.length > 1) {
    const names = sleepy.map((s) => s.name);
    text += ` ${names.slice(0, -1).map(nobr).join(", ")}, ${nameWithJosa(names.at(-1), "은", "는")} 잠들어 있다가 깨어난 때가 있어요.`;
  }
  return `${text} 버튼을 누르면 지금 이 브라우저에서 다시 재요.`;
}

function keyHTML(kind, label) {
  return `<span class="nobr"><i class="log-key" data-k="${kind}" aria-hidden="true"></i>${label}</span>`;
}

async function initHistory() {
  const list = document.querySelector(".record__list");
  const summary = document.getElementById("record-summary");
  const fine = document.querySelector(".record__fine");
  const button = document.getElementById("measure");
  if (!list || !summary) return;

  let runs;
  try {
    const res = await fetch("data/pings.json", { cache: "no-cache" });
    if (!res.ok) return;
    runs = (await res.json()).runs;
  } catch {
    return;
  }
  if (!Array.isArray(runs) || runs.length === 0) return;
  runs.sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
  const recent = runs.slice(-LOG_TICKS);

  const stats = [];
  for (const row of list.querySelectorAll(".ping[data-id]")) {
    const id = row.dataset.id;
    const name = row.querySelector(".ping__name").textContent;
    const s = { name, seen: 0, ok: 0, wake: 0, fail: 0 };
    for (const run of runs) {
      const kind = classify(run.r?.[id]);
      if (kind === "none") continue;
      s.seen += 1;
      s[kind] += 1;
    }
    if (s.seen === 0) continue;
    stats.push(s);

    const log = document.createElement("span");
    log.className = "ping__log";
    log.setAttribute("role", "img");
    log.setAttribute("aria-label",
      `쌓아 둔 기록 ${s.seen}번 중 ${s.seen - s.fail}번 응답${s.wake ? `, 그중 ${s.wake}번은 깨어나며 응답` : ""}`);
    // 아직 기록이 모자란 칸은 비워 둔다. 오른쪽 끝이 가장 최근이다.
    for (let i = 0; i < LOG_TICKS - recent.length; i++) {
      const tick = document.createElement("i");
      tick.dataset.k = "none";
      log.append(tick);
    }
    for (const run of recent) {
      const entry = run.r?.[id];
      const kind = classify(entry);
      const tick = document.createElement("i");
      tick.dataset.k = kind;
      if (kind !== "none") tick.title = tickTitle(run, entry, kind);
      log.append(tick);
    }
    row.querySelector(".ping__status").before(log);
  }
  if (stats.length === 0) return;

  list.classList.add("has-log");
  // 방문자가 이미 다시 재고 있으면 그 결과 문구를 덮지 않는다.
  if (!button || !button.disabled) summary.innerHTML = historySummary(runs, stats);
  if (fine) {
    const last = runs.at(-1);
    const scheduled = runs.some((run) => run.src === "gha") ? "GitHub이 하루 한 번 재고, " : "";
    fine.innerHTML =
      `<span class="record__key">${keyHTML("ok", "응답")} ${keyHTML("wake", "깨어나며 응답")} ${keyHTML("fail", "응답 없음")}</span>` +
      `막대 하나가 한 번 잰 기록이에요(오른쪽이 최근). ${scheduled}마지막으로 잰 건 ${agoLabel(last.t)}이에요. ` +
      `서버가 무엇이든 답하면 응답으로 치지만, 이 기록에서는 5xx 오류를 응답 없음으로 봐요.`;
  }
}

function initCopy() {
  document.querySelectorAll("[data-copy]").forEach((button) => {
    const label = button.textContent;
    button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(button.dataset.copy);
        button.textContent = "복사했어요";
      } catch {
        button.textContent = "복사 안 됨 · 주소를 직접 선택하세요";
      }
      setTimeout(() => { button.textContent = label; }, 2200);
    });
  });
}

initRecord();
initHistory();
initCopy();
