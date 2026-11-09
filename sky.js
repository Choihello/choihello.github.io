// 응답 거리: 응답 기록의 서비스들을 기울어진 원판 위 별로 그린다(three.js).
// 가운데가 재는 곳이고, 가운데서 멀수록 늦게 응답한 곳이다. 로그 눈금이라 50→100ms와 100→200ms 간격이 같다.
// 진짜 내용은 아래 목록이고 이 그림은 같은 값을 보여 주는 보조 장치라 스크린 리더에는 숨긴다(aria-hidden).
// "지금 다시 재기"를 누르면 main.js가 보내는 ping:update 이벤트를 받아 별을 옮긴다.

const figure = document.getElementById("sky");
const stage = figure?.querySelector("[data-sky-stage]");
const rows = [...document.querySelectorAll(".ping[data-id]")];
const reducedQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

const MIN_MS = 10; // 원판 한가운데에 해당하는 시간(빠른 서비스도 가운데에 몰리지 않게)
const SCALE_STEPS = [150, 300, 500, 1000, 2000, 5000, 12000]; // 바깥 고리: 가장 느린 응답이 들어가는 가장 작은 값
const RING_MS = [20, 50, 100, 150, 200, 300, 500, 1000, 2000, 5000, 12000];
const NICE_RINGS = [20, 50, 100, 200, 500, 1000, 2000, 5000]; // 바깥 고리 안쪽에 그릴 후보(어림하기 쉬운 값)
const FAIL_R = 1.13; // 응답 없음은 바깥 고리 바로 밖 점선 위
const AUTO_SPIN = 0.045; // 가만히 있을 때 도는 속도(rad/s)
const FILL_X = 0.84; // 바깥 고리가 차지할 화면 너비 비율
const FILL_Y = 0.8;

