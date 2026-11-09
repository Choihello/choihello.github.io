#!/usr/bin/env node
// 응답 기록 쌓기: index.html의 응답 기록 목록(.ping[data-url])에 있는 서비스를 한 곳씩 두 번 재서
// data/pings.json에 한 줄을 더한다. GitHub Actions(.github/workflows/record-pings.yml)가 돌린다.
//
// 두 번 재는 이유: Fly.io 서비스(plan-lint, startup-law-mcp)는 아무도 안 쓰면 잠든다
// (fly.toml auto_stop_machines, min_machines_running = 0). 첫 요청은 깨우는 시간까지 포함하고,
// 두 번째 요청이 깨어난 뒤의 응답 시간이다. 둘 다 남겨서 화면(main.js)이 '깨어남'을 가려낸다.
//
// 한 줄 형식: {"t": 잰 시각(UTC), "src": 어디서 쟀는지, "r": {서비스 id: [두 번째 ms, 첫 번째 ms, 상태 코드]}}
//   - 첫 번째가 실패하고 두 번째만 응답하면 첫 번째 ms는 null (아주 오래 깨어난 경우)
//   - 둘 다 실패하면 [null, null, 마지막 상태 코드 또는 null]
//   - 상태 코드 5xx는 응답 없음으로 본다. 4xx는 서버가 살아 있다는 뜻이라 응답으로 센다
//     (startup-law-mcp의 /mcp는 GET에 406을 돌려준다).
//
// 실행: node scripts/record-pings.mjs [--src mac] [--dry]

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HTML = join(ROOT, "index.html");
const DATA = join(ROOT, "data", "pings.json");

const KEEP_DAYS = 30;
const FIRST_TIMEOUT = 20000; // 잠든 서버가 깨어나는 시간까지 기다린다
const SECOND_TIMEOUT = 15000;
const USER_AGENT = "choihello-portfolio-ping/1 (+https://github.com/Choihello)";

const args = process.argv.slice(2);
const src = args.includes("--src") ? args[args.indexOf("--src") + 1] : process.env.GITHUB_ACTIONS ? "gha" : "local";
const dry = args.includes("--dry");

async function readServices() {
  const html = await readFile(HTML, "utf8");
  const services = [];
  for (const [tag] of html.matchAll(/<li class="ping"[^>]*>/g)) {
    const id = tag.match(/data-id="([^"]+)"/)?.[1];
    const url = tag.match(/data-url="([^"]+)"/)?.[1];
    if (id && url) services.push({ id, url: url.replaceAll("&amp;", "&") });
  }
  if (services.length === 0) throw new Error("index.html에서 응답 기록 목록(.ping[data-url])을 찾지 못했어요");
  return services;
}

async function hit(url, timeout) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const sep = url.includes("?") ? "&" : "?";
  const started = performance.now();
  try {
    const res = await fetch(`${url}${sep}_=${Date.now()}`, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "user-agent": USER_AGENT, "cache-control": "no-cache" },
    });
    // 응답 머리가 온 순간까지가 응답 시간이다. 본문은 받지 않는다.
    const ms = Math.round(performance.now() - started);
    res.body?.cancel().catch(() => {});
    return { ok: res.status < 500, ms, code: res.status };
  } catch {
    return { ok: false, ms: null, code: null };
  } finally {
    clearTimeout(timer);
  }
}

async function measure({ url }) {
  const first = await hit(url, FIRST_TIMEOUT);
  const second = await hit(url, SECOND_TIMEOUT);
  if (second.ok) return [second.ms, first.ok ? first.ms : null, second.code];
  if (first.ok) return [first.ms, first.ms, first.code];
  return [null, null, second.code ?? first.code];
}

async function readData() {
  try {
    const data = JSON.parse(await readFile(DATA, "utf8"));
    if (Array.isArray(data.runs)) return data;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return { v: 1, runs: [] };
}

// 한 줄에 한 번씩 적어서 git diff가 읽기 쉽게 한다.
function serialize(data) {
  const lines = data.runs.map((run) => JSON.stringify(run));
  return `{"v":${data.v},"keepDays":${KEEP_DAYS},"runs":[\n${lines.join(",\n")}\n]}\n`;
}

const services = await readServices();
const r = {};
// 한 곳씩 차례로 잰다. 동시에 보내면 서로의 시간이 섞인다.
for (const service of services) {
  r[service.id] = await measure(service);
  const [ms, first, code] = r[service.id];
  console.log(`${service.id.padEnd(22)} ${ms == null ? "응답 없음" : `${ms}ms`}  (첫 요청 ${first ?? "-"}ms, ${code ?? "연결 실패"})`);
}

const run = { t: new Date().toISOString().replace(/\.\d+Z$/, "Z"), src, r };
const data = await readData();
const cutoff = Date.now() - KEEP_DAYS * 86400000;
data.runs = [...data.runs.filter((old) => Date.parse(old.t) >= cutoff), run];

if (dry) {
  console.log(JSON.stringify(run));
} else {
  await mkdir(dirname(DATA), { recursive: true });
  await writeFile(DATA, serialize(data));
  console.log(`data/pings.json에 기록했어요 · 모두 ${data.runs.length}번`);
}
