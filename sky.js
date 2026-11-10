// 첫 화면의 작은 행성 (three.js).
// 서비스 한 곳이 행성 위에 떠 있는 불빛 하나다. 응답이 늦을수록 불빛이 높이 뜬다(로그 눈금).
// 끌어서 돌리고, 불빛을 누르면 그 서비스 소개 카드로 간다. 목록에서 행을 가리키거나
// '다시 재기'로 한 곳씩 재는 동안에는 그 불빛이 앞으로 오도록 행성이 돈다.
// WebGL을 못 쓰면 그림만 숨긴다. 목록(.record__list)이 같은 내용을 글로 전한다.

const figure = document.getElementById("sky");
const stage = figure?.querySelector("[data-sky-stage]");
const rows = [...document.querySelectorAll(".ping[data-id]")];
const reducedQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

const MIN_MS = 10; // 땅에 거의 붙는 높이에 해당하는 시간
const SCALE_STEPS = [150, 300, 500, 1000, 2000, 5000, 12000]; // 가장 높은 자리: 가장 느린 응답이 들어가는 가장 작은 값
const ALT_MIN = 0.07; // 불빛 높이(행성 반지름 = 1)
const ALT_SPAN = 0.36;
const ALT_FAIL = 0.025; // 응답 없음: 불빛이 땅으로 내려앉는다
const FIT_R = 1 + ALT_MIN + ALT_SPAN; // 화면에 다 들어와야 하는 반지름
const FILL_Y = 0.9; // 그 반지름이 차지할 화면 높이 비율
const FILL_X = 0.7; // 너비 비율(양옆에 이름표 자리를 남긴다)
const AUTO_SPIN = 0.07; // 가만히 있을 때 도는 속도(rad/s)
const AXIS_TILT = 0.3; // 자전축 기울기
const CAM_ELEV = 0.2; // 카메라가 적도 위로 올라간 각
const PITCH_MAX = 0.55;
// 불빛 자리: 경도는 고르게, 위도는 서로 엇갈리게
const LATS = [18, -24, 40, -6, -38, 30, 4, -20, 46, -32, 12, -12];

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
  const THREE = await import("./assets/vendor/three-sky.min.js");

  // 색은 styles.css의 토큰을 그대로 쓴다.
  const css = getComputedStyle(document.documentElement);
  const token = (name, fallback) => new THREE.Color(css.getPropertyValue(name).trim() || fallback);
  const COLOR = {
    ok: token("--signal-bright", "#3DDC97"),
    run: token("--star", "#F1B52E"),
    wait: token("--night-muted", "#A9A5C4"),
    fail: token("--fail-bright", "#FF9B7A"),
    land: token("--paper", "#EEECF6"), // 낮의 땅은 본문 바탕색과 같다
    sea: token("--planet-sea", "#A79BE6"),
    nightLand: token("--night-low", "#2B2462"),
    nightSea: token("--night", "#121027"),
    air: token("--planet-air", "#8F7CFF"),
    dawn: token("--planet-dawn", "#FFD9A0"),
  };

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  // 캔버스는 무대 크기를 따라가기만 하고 무대를 키우지 않게 한다.
  Object.assign(renderer.domElement.style, { position: "absolute", inset: "0", width: "100%", height: "100%", display: "block" });
  if (getComputedStyle(stage).position === "static") stage.style.position = "relative";
  if (stage.clientHeight < 40 || getComputedStyle(stage).aspectRatio === "auto") stage.style.aspectRatio = "4 / 3";
  stage.prepend(renderer.domElement);

  const labelLayer = document.createElement("div");
  labelLayer.className = "sky__labels";
  stage.append(labelLayer);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 4 / 3, 0.1, 60);
  const tilt = new THREE.Group(); // 자전축 기울기와 위아래 끌기
  const planet = new THREE.Group(); // 자전
  tilt.rotation.z = AXIS_TILT;
  tilt.add(planet);
  scene.add(tilt);

  // 해는 왼쪽 위 앞에 있다. 행성이 돌아도 낮과 밤의 경계는 제자리에 있다.
  const LIGHT = new THREE.Vector3(-0.78, 0.4, 0.48).normalize();

  // ── 행성 ──
  const globe = new THREE.Mesh(
    new THREE.SphereGeometry(1, 72, 48),
    new THREE.ShaderMaterial({
      uniforms: {
        uLight: { value: LIGHT },
        uLand: { value: COLOR.land },
        uSea: { value: COLOR.sea },
        uNightLand: { value: COLOR.nightLand },
        uNightSea: { value: COLOR.nightSea },
        uAir: { value: COLOR.air },
      },
      vertexShader: /* glsl */ `
        varying vec3 vObj;
        varying vec3 vWorldN;
        varying vec3 vViewN;
        void main() {
          vObj = position;
          vWorldN = normalize(mat3(modelMatrix) * normal);
          vViewN = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform vec3 uLight, uLand, uSea, uNightLand, uNightSea, uAir;
        varying vec3 vObj;
        varying vec3 vWorldN;
        varying vec3 vViewN;
        float hash(vec3 p) {
          p = fract(p * 0.3183099 + 0.1);
          p *= 17.0;
          return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
        }
        float noise(vec3 x) {
          vec3 i = floor(x);
          vec3 f = fract(x);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x),
                         mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
                     mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x),
                         mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
        }
        float fbm(vec3 p) {
          float v = 0.0;
          float a = 0.5;
          for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + 7.1; a *= 0.5; }
          return v;
        }
        void main() {
          float n = fbm(vObj * 1.7 + 3.3);
          float land = smoothstep(0.5, 0.53, n);
          // 땅 안쪽은 조금 더 밝게, 바닷가는 한 톤 낮게
          float inland = smoothstep(0.53, 0.66, n);
          vec3 day = mix(uSea, mix(uLand * 0.9, uLand, inland), land);
          vec3 night = mix(uNightSea, uNightLand, land);
          float ndl = dot(normalize(vWorldN), uLight);
          float lit = smoothstep(-0.16, 0.3, ndl);
          float shade = 0.74 + 0.26 * smoothstep(0.0, 0.95, ndl);
          vec3 col = mix(night, day * shade, lit);
          // 가장자리에 대기 빛이 얇게 감긴다
          float rim = pow(1.0 - max(normalize(vViewN).z, 0.0), 3.0);
          col += uAir * rim * (0.42 + 0.3 * lit);
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`,
    })
  );
  planet.add(globe);

  // ── 대기: 행성 바깥으로 번지는 빛. 해 쪽 가장자리는 새벽빛이 섞인다 ──
  const AIR_R = 1.2;
  const air = new THREE.Mesh(
    new THREE.SphereGeometry(AIR_R, 64, 40),
    new THREE.ShaderMaterial({
      uniforms: {
        uLight: { value: LIGHT },
        uAir: { value: COLOR.air },
        uDawn: { value: COLOR.dawn },
        uEdge: { value: Math.sqrt(1 - 1 / (AIR_R * AIR_R)) },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorldN;
        varying vec3 vViewN;
        void main() {
          vWorldN = normalize(mat3(modelMatrix) * normal);
          vViewN = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform vec3 uLight, uAir, uDawn;
        uniform float uEdge;
        varying vec3 vWorldN;
        varying vec3 vViewN;
        void main() {
          // 뒷면을 그린다: 껍질 가장자리에서 0, 행성 가장자리에 닿는 곳에서 1
          float t = clamp(-normalize(vViewN).z / uEdge, 0.0, 1.0);
          float glow = pow(t, 2.4);
          float sun = smoothstep(-0.1, 0.9, dot(normalize(vWorldN), uLight));
          vec3 col = mix(uAir, uDawn, sun * 0.55);
          gl_FragColor = vec4(col, glow * (0.44 + 0.4 * sun));
          #include <colorspace_fragment>
        }`,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
  scene.add(air);

  // ── 불빛 텍스처 ──
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

  // ── 서비스 불빛 ──
  // 줄 하나: 땅(반지름 1)에서 불빛까지. 길이는 scale.x로 늘린다.
  const tetherGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0, 0)]);
  const X_AXIS = new THREE.Vector3(1, 0, 0);
  const lights = rows.map((row, i) => {
    const status = row.querySelector(".js-status");
    const state = status?.dataset.state || "ok";
    const ms = Number(row.dataset.ms) || null;
    const tint = (COLOR[state] || COLOR.ok).clone();

    const lon = (i / rows.length) * Math.PI * 2;
    const lat = THREE.MathUtils.degToRad(LATS[i % LATS.length]);
    const dir = new THREE.Vector3(Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon));

    // 불빛은 행성에 가려지면 직접 흐리게 한다(깊이 검사로 자르면 빛 번짐이 땅에 반듯하게 잘린다).
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: tint.clone(), transparent: true, depthWrite: false, depthTest: false }));
    const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xffffff, transparent: true, depthWrite: false, depthTest: false }));
    const foot = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: tint.clone(), transparent: true, depthWrite: false, opacity: 0.7 }));
    foot.position.copy(dir).multiplyScalar(1.004);
    foot.scale.setScalar(0.09);
    const tether = new THREE.Line(tetherGeo, new THREE.LineBasicMaterial({ color: tint.clone(), transparent: true, opacity: 0.5, depthWrite: false }));
    tether.position.copy(dir);
    tether.quaternion.setFromUnitVectors(X_AXIS, dir);
    tether.scale.x = 0.0001;
    const pulse = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: COLOR.run, transparent: true, depthWrite: false, depthTest: false, opacity: 0 }));
    pulse.scale.setScalar(0.12);
    pulse.visible = false;
    planet.add(foot, tether, halo, core, pulse);

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
      id: row.dataset.id, row, card: row.dataset.card, dir, state, ms,
      alt: 0, altTarget: ALT_MIN, delay: 0.25 + i * 0.09, runStart: 0, bump: 0,
      phase: Math.random() * Math.PI * 2, seen: 0, front: false,
      color: tint, halo, core, foot, tether, pulse, label, value,
      sx: -999, sy: -999, w: 0, h: 0, dirty: true, wasHot: false,
    };
  });
  const byId = new Map(lights.map((s) => [s.id, s]));

  function setValueText(s) {
    if (s.state === "fail") s.value.textContent = "응답 없음";
    else if (s.state === "run") s.value.textContent = "재는 중";
    else if (s.state === "wait") s.value.textContent = "대기";
    else s.value.textContent = s.ms ? msLabel(s.ms) : "";
    s.label.dataset.state = s.state;
    s.dirty = true;
  }
  lights.forEach(setValueText);

  // ── 높이 눈금: 가장 느린 응답에 맞춰 맨 위 자리를 고른다 ──
  const log2 = Math.log2;
  function targetOuter() {
    let max = 0;
    for (const s of lights) if (s.ms && s.state !== "fail") max = Math.max(max, s.ms);
    return SCALE_STEPS.find((step) => step >= max * 1.05) ?? SCALE_STEPS[SCALE_STEPS.length - 1];
  }
  let outerLog = log2(targetOuter());
  const altFor = (ms) => {
    const t = (log2(Math.max(ms, MIN_MS)) - log2(MIN_MS)) / (outerLog - log2(MIN_MS));
    return ALT_MIN + ALT_SPAN * Math.min(Math.max(t, 0), 1);
  };

  // ── 시점 ──
  // 처음에는 첫 번째 서비스가 앞쪽 살짝 왼편에 오게 한다.
  let yaw = -0.5;
  let yawVel = AUTO_SPIN;
  let pitch = 0;
  let width = 1;
  let height = 1;

  function resize() {
    width = Math.max(1, stage.clientWidth);
    height = Math.max(1, stage.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const d = Math.max(FIT_R / (tanV * FILL_Y), FIT_R / (tanV * camera.aspect * FILL_X));
    camera.position.set(0, d * Math.sin(CAM_ELEV), d * Math.cos(CAM_ELEV));
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  }

  // ── 끌기·가리키기 ──
  let dragging = false;
  let pointerInside = false;
  let lastX = 0;
  let lastY = 0;
  let lastT = 0;
  let moved = 0;
  let resumeAt = 0;
  let canvasHot = null; // 그림에서 가리킨 불빛
  let rowHot = null; // 목록에서 가리킨 행

  function pick(x, y) {
    let best = null;
    let bestD = 24;
    for (const s of lights) {
      if (!s.front) continue;
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
      pitch = Math.min(PITCH_MAX, Math.max(-PITCH_MAX, pitch + dy * 0.006));
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

  for (const s of lights) {
    s.row.addEventListener("pointerenter", () => { rowHot = s; wake(); });
    s.row.addEventListener("pointerleave", () => {
      if (rowHot === s) { rowHot = null; resumeAt = performance.now() + 1200; }
      wake();
    });
  }

  // ── 다시 재기 결과 받기 ──
  document.addEventListener("ping:update", (e) => {
    const s = byId.get(e.detail?.id);
    if (!s) return;
    s.state = e.detail.state;
    if (e.detail.ms != null) s.ms = e.detail.ms;
    if (s.state === "run") s.runStart = performance.now();
    if (s.state === "ok" || s.state === "fail") { s.bump = 1; resumeAt = performance.now() + 1800; }
    setValueText(s);
    wake();
  });

  // ── 그리기 ──
  const world = new THREE.Vector3();
  const probe = new THREE.Vector3();
  const toTip = new THREE.Vector3();
  function project(v) {
    probe.copy(v).project(camera);
    return [(probe.x + 1) * 0.5 * width, (1 - probe.y) * 0.5 * height];
  }
  // 카메라에서 그 점까지 가는 길을 행성이 막는지
  function hiddenByPlanet(p) {
    const o = camera.position;
    toTip.copy(p).sub(o);
    const dist = toTip.length();
    toTip.divideScalar(dist);
    const b = o.dot(toTip);
    const disc = b * b - (o.lengthSq() - 1);
    if (disc <= 0) return false;
    const hit = -b - Math.sqrt(disc);
    return hit > 0 && hit < dist - 0.01;
  }
  const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

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
    let busy = dragging || !reduced; // 동작 줄이기가 꺼져 있으면 늘 천천히 돈다

    // 회전: 목록에서 가리킨 곳이나 지금 재는 곳이 있으면 그 불빛을 앞으로 돌린다.
    // 없으면 천천히 돌고, 끌다가 놓으면 관성으로 돌다가 원래 속도로 돌아온다.
    const focus = rowHot || lights.find((s) => s.state === "run") || null;
    if (!dragging) {
      if (focus) {
        const goal = Math.atan2(-focus.dir.x, focus.dir.z) - 0.25; // 한가운데보다 살짝 왼쪽
        const diff = wrap(goal - yaw);
        yaw += diff * ease(4);
        yawVel = 0;
        if (Math.abs(diff) > 0.002) busy = true;
      } else {
        const spinTarget = reduced || pointerInside || now < resumeAt ? 0 : AUTO_SPIN;
        yawVel += (spinTarget - yawVel) * (reduced ? 1 : 1 - Math.exp(-dt * 1.6));
        if (Math.abs(yawVel) < 1e-4) yawVel = 0;
        yaw += yawVel * dt;
      }
    }
    planet.rotation.y = yaw;
    tilt.rotation.x = pitch;

    // 높이 눈금
    const goalLog = log2(targetOuter());
    outerLog += (goalLog - outerLog) * ease(4);
    if (Math.abs(goalLog - outerLog) > 4e-3) busy = true;
    else outerLog = goalLog;

    scene.updateMatrixWorld();

    const hot = canvasHot || rowHot;
    const sinceStart = (now - startedAt) / 1000;
    for (const s of lights) {
      if (s.state === "fail") s.altTarget = ALT_FAIL;
      else if (s.ms) s.altTarget = altFor(s.ms);
      if (reduced || sinceStart > s.delay) s.alt += (s.altTarget - s.alt) * ease(4.5);
      if (Math.abs(s.altTarget - s.alt) > 0.002) busy = true;

      const r = 1 + s.alt;
      s.halo.position.copy(s.dir).multiplyScalar(r);
      s.core.position.copy(s.halo.position);
      s.tether.scale.x = Math.max(s.alt, 0.0001);

      s.color.lerp(COLOR[s.state] || COLOR.ok, ease(8));
      s.halo.material.color.copy(s.color);
      s.foot.material.color.copy(s.color);
      s.tether.material.color.copy(s.color);

      // 행성 뒤로 넘어가면 불빛과 이름표를 흐리게 한다
      s.halo.getWorldPosition(world);
      s.front = !hiddenByPlanet(world);
      s.seen += ((s.front ? 1 : 0) - s.seen) * ease(10);
      if (Math.abs((s.front ? 1 : 0) - s.seen) > 0.01) busy = true;
      [s.sx, s.sy] = project(world);

      s.bump *= reduced ? 0 : Math.exp(-dt * 3.5);
      const isHot = hot === s;
      let size = 0.36;
      if (isHot) size *= 1.5;
      if (s.state === "wait") size *= 0.75;
      if (!reduced) {
        size *= 1 + 0.06 * Math.sin(t * 1.7 + s.phase);
        if (s.state === "run") size *= 1 + 0.22 * Math.sin(t * 9);
      }
      size *= 1 + s.bump * 0.9;
      s.halo.scale.setScalar(size);
      s.core.scale.setScalar(size * 0.3);
      const dim = s.state === "wait" ? 0.5 : 1;
      s.halo.material.opacity = s.seen * dim;
      s.core.material.opacity = s.seen * dim * 0.9;
      s.tether.material.opacity = isHot ? 0.9 : s.state === "wait" ? 0.25 : 0.5;

      // 재는 동안: 땅에서 불빛까지 신호가 올라간다.
      const pulsing = s.state === "run" && !reduced;
      if (pulsing) {
        const p = (((now - s.runStart) / 700) % 1 + 1) % 1;
        s.pulse.position.copy(s.dir).multiplyScalar(1 + s.alt * p);
        s.pulse.material.opacity = Math.sin(Math.PI * p) * 0.95 * s.seen;
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
    if (!labelsMeasured || lights.some((s) => s.dirty)) {
      for (const s of lights) {
        if (s.dirty || !labelsMeasured) { s.w = s.label.offsetWidth; s.h = s.label.offsetHeight; s.dirty = false; }
      }
      labelsMeasured = true;
    }

    // 겹치면 덜 중요한 이름표를 숨긴다: 가리킨 불빛 > 재는 중·응답 없음 > 나머지
    const cx = width / 2;
    const rank = (s) => (s === hot ? 3 : s.state === "run" || s.state === "fail" ? 2 : 1);
    const order = [...lights].sort((a, b) => rank(b) - rank(a));
    const placed = [];
    const gap = 3;
    for (const s of order) {
      let box = null;
      if (s.front) {
        const rightBox = { x: s.sx + 12, y: s.sy - s.h / 2, w: s.w, h: s.h };
        const leftBox = { x: s.sx - 12 - s.w, y: s.sy - s.h / 2, w: s.w, h: s.h };
        const inside = (b) => b.x >= 2 && b.x + b.w <= width - 2 && b.y >= 0 && b.y + b.h <= height;
        const free = (b) => !placed.some((p) => overlaps({ x: b.x - gap, y: b.y - gap, w: b.w + gap * 2, h: b.h + gap * 2 }, p));
        const tries = s.sx >= cx ? [rightBox, leftBox] : [leftBox, rightBox];
        box = tries.find((b) => inside(b) && free(b));
        if (!box && s === hot) box = tries.find(inside) || tries[0];
      }
      if (box) {
        placed.push(box);
        s.label.style.transform = `translate(${Math.round(box.x)}px, ${Math.round(box.y)}px)`;
      }
      s.label.classList.toggle("is-hidden", !box);
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
  if (reducedQuery.matches) lights.forEach((s) => { s.alt = s.ms ? altFor(s.ms) : ALT_MIN; });
  stage.classList.add("is-ready");
  wake();
}