function hasWebGL() {
  try {
    const c = document.createElement("canvas");
    return Boolean(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

function msLabel(ms) {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${Number((ms / 1000).toFixed(1))}초`;
}

function hide() {
  if (figure) figure.hidden = true;
}

if (figure && stage && rows.length > 0 && hasWebGL()) {
  init().catch(hide);
} else {
  hide();
}

async function init() {
  const THREE = await import("./assets/vendor/three.module.min.js");

  // 색은 styles.css의 토큰을 그대로 쓴다.
  const css = getComputedStyle(document.documentElement);
  const token = (name, fallback) => new THREE.Color(css.getPropertyValue(name).trim() || fallback);
  const COLOR = {
    ok: token("--signal-bright", "#3DDC97"),
    run: token("--star", "#F1B52E"),
    wait: token("--night-muted", "#A9A5C4"),
    fail: token("--fail-bright", "#FF9B7A"),
    line: token("--night-muted", "#A9A5C4"),
    text: token("--night-text", "#E9E7F5"),
  };

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  // 캔버스는 무대 크기를 따라가기만 하고 무대를 키우지 않게 한다.
  // (예전 styles.css가 캐시에 남아 무대 높이가 정해지지 않으면, 캔버스가 무대를 키우고
  //  무대가 다시 캔버스를 키우는 고리가 생겨 페이지가 끝없이 길어졌다.)
  Object.assign(renderer.domElement.style, { position: "absolute", inset: "0", width: "100%", height: "100%", display: "block" });
  if (getComputedStyle(stage).position === "static") stage.style.position = "relative";
  if (stage.clientHeight < 40 || getComputedStyle(stage).aspectRatio === "auto") stage.style.aspectRatio = "16 / 9";
  stage.prepend(renderer.domElement);

  const labelLayer = document.createElement("div");
  labelLayer.className = "sky__labels";
  stage.append(labelLayer);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 16 / 9, 0.1, 60);
  const disk = new THREE.Group();
  scene.add(disk);

  // ── 별빛 텍스처 ──
  const glow = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d");
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, "rgba(255,255,255,1)");
    grd.addColorStop(0.14, "rgba(255,255,255,0.9)");
    grd.addColorStop(0.32, "rgba(255,255,255,0.3)");
    grd.addColorStop(0.62, "rgba(255,255,255,0.07)");
    grd.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  })();

  // ── 멀리 있는 별가루: 돌릴 때 깊이가 느껴지게, 원판보다 느리게 돈다 ──
  const dust = (() => {
    const n = 240;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i += 1) {
      const r = 2.4 + Math.random() * 4.5;
      const u = Math.random() * 2 - 1;
      const t = Math.random() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      pos.set([r * s * Math.cos(t), r * u, r * s * Math.sin(t)], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color: COLOR.text, size: 1.4, sizeAttenuation: false,
      transparent: true, opacity: 0.36, depthWrite: false,
    });
    return new THREE.Points(geo, mat);
  })();
  scene.add(dust);

  // ── 눈금 고리 ──
  const circle = (radius) => {
    const pts = [];
    for (let i = 0; i < 160; i += 1) {
      const a = (i / 160) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius));
    }
    return new THREE.BufferGeometry().setFromPoints(pts);
  };
  const unitCircle = circle(1);

  const rings = RING_MS.map((ms) => {
    const mat = new THREE.LineBasicMaterial({ color: COLOR.line, transparent: true, opacity: 0, depthWrite: false });
    const line = new THREE.LineLoop(unitCircle, mat);
    disk.add(line);
    const label = document.createElement("span");
    label.className = "sky__label sky__label--ring";
    label.textContent = msLabel(ms);
    labelLayer.append(label);
    return { ms, line, label, opacity: 0, r: 0, w: 0, h: 0 };
  });

  const failRing = (() => {
    const mat = new THREE.LineDashedMaterial({
      color: COLOR.fail, dashSize: 0.035, gapSize: 0.035,
      transparent: true, opacity: 0, depthWrite: false,
    });
    const line = new THREE.LineLoop(circle(FAIL_R), mat);
    line.computeLineDistances();
    disk.add(line);
    const label = document.createElement("span");
    label.className = "sky__label sky__label--ring sky__label--fail";
    label.textContent = "응답 없음";
    labelLayer.append(label);
    return { line, label, opacity: 0, w: 0, h: 0 };
  })();

  // ── 가운데: 재는 곳 ──
  const center = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glow, color: COLOR.text, transparent: true, depthWrite: false, opacity: 0.9,
  }));
  center.scale.setScalar(0.11);
  disk.add(center);

  // ── 서비스 별 ──
  const spokeGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0, 0)]);
  const stars = rows.map((row, i) => {
    const status = row.querySelector(".js-status");
    const angle = 0.2 + (i * Math.PI * 2) / rows.length;
    const state = status?.dataset.state || "ok";
    const ms = Number(row.dataset.ms) || null;
    const tint = (COLOR[state] || COLOR.ok).clone();

    const group = new THREE.Group();
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: tint.clone(), transparent: true, depthWrite: false }));
    const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xffffff, transparent: true, depthWrite: false, opacity: 0.85 }));
    group.add(halo, core);
    disk.add(group);

    const spoke = new THREE.Line(spokeGeo, new THREE.LineBasicMaterial({
      color: tint.clone(), transparent: true, opacity: 0.2, depthWrite: false,
    }));
    spoke.rotation.y = -angle; // (1,0,0)을 Y축으로 -angle 돌리면 (cos, 0, sin) 방향
    spoke.scale.x = 0.0001;
    disk.add(spoke);

    const pulse = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: COLOR.run, transparent: true, depthWrite: false, opacity: 0 }));
    pulse.scale.setScalar(0.15);
    pulse.visible = false;
    disk.add(pulse);

    const label = document.createElement("span");
    label.className = "sky__label";
    const name = document.createElement("span");
    name.className = "sky__name";
    name.textContent = row.dataset.short || row.querySelector(".ping__name")?.textContent || row.dataset.id;
    const value = document.createElement("span");
    value.className = "sky__ms";
    label.append(name, value);
    labelLayer.append(label);

    return {
      id: row.dataset.id, row, card: row.dataset.card, angle, state, ms,
      r: 0, rTarget: 0, delay: 0.15 + i * 0.09, runStart: 0, bump: 0,
      phase: Math.random() * Math.PI * 2,
      color: tint, group, halo, core, spoke, pulse, label, value,
      sx: -999, sy: -999, w: 0, h: 0, dirty: true, wasHot: false,
    };
  });
  const byId = new Map(stars.map((s) => [s.id, s]));

  function setValueText(s) {
    if (s.state === "fail") s.value.textContent = "응답 없음";
    else if (s.state === "run") s.value.textContent = "재는 중";
    else if (s.state === "wait") s.value.textContent = "대기";
    else s.value.textContent = s.ms ? msLabel(s.ms) : "";
    s.label.dataset.state = s.state;
    s.dirty = true;
  }
  stars.forEach(setValueText);

  // ── 눈금: 가장 느린 응답에 맞춰 바깥 고리를 고른다 ──
  const log2 = Math.log2;
  function targetOuter() {
    let max = 0;
    for (const s of stars) if (s.ms && s.state !== "fail") max = Math.max(max, s.ms);
    return SCALE_STEPS.find((step) => step >= max * 1.05) ?? SCALE_STEPS[SCALE_STEPS.length - 1];
  }
  let outerLog = log2(targetOuter());
  // 그릴 고리: 바깥 고리 + 안쪽 후보 중 서로 너무 붙지 않는 것(전체 폭의 1/5 이상 떨어진 것)
  function ringsFor(outer) {
    const span = log2(outer / MIN_MS);
    const minGap = Math.max(0.55, span / 5);
    const keep = [outer];
    for (const ms of [...NICE_RINGS].reverse()) {
      if (ms < outer && log2(keep[keep.length - 1] / ms) >= minGap) keep.push(ms);
    }
    return new Set(keep);
  }
  const radiusFor = (ms) => {
    const t = (log2(Math.max(ms, MIN_MS)) - log2(MIN_MS)) / (outerLog - log2(MIN_MS));
    return Math.min(Math.max(t, 0.05), 1.06);
  };

  // ── 시점: 바깥 고리가 화면을 알맞게 채우도록 거리를 재서 맞춘다 ──
  let yaw = 0;
  let yawVel = AUTO_SPIN;
  let elev = 0.62; // 원판 위로 카메라가 올라간 각
  const ELEV_MIN = 0.22;
  const ELEV_MAX = 1.4;
  let width = 1;
  let height = 1;

  function resize() {
    width = Math.max(1, stage.clientWidth);
    height = Math.max(1, stage.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  const fitPoints = Array.from({ length: 48 }, (_, i) => {
    const a = (i / 48) * Math.PI * 2;
    return new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
  });
  const probe = new THREE.Vector3();
  function placeCamera() {
    camera.clearViewOffset();
    const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    let d = Math.max(1 / (tanV * camera.aspect), Math.sin(elev) / tanV) + 0.5;
    let minY = 0;
    let maxY = 0;
    for (let k = 0; k < 4; k += 1) {
      camera.position.set(0, d * Math.sin(elev), d * Math.cos(elev));
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld();
      let maxX = 0;
      minY = Infinity;
      maxY = -Infinity;
      for (const p of fitPoints) {
        probe.copy(p).project(camera);
        maxX = Math.max(maxX, Math.abs(probe.x));
        minY = Math.min(minY, probe.y);
        maxY = Math.max(maxY, probe.y);
      }
      d *= Math.max(maxX / FILL_X, (maxY - minY) / 2 / FILL_Y);
    }
    // 원근 때문에 가까운 쪽이 커 보여 아래로 처진다. 화면 가운데로 올린다.
    const yc = (minY + maxY) / 2;
    camera.setViewOffset(width, height, 0, -yc * height * 0.5, width, height);
  }

  // ── 끌기·가리키기 ──
  let dragging = false;
  let pointerInside = false;
  let lastX = 0;
  let lastY = 0;
  let lastT = 0;
  let moved = 0;
  let resumeAt = 0;
  let canvasHot = null; // 그림에서 가리킨 별
  let rowHot = null; // 목록에서 가리킨 행

  function pick(x, y) {
    let best = null;
    let bestD = 22;
    for (const s of stars) {
      const d = Math.hypot(s.sx - x, s.sy - y);
      if (d < bestD) { bestD = d; best = s; }
    }
    return best;
  }

  function setCanvasHot(s) {
    if (canvasHot === s) return;
    canvasHot?.row.classList.remove("is-hot");
    canvasHot = s;
    canvasHot?.row.classList.add("is-hot");
    stage.classList.toggle("is-pointing", Boolean(s));
  }

  function localXY(e) {
    const rect = stage.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  stage.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    dragging = true;
    moved = 0;
    lastX = e.clientX;
    lastY = e.clientY;
    lastT = performance.now();
    yawVel = 0;
    stage.setPointerCapture(e.pointerId);
    stage.classList.add("is-dragging");
  });

  stage.addEventListener("pointermove", (e) => {
    pointerInside = true;
    if (dragging) {
      const now = performance.now();
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      const dt = Math.max(1, now - lastT) / 1000;
      moved += Math.abs(dx) + Math.abs(dy);
      yaw += dx * 0.009;
      yawVel = (dx * 0.009) / dt;
      elev = Math.min(ELEV_MAX, Math.max(ELEV_MIN, elev + dy * 0.006));
      lastX = e.clientX;
      lastY = e.clientY;
      lastT = now;
      if (moved > 6) setCanvasHot(null);
      return;
    }
    const [x, y] = localXY(e);
    setCanvasHot(pick(x, y));
  });

  function endDrag(e, cancelled) {
    if (!dragging) return;
    dragging = false;
    stage.classList.remove("is-dragging");
    if (stage.hasPointerCapture?.(e.pointerId)) stage.releasePointerCapture(e.pointerId);
    resumeAt = performance.now() + 2500;
    if (reducedQuery.matches || performance.now() - lastT > 80) yawVel = 0; // 멈춘 뒤 놓으면 관성 없음
    yawVel = Math.max(-3, Math.min(3, yawVel));

    // 거의 움직이지 않고 놓았으면 누른 것으로 본다: 그 서비스 소개 카드로 간다.
    if (!cancelled && moved <= 6) {
      const [x, y] = localXY(e);
      const s = pick(x, y);
      const target = s?.card && document.getElementById(s.card)?.closest("article");
      if (target) target.scrollIntoView({ behavior: reducedQuery.matches ? "auto" : "smooth", block: "start" });
    }
  }
  stage.addEventListener("pointerup", (e) => endDrag(e, false));
  stage.addEventListener("pointercancel", (e) => endDrag(e, true));
  stage.addEventListener("pointerleave", () => {
    pointerInside = false;
    if (!dragging) setCanvasHot(null);
  });

  for (const s of stars) {
    s.row.addEventListener("pointerenter", () => { rowHot = s; wake(); });
    s.row.addEventListener("pointerleave", () => { if (rowHot === s) rowHot = null; wake(); });
  }

  // ── 다시 재기 결과 받기 ──
  document.addEventListener("ping:update", (e) => {
    const s = byId.get(e.detail?.id);
    if (!s) return;
    s.state = e.detail.state;
    if (e.detail.ms != null) s.ms = e.detail.ms;
    if (s.state === "run") s.runStart = performance.now();
    if (s.state === "ok" || s.state === "fail") s.bump = 1;
    setValueText(s);
    wake();
  });

  // ── 그리기 ──
  const world = new THREE.Vector3();
  const ringPoint = new THREE.Vector3();
  function project(v) {
    probe.copy(v).project(camera);
    return [(probe.x + 1) * 0.5 * width, (1 - probe.y) * 0.5 * height];
  }
  const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

  const startedAt = performance.now();
  let lastFrame = startedAt;
  let raf = 0;
  let idleFrames = 0;
  let labelsMeasured = false;

  function frame(now) {
    raf = 0;
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;
    const reduced = reducedQuery.matches;
    const ease = (rate) => (reduced ? 1 : 1 - Math.exp(-dt * rate));
    const t = now / 1000;
    let busy = dragging || !reduced; // 동작 줄이기가 꺼져 있으면 늘 천천히 돌고 반짝인다

    // 회전: 가만히 있으면 천천히 돌고, 놓으면 관성으로 돌다가 원래 속도로 돌아온다.
    if (!dragging) {
      const spinTarget = reduced || pointerInside || now < resumeAt ? 0 : AUTO_SPIN;
      yawVel += (spinTarget - yawVel) * (reduced ? 1 : 1 - Math.exp(-dt * 1.6));
      if (Math.abs(yawVel) < 1e-4) yawVel = 0;
      yaw += yawVel * dt;
    }
    disk.rotation.y = yaw;
    dust.rotation.y = yaw * 0.3;
    placeCamera();

    // 눈금
    const goal = log2(targetOuter());
    outerLog += (goal - outerLog) * ease(4);
    if (Math.abs(goal - outerLog) > 4e-3) busy = true;
    else outerLog = goal;
    const outerMs = Math.round(2 ** goal);
    const shown = ringsFor(outerMs);

    for (const ring of rings) {
      const target = shown.has(ring.ms) ? (Math.abs(ring.ms - outerMs) < 0.5 ? 0.5 : 0.2) : 0;
      ring.opacity += (target - ring.opacity) * ease(5);
      if (Math.abs(target - ring.opacity) > 0.005) busy = true;
      ring.r = radiusFor(ring.ms);
      ring.line.scale.setScalar(ring.r);
      ring.line.material.opacity = ring.opacity;
      ring.line.visible = ring.opacity > 0.01; // 눈금이 바뀌는 동안 새 바깥 고리가 밖에서 미끄러져 들어온다
    }

    const anyFail = stars.some((s) => s.state === "fail");
    failRing.opacity += ((anyFail ? 0.55 : 0) - failRing.opacity) * ease(5);
    failRing.line.material.opacity = failRing.opacity;
    failRing.line.visible = failRing.opacity > 0.01;

    // 별
    const hot = canvasHot || rowHot;
    const sinceStart = (now - startedAt) / 1000;
    for (const s of stars) {
      if (s.state === "fail") s.rTarget = FAIL_R;
      else if (s.ms) s.rTarget = radiusFor(s.ms);
      if (reduced || sinceStart > s.delay) s.r += (s.rTarget - s.r) * ease(4.5);
      if (Math.abs(s.rTarget - s.r) > 0.002) busy = true;

      s.group.position.set(Math.cos(s.angle) * s.r, 0, Math.sin(s.angle) * s.r);
      s.spoke.scale.x = Math.max(s.r, 0.0001);

      s.color.lerp(COLOR[s.state] || COLOR.ok, ease(8));
      s.halo.material.color.copy(s.color);
      s.spoke.material.color.copy(s.color);

      s.bump *= reduced ? 0 : Math.exp(-dt * 3.5);
      const isHot = hot === s;
      let size = 0.19;
      if (isHot) size *= 1.5;
      if (s.state === "wait") size *= 0.75;
      if (!reduced) {
        size *= 1 + 0.06 * Math.sin(t * 1.7 + s.phase);
        if (s.state === "run") size *= 1 + 0.22 * Math.sin(t * 9);
      }
      size *= 1 + s.bump * 0.9;
      s.halo.scale.setScalar(size);
      s.core.scale.setScalar(size * 0.32);
      s.halo.material.opacity = s.state === "wait" ? 0.5 : 1;
      s.core.material.opacity = s.state === "wait" ? 0.35 : 0.85;
      s.spoke.material.opacity = isHot ? 0.65 : s.state === "wait" ? 0.1 : 0.2;

      // 재는 동안: 가운데에서 바깥으로 신호가 나간다.
      const pulsing = s.state === "run" && !reduced;
      if (pulsing) {
        const p = (((now - s.runStart) / 900) % 1 + 1) % 1;
        s.pulse.position.set(Math.cos(s.angle) * p * 1.05, 0, Math.sin(s.angle) * p * 1.05);
        s.pulse.material.opacity = Math.sin(Math.PI * p) * 0.95;
      }
      s.pulse.visible = pulsing;

      if (isHot !== s.wasHot) {
        s.label.classList.toggle("is-hot", isHot);
        s.wasHot = isHot;
        s.dirty = true;
      }
    }

    renderer.render(scene, camera);

    // ── 이름표 ──
    // 크기는 바뀌었을 때만 잰다(읽기를 먼저 몰아서 해 레이아웃을 한 번만 계산한다).
    if (!labelsMeasured || stars.some((s) => s.dirty)) {
      for (const s of stars) {
        if (s.dirty || !labelsMeasured) { s.w = s.label.offsetWidth; s.h = s.label.offsetHeight; s.dirty = false; }
      }
      if (!labelsMeasured) {
        for (const ring of [...rings, failRing]) { ring.w = ring.label.offsetWidth; ring.h = ring.label.offsetHeight; }
      }
      labelsMeasured = true;
    }

    scene.updateMatrixWorld();
    const [cx] = project(center.getWorldPosition(world));
    for (const s of stars) [s.sx, s.sy] = project(s.group.getWorldPosition(world));

    // 겹치면 덜 중요한 이름표를 숨긴다: 가리킨 별 > 재는 중·응답 없음 > 나머지
    const rank = (s) => (s === hot ? 3 : s.state === "run" || s.state === "fail" ? 2 : 1);
    const order = [...stars].sort((a, b) => rank(b) - rank(a));
    const placed = [];
    const gap = 3;
    for (const s of order) {
      const rightBox = { x: s.sx + 9, y: s.sy - s.h / 2, w: s.w, h: s.h };
      const leftBox = { x: s.sx - 9 - s.w, y: s.sy - s.h / 2, w: s.w, h: s.h };
      const inside = (b) => b.x >= 2 && b.x + b.w <= width - 2 && b.y >= 0 && b.y + b.h <= height;
      const free = (b) => !placed.some((p) => overlaps({ x: b.x - gap, y: b.y - gap, w: b.w + gap * 2, h: b.h + gap * 2 }, p));
      const tries = s.sx >= cx ? [rightBox, leftBox] : [leftBox, rightBox];
      let box = tries.find((b) => inside(b) && free(b));
      if (!box && s === hot) box = tries.find(inside) || tries[0];
      if (box) {
        placed.push(box);
        s.label.style.transform = `translate(${Math.round(box.x)}px, ${Math.round(box.y)}px)`;
      }
      s.label.classList.toggle("is-hidden", !box);
    }

    // 눈금 숫자와 '응답 없음'은 고리 위 몇 군데 중 비어 있는 곳에 적는다.
    // 바깥 고리(지금 눈금) 숫자를 먼저 놓고, 별 이름표나 다른 숫자와 겹치면 다음 자리, 다 막히면 숨긴다.
    const freeBox = (box) => {
      const padded = { x: box.x - 6, y: box.y - 2, w: box.w + 12, h: box.h + 4 };
      return box.x >= 2 && box.x + box.w <= width - 2 && box.y >= 0 && box.y + box.h <= height
        && !placed.some((q) => overlaps(padded, q));
    };
    const placeOnRing = (item, r, active) => {
      let box = null;
      if (active) {
        const [rx, ry] = project(ringPoint.set(r, 0, 0)); // 오른쪽 끝: 고리 안쪽 위에
        const [lx, ly] = project(ringPoint.set(-r, 0, 0)); // 왼쪽 끝: 고리 안쪽 위에
        const [fx, fy] = project(ringPoint.set(0, 0, r)); // 앞쪽(화면 아래): 고리 바로 아래에
        const slots = [
          { x: rx - 4 - item.w, y: ry - 2 - item.h, w: item.w, h: item.h },
          { x: lx + 4, y: ly - 2 - item.h, w: item.w, h: item.h },
          { x: fx - item.w / 2, y: fy + 3, w: item.w, h: item.h },
        ];
        // 지난번 자리가 아직 비어 있으면 그대로 둔다(자리가 자꾸 바뀌어 깜빡이지 않게).
        const prev = item.slot ?? 0;
        const order = [prev, ...[0, 1, 2].filter((i) => i !== prev)];
        const idx = order.find((i) => freeBox(slots[i]));
        if (idx != null) { item.slot = idx; box = slots[idx]; }
      }
      if (box) {
        placed.push(box);
        item.label.style.transform = `translate(${Math.round(box.x)}px, ${Math.round(box.y)}px)`;
      }
      return Boolean(box);
    };
    if (failRing.opacity > 0.01) {
      const ok = placeOnRing(failRing, FAIL_R, true);
      failRing.label.style.opacity = ok ? String(Math.min(1, failRing.opacity * 2)) : "0";
    } else {
      failRing.label.style.opacity = "0";
    }
    const ringOrder = [...rings].sort((a, b) => Math.abs(a.ms - outerMs) - Math.abs(b.ms - outerMs));
    for (const ring of ringOrder) {
      const ok = placeOnRing(ring, ring.r, ring.line.visible && shown.has(ring.ms));
      ring.label.style.opacity = ok ? String(Math.min(1, ring.opacity * 3)) : "0";
    }

    // 움직이는 게 없으면(동작 줄이기 설정) 쉰다. 입력이나 결과가 오면 wake()로 깨운다.
    idleFrames = busy ? 0 : idleFrames + 1;
    if (running() && idleFrames < 3) raf = requestAnimationFrame(frame);
  }

  let onScreen = true;
  const running = () => onScreen && !document.hidden;
  function wake() {
    idleFrames = 0;
    if (!raf && running()) {
      lastFrame = performance.now();
      raf = requestAnimationFrame(frame);
    }
  }

  new IntersectionObserver(([entry]) => {
    onScreen = entry.isIntersecting;
    if (onScreen) wake();
  }).observe(stage);
  document.addEventListener("visibilitychange", wake);
  reducedQuery.addEventListener?.("change", wake);
  ["pointermove", "pointerdown", "pointerup", "pointerleave"].forEach((type) => stage.addEventListener(type, wake));
  new ResizeObserver(() => { resize(); wake(); }).observe(stage);
  document.fonts?.ready.then(() => { labelsMeasured = false; wake(); });

  resize();
  if (reducedQuery.matches) stars.forEach((s) => { s.r = s.ms ? radiusFor(s.ms) : 0.5; });
  stage.classList.add("is-ready");
  wake();
}
