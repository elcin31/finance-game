import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js';

const $ = (id) => document.getElementById(id);
const canvas = $('gameCanvas');
const startScreen = $('startScreen');
const hud = $('hud');
const ticker = $('eventTicker');
const interactionHint = $('interactionHint');
const cameraHint = $('cameraHint');
const joystick = $('joystick');
const interactBtn = $('interactBtn');
const panel = $('panel');
const quarterModal = $('quarterModal');

const SAVE_KEY = 'capital-office-v1';
const SETTINGS_KEY = 'capital-office-settings-v1';
const isTouch = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
const QUARTER_SECONDS = 52;

const strategies = {
  Growth: { expected: 0.075, vol: 0.11, label: 'Growth', desc: 'Высокая доходность, высокая волатильность.' },
  Balanced: { expected: 0.045, vol: 0.065, label: 'Balanced', desc: 'Сбалансированный риск и доходность.' },
  Defensive: { expected: 0.024, vol: 0.032, label: 'Defensive', desc: 'Ниже риск, но и меньше апсайд.' },
  Cash: { expected: 0.009, vol: 0.006, label: 'Cash', desc: 'Минимум риска и почти никакого роста.' }
};

const events = [
  { name: 'AI rally', shock: 0.055, text: 'AI-сектор тащит рынок вверх.' },
  { name: 'Rate cut', shock: 0.035, text: 'ЦБ смягчает политику. Риск-активы растут.' },
  { name: 'Earnings miss', shock: -0.05, text: 'Слабые отчёты давят на рынок.' },
  { name: 'Liquidity squeeze', shock: -0.075, text: 'Ликвидность исчезает быстрее человеческой уверенности.' },
  { name: 'Soft landing', shock: 0.028, text: 'Инфляция остывает без рецессии.' },
  { name: 'Credit scare', shock: -0.042, text: 'Кредитные спрэды расширяются.' },
  { name: 'Productivity boom', shock: 0.045, text: 'Рост производительности улучшает ожидания.' },
  { name: 'Geopolitical shock', shock: -0.062, text: 'Геополитика снова решила участвовать в портфеле без приглашения.' }
];

let state = freshState();
let renderer;
let scene;
let camera;
let player;
let clock;
let nearestTerminal = null;
let running = false;
let paused = false;
let elapsedQuarter = 0;
let nextEventAt = 8;
let quarterEvents = [];
let keys = new Set();
let joystickVector = { x: 0, y: 0 };
let terminals = [];
const colliders = [];
const animatedScreens = [];
const ambientLights = [];

const cameraState = {
  yaw: 0,
  pitch: 0.34,
  distance: 7.6,
  minDistance: 4.2,
  maxDistance: 11.5,
  minPitch: 0.05,
  maxPitch: 1.03,
  sensitivity: 0.0045
};

const performanceState = {
  quality: detectQuality(),
  sampleTime: 0,
  frames: 0,
  lowered: false
};

function freshState() {
  return {
    capital: 100000,
    quarter: 1,
    strategy: 'Balanced',
    research: 0,
    hedge: 0,
    analysts: 0,
    reputation: 50,
    highWater: 100000
  };
}

function detectQuality() {
  const memory = navigator.deviceMemory || 4;
  const cores = navigator.hardwareConcurrency || 4;
  if (isTouch && (memory <= 4 || cores <= 4)) return 'LOW';
  if (isTouch || memory <= 6 || cores <= 6) return 'MED';
  return 'HIGH';
}

function qualityConfig() {
  if (performanceState.quality === 'LOW') return { pixelRatio: 1, shadows: false, shadowSize: 512, cityCount: 34 };
  if (performanceState.quality === 'MED') return { pixelRatio: 1.35, shadows: true, shadowSize: 1024, cityCount: 52 };
  return { pixelRatio: 1.7, shadows: true, shadowSize: 2048, cityCount: 74 };
}

function money(n) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}

function pct(n) {
  return `${n >= 0 ? '+' : ''}${(n * 100).toFixed(1)}%`;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function damp(current, target, lambda, dt) {
  return THREE.MathUtils.lerp(current, target, 1 - Math.exp(-lambda * dt));
}

function seededRandom(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function init3D() {
  const quality = qualityConfig();
  renderer = new THREE.WebGLRenderer({ canvas, antialias: performanceState.quality !== 'LOW', powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, quality.pixelRatio));
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.shadowMap.enabled = quality.shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x030810);
  scene.fog = new THREE.FogExp2(0x050a12, 0.0145);

  camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.08, 180);
  camera.position.set(0, 5.2, 8.4);

  setupLighting(quality);
  buildOffice(quality);
  player = buildPlayer();
  scene.add(player);
  loadCameraSettings();
  setupCameraControls();
  clock = new THREE.Clock();
  $('qualityValue').textContent = performanceState.quality;
  animate();
}

function setupLighting(quality) {
  const hemi = new THREE.HemisphereLight(0x8dcfff, 0x101118, 1.45);
  scene.add(hemi);

  const moon = new THREE.DirectionalLight(0xdcecff, 2.5);
  moon.position.set(7, 13, 7);
  moon.castShadow = quality.shadows;
  moon.shadow.mapSize.set(quality.shadowSize, quality.shadowSize);
  moon.shadow.camera.left = -19;
  moon.shadow.camera.right = 19;
  moon.shadow.camera.top = 18;
  moon.shadow.camera.bottom = -18;
  moon.shadow.camera.near = 1;
  moon.shadow.camera.far = 45;
  moon.shadow.bias = -0.00015;
  scene.add(moon);

  const cyan = new THREE.PointLight(0x3bdcff, 21, 19, 2);
  cyan.position.set(-7, 4.4, -6);
  scene.add(cyan);
  ambientLights.push(cyan);

  const warm = new THREE.PointLight(0xffb46e, 18, 16, 2);
  warm.position.set(8, 3.6, 4);
  scene.add(warm);
  ambientLights.push(warm);

  const violet = new THREE.PointLight(0x775cff, 15, 15, 2);
  violet.position.set(0, 4.6, -10);
  scene.add(violet);
  ambientLights.push(violet);
}

function material(color, rough = 0.6, metal = 0.05, emissive = 0x000000, emissiveIntensity = 0) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, emissive, emissiveIntensity });
}

function physicalMaterial(options) {
  return new THREE.MeshPhysicalMaterial({
    color: options.color,
    roughness: options.roughness ?? 0.4,
    metalness: options.metalness ?? 0,
    clearcoat: options.clearcoat ?? 0,
    clearcoatRoughness: options.clearcoatRoughness ?? 0.25,
    transmission: options.transmission ?? 0,
    transparent: options.transparent ?? false,
    opacity: options.opacity ?? 1,
    emissive: options.emissive ?? 0x000000,
    emissiveIntensity: options.emissiveIntensity ?? 0,
    side: options.side ?? THREE.FrontSide,
    depthWrite: options.depthWrite ?? true
  });
}

function box(w, h, d, color, x, y, z, opts = {}) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    opts.physical
      ? physicalMaterial({ color, ...opts })
      : material(color, opts.rough ?? 0.65, opts.metal ?? 0.08, opts.emissive ?? 0x000000, opts.emissiveIntensity ?? 0)
  );
  mesh.position.set(x, y, z);
  mesh.castShadow = opts.cast ?? true;
  mesh.receiveShadow = opts.receive ?? true;
  scene.add(mesh);
  return mesh;
}

function buildOffice(quality) {
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(36, 28),
    physicalMaterial({ color: 0x0d1520, roughness: 0.28, metalness: 0.18, clearcoat: 0.72, clearcoatRoughness: 0.18 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  addFloorInlays();
  buildPanoramicWindows();
  buildCity(quality.cityCount);
  buildCeilingLights();

  box(36, 0.8, 0.55, 0x121a25, 0, 0.4, -14, { cast: false, rough: 0.45, metal: 0.25 });
  box(0.55, 0.8, 28, 0x121a25, -18, 0.4, 0, { cast: false, rough: 0.45, metal: 0.25 });
  box(0.55, 0.8, 28, 0x121a25, 18, 0.4, 0, { cast: false, rough: 0.45, metal: 0.25 });

  const table = box(7.4, 0.34, 3.25, 0x171f2c, 0, 0.88, -2, { physical: true, roughness: 0.24, metalness: 0.36, clearcoat: 0.82 });
  table.material.clearcoat = 0.85;
  box(0.42, 1.6, 0.42, 0x080c12, -2.6, 0.3, -2, { metal: 0.65 });
  box(0.42, 1.6, 0.42, 0x080c12, 2.6, 0.3, -2, { metal: 0.65 });
  const edge = box(6.8, 0.035, 2.65, 0x4adfff, 0, 1.07, -2, { emissive: 0x21bde4, emissiveIntensity: 1.2, cast: false });
  edge.material.transparent = true;
  edge.material.opacity = 0.28;
  colliders.push({ x: 0, z: -2, w: 7.9, d: 3.85 });

  createDesk(-10, 2, Math.PI / 2);
  createDesk(10, 2, -Math.PI / 2);
  createDesk(-10, -6, Math.PI / 2);
  createDesk(10, -6, -Math.PI / 2);

  createTerminal('market', -12, 8, 0x32d6ff, 'MARKET');
  createTerminal('risk', 12, 8, 0xffa45c, 'RISK');
  createTerminal('research', -12, -10, 0xaa7cff, 'RESEARCH');
  createTerminal('hr', 12, -10, 0x67f3a5, 'TEAM');

  box(8.4, 0.32, 2.65, 0x182433, 0, 0.84, 9, { physical: true, roughness: 0.26, metalness: 0.3, clearcoat: 0.75 });
  const monitor = box(3.6, 2.0, 0.16, 0x050b12, 0, 2.06, 8.58, { emissive: 0x0b5e84, emissiveIntensity: 1.45, rough: 0.12, metal: 0.42 });
  monitor.rotation.x = -0.05;
  animatedScreens.push(monitor);
  colliders.push({ x: 0, z: 9, w: 9, d: 3.5 });

  const sign = makeLabel('CAPITAL OFFICE', 0x57e0ff);
  sign.position.set(0, 5.75, -13.18);
  sign.scale.set(5.4, 1.35, 1);
  scene.add(sign);

  buildLounge();
  buildPlants();
}

function addFloorInlays() {
  const lineMat = new THREE.MeshBasicMaterial({ color: 0x173149, transparent: true, opacity: 0.48 });
  for (let x = -15; x <= 15; x += 3) {
    const line = new THREE.Mesh(new THREE.PlaneGeometry(0.018, 25), lineMat);
    line.rotation.x = -Math.PI / 2;
    line.position.set(x, 0.008, 0);
    scene.add(line);
  }
  for (let z = -11; z <= 11; z += 3) {
    const line = new THREE.Mesh(new THREE.PlaneGeometry(33, 0.018), lineMat);
    line.rotation.x = -Math.PI / 2;
    line.position.set(0, 0.009, z);
    scene.add(line);
  }
}

function buildPanoramicWindows() {
  const glass = physicalMaterial({
    color: 0x0c263b,
    roughness: 0.06,
    metalness: 0.08,
    transmission: 0.2,
    transparent: true,
    opacity: 0.35,
    clearcoat: 0.9,
    clearcoatRoughness: 0.08,
    side: THREE.DoubleSide,
    depthWrite: false
  });

  for (let i = -16; i <= 16; i += 2) {
    const pane = new THREE.Mesh(new THREE.BoxGeometry(1.86, 7.6, 0.07), glass.clone());
    pane.position.set(i, 4.35, -13.67);
    pane.receiveShadow = false;
    scene.add(pane);
    if (i < 16) box(0.055, 7.9, 0.12, 0x263746, i + 0.96, 4.35, -13.58, { metal: 0.75, rough: 0.25, cast: false });
  }

  for (const side of [-1, 1]) {
    for (let z = -11.5; z <= 10.5; z += 2.35) {
      const pane = new THREE.Mesh(new THREE.BoxGeometry(0.07, 7.5, 2.16), glass.clone());
      pane.position.set(side * 17.72, 4.35, z);
      scene.add(pane);
    }
  }
}

function buildCity(count) {
  const rand = seededRandom(31071999);
  const buildingGeo = new THREE.BoxGeometry(1, 1, 1);
  const buildingMat = new THREE.MeshStandardMaterial({ color: 0x07111e, roughness: 0.92, metalness: 0.05, emissive: 0x071322, emissiveIntensity: 0.55 });
  const buildings = new THREE.InstancedMesh(buildingGeo, buildingMat, count);
  buildings.castShadow = false;
  buildings.receiveShadow = false;
  const dummy = new THREE.Object3D();
  const lightPositions = [];

  for (let i = 0; i < count; i++) {
    const w = 1.2 + rand() * 2.8;
    const h = 2.4 + rand() * 10.5;
    const d = 1.4 + rand() * 3.4;
    const x = -30 + rand() * 60;
    const z = -18 - rand() * 32;
    dummy.position.set(x, h / 2 - 0.3, z);
    dummy.scale.set(w, h, d);
    dummy.updateMatrix();
    buildings.setMatrixAt(i, dummy.matrix);

    const windows = 1 + Math.floor(rand() * 4);
    for (let j = 0; j < windows; j++) {
      if (rand() > 0.36) lightPositions.push(x + (rand() - 0.5) * w * 0.6, 0.8 + rand() * Math.max(1, h - 1), z + d * 0.52);
    }
  }
  scene.add(buildings);

  const pointsGeo = new THREE.BufferGeometry();
  pointsGeo.setAttribute('position', new THREE.Float32BufferAttribute(lightPositions, 3));
  const pointsMat = new THREE.PointsMaterial({ color: 0xffdca0, size: 0.09, transparent: true, opacity: 0.88, sizeAttenuation: true });
  scene.add(new THREE.Points(pointsGeo, pointsMat));

  const skylineGlow = new THREE.PointLight(0x2b79bf, 12, 70, 2);
  skylineGlow.position.set(0, 7, -28);
  scene.add(skylineGlow);
}

function buildCeilingLights() {
  for (const z of [-9, -3.5, 2, 7.5]) {
    for (const x of [-10, 0, 10]) {
      const fixture = box(4.6, 0.06, 0.22, 0xd8f6ff, x, 6.72, z, { emissive: 0xb8ebff, emissiveIntensity: 2.4, cast: false, receive: false, rough: 0.1 });
      fixture.material.transparent = true;
      fixture.material.opacity = 0.82;
    }
  }
  box(35.5, 0.12, 27.5, 0x05090e, 0, 6.88, 0, { cast: false, receive: false, rough: 0.85 });
}

function buildLounge() {
  const sofaMat = physicalMaterial({ color: 0x171f2c, roughness: 0.78, clearcoat: 0.12 });
  for (const x of [-6.6, 6.6]) {
    const seat = new THREE.Mesh(new THREE.BoxGeometry(4.1, 0.55, 1.45), sofaMat);
    seat.position.set(x, 0.48, 4.3);
    seat.castShadow = true;
    seat.receiveShadow = true;
    scene.add(seat);
    const back = new THREE.Mesh(new THREE.BoxGeometry(4.1, 1.25, 0.38), sofaMat);
    back.position.set(x, 1.08, 4.94);
    back.rotation.x = -0.1;
    back.castShadow = true;
    scene.add(back);
    colliders.push({ x, z: 4.5, w: 4.7, d: 2.1 });
  }
  box(3.1, 0.22, 1.5, 0x253344, 0, 0.46, 4.5, { physical: true, roughness: 0.32, metalness: 0.2, clearcoat: 0.7 });
  colliders.push({ x: 0, z: 4.5, w: 3.5, d: 1.9 });
}

function buildPlants() {
  for (const [x, z] of [[-16, -11], [16, -11], [-16, 11], [16, 11]]) {
    box(1.05, 0.65, 1.05, 0x222c35, x, 0.32, z, { physical: true, roughness: 0.48, metalness: 0.16, clearcoat: 0.45 });
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 1.15, 8), material(0x4d3326, 0.9));
    trunk.position.set(x, 1.18, z);
    trunk.castShadow = true;
    scene.add(trunk);
    for (let i = 0; i < 5; i++) {
      const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55 - i * 0.035, 1), material(0x155b3f + i * 0x020803, 0.82));
      leaf.position.set(x + (i % 2 ? 0.3 : -0.25), 1.55 + i * 0.22, z + (i % 3 - 1) * 0.16);
      leaf.scale.set(1.15, 0.75, 0.9);
      leaf.castShadow = true;
      scene.add(leaf);
    }
  }
}

function createDesk(x, z, rot = 0) {
  const desk = box(4.4, 0.25, 2, 0x15202e, x, 0.78, z, { physical: true, roughness: 0.28, metalness: 0.28, clearcoat: 0.72 });
  desk.rotation.y = rot;
  box(0.28, 1.45, 0.28, 0x080c12, x - 1.5, 0.2, z, { metal: 0.68, rough: 0.22 });
  box(0.28, 1.45, 0.28, 0x080c12, x + 1.5, 0.2, z, { metal: 0.68, rough: 0.22 });
  const screen = box(1.7, 1.05, 0.11, 0x03080f, x, 1.55, z - 0.7, { emissive: 0x087aa5, emissiveIntensity: 1.25, rough: 0.08, metal: 0.25 });
  screen.rotation.y = rot;
  animatedScreens.push(screen);
  colliders.push({ x, z, w: rot ? 2.8 : 5, d: rot ? 5 : 2.8 });
}

function createTerminal(type, x, z, color, label) {
  box(2.1, 1.15, 1.35, 0x101923, x, 0.58, z, { physical: true, roughness: 0.26, metalness: 0.42, clearcoat: 0.58 });
  const screen = box(1.75, 1.2, 0.1, 0x03080f, x, 1.65, z - 0.48, { emissive: color, emissiveIntensity: 1.45, rough: 0.06, metal: 0.32 });
  screen.userData.type = type;
  animatedScreens.push(screen);
  const halo = new THREE.PointLight(color, 10, 7, 2);
  halo.position.set(x, 2.35, z - 0.2);
  scene.add(halo);
  const sprite = makeLabel(label, color);
  sprite.position.set(x, 3.05, z);
  sprite.scale.set(2.7, 0.7, 1);
  scene.add(sprite);
  terminals.push({ type, x, z, screen, sprite, color });
  colliders.push({ x, z, w: 2.6, d: 2.1 });
}

function makeLabel(text, color) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.font = '800 46px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowBlur = 18;
  ctx.shadowColor = `#${color.toString(16).padStart(6, '0')}`;
  ctx.fillStyle = '#eaf8ff';
  ctx.fillText(text, 256, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
}

function mesh(geometry, mat, parent, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geometry, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

function buildPlayer() {
  const root = new THREE.Group();
  const rig = new THREE.Group();
  root.add(rig);

  const suit = material(0x111722, 0.46, 0.22);
  const suitDark = material(0x090d14, 0.5, 0.26);
  const shirt = material(0xe6edf5, 0.72, 0.02);
  const skin = material(0xc88f6b, 0.82, 0.01);
  const hair = material(0x1a1210, 0.76, 0.02);
  const shoe = material(0x08090c, 0.24, 0.4);
  const tie = material(0x174f78, 0.34, 0.28, 0x06121b, 0.12);

  const hips = mesh(new THREE.CylinderGeometry(0.30, 0.34, 0.36, 10), suitDark, rig, 0, 1.05, 0);
  hips.scale.z = 0.74;
  const torso = mesh(new THREE.CylinderGeometry(0.43, 0.31, 0.86, 12), suit, rig, 0, 1.55, 0);
  torso.scale.z = 0.72;
  mesh(new THREE.BoxGeometry(0.19, 0.58, 0.035), shirt, rig, 0, 1.61, -0.31);
  const tieMesh = mesh(new THREE.BoxGeometry(0.055, 0.46, 0.045), tie, rig, 0, 1.57, -0.34);
  tieMesh.rotation.z = 0.01;
  mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.16, 12), skin, rig, 0, 2.04, 0);

  const head = mesh(new THREE.SphereGeometry(0.315, 22, 18), skin, rig, 0, 2.34, -0.005);
  head.scale.set(0.89, 1.08, 0.92);
  const hairCap = mesh(new THREE.SphereGeometry(0.322, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.52), hair, rig, 0, 2.42, 0.012);
  hairCap.scale.set(0.92, 1.03, 0.94);
  mesh(new THREE.SphereGeometry(0.055, 10, 8), skin, rig, -0.29, 2.34, 0);
  mesh(new THREE.SphereGeometry(0.055, 10, 8), skin, rig, 0.29, 2.34, 0);
  const eyeMat = material(0x101015, 0.6);
  mesh(new THREE.SphereGeometry(0.025, 8, 6), eyeMat, rig, -0.105, 2.39, -0.284);
  mesh(new THREE.SphereGeometry(0.025, 8, 6), eyeMat, rig, 0.105, 2.39, -0.284);
  const nose = mesh(new THREE.ConeGeometry(0.035, 0.11, 8), skin, rig, 0, 2.31, -0.315);
  nose.rotation.x = -Math.PI / 2;

  function createArm(side) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.48, 1.86, 0);
    rig.add(pivot);
    const upper = mesh(new THREE.CapsuleGeometry(0.115, 0.42, 5, 10), suit, pivot, 0, -0.31, 0);
    upper.rotation.z = side * 0.03;
    mesh(new THREE.CapsuleGeometry(0.095, 0.36, 5, 10), suitDark, pivot, 0, -0.74, 0);
    mesh(new THREE.SphereGeometry(0.105, 12, 10), skin, pivot, 0, -1.02, -0.01);
    return pivot;
  }

  function createLeg(side) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.19, 1.02, 0);
    rig.add(pivot);
    mesh(new THREE.CapsuleGeometry(0.145, 0.53, 5, 10), suitDark, pivot, 0, -0.42, 0);
    mesh(new THREE.CapsuleGeometry(0.125, 0.46, 5, 10), suitDark, pivot, 0, -0.98, 0.01);
    const foot = mesh(new THREE.BoxGeometry(0.28, 0.16, 0.47), shoe, pivot, 0, -1.32, -0.1);
    foot.rotation.x = -0.04;
    return pivot;
  }

  const leftArm = createArm(-1);
  const rightArm = createArm(1);
  const leftLeg = createLeg(-1);
  const rightLeg = createLeg(1);

  const pin = mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.02, 12), material(0x56ddff, 0.2, 0.5, 0x56ddff, 1.5), rig, -0.21, 1.76, -0.335);
  pin.rotation.x = Math.PI / 2;

  root.userData = {
    rig,
    torso,
    head,
    leftArm,
    rightArm,
    leftLeg,
    rightLeg,
    walkPhase: 0,
    moveAmount: 0
  };
  root.position.set(0, 0, 4);
  return root;
}

function animatePlayer(dt, moving) {
  if (!player) return;
  const u = player.userData;
  const targetMove = moving ? 1 : 0;
  u.moveAmount = damp(u.moveAmount, targetMove, 10, dt);
  u.walkPhase += dt * (moving ? 8.3 : 2.0);
  const swing = Math.sin(u.walkPhase) * 0.68 * u.moveAmount;
  const smallSwing = Math.sin(u.walkPhase + Math.PI) * 0.52 * u.moveAmount;
  u.leftLeg.rotation.x = swing;
  u.rightLeg.rotation.x = -swing;
  u.leftArm.rotation.x = smallSwing;
  u.rightArm.rotation.x = -smallSwing;
  u.leftArm.rotation.z = 0.04;
  u.rightArm.rotation.z = -0.04;
  u.rig.position.y = Math.abs(Math.sin(u.walkPhase * 2)) * 0.025 * u.moveAmount + Math.sin(performance.now() / 1500) * 0.004;
  u.torso.rotation.z = Math.sin(u.walkPhase) * 0.018 * u.moveAmount;
}

function isBlocked(x, z) {
  if (x < -16.8 || x > 16.8 || z < -12.8 || z > 12.8) return true;
  return colliders.some((c) => Math.abs(x - c.x) < c.w / 2 + 0.5 && Math.abs(z - c.z) < c.d / 2 + 0.5);
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock?.getDelta() || 0, 0.04);
  const canUpdate = running && !paused && panel.classList.contains('hidden') && quarterModal.classList.contains('hidden');
  if (canUpdate) update(dt);
  else animatePlayer(dt, false);
  updateCamera(dt);
  animateEnvironment();
  monitorPerformance(dt);
  renderer?.render(scene, camera);
}

function update(dt) {
  const speed = 5.2;
  const keyForward = (keys.has('w') || keys.has('arrowup') ? 1 : 0) - (keys.has('s') || keys.has('arrowdown') ? 1 : 0);
  const keyStrafe = (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0);
  let forwardInput = keyForward - joystickVector.y;
  let strafeInput = keyStrafe + joystickVector.x;
  const inputLength = Math.hypot(forwardInput, strafeInput);
  const moving = inputLength > 0.055;

  if (moving) {
    forwardInput /= Math.max(1, inputLength);
    strafeInput /= Math.max(1, inputLength);
    const forwardX = -Math.sin(cameraState.yaw);
    const forwardZ = -Math.cos(cameraState.yaw);
    const rightX = Math.cos(cameraState.yaw);
    const rightZ = -Math.sin(cameraState.yaw);
    const vx = forwardX * forwardInput + rightX * strafeInput;
    const vz = forwardZ * forwardInput + rightZ * strafeInput;
    const nx = player.position.x + vx * speed * dt;
    const nz = player.position.z + vz * speed * dt;
    if (!isBlocked(nx, player.position.z)) player.position.x = nx;
    if (!isBlocked(player.position.x, nz)) player.position.z = nz;
    const targetYaw = Math.atan2(-vx, -vz);
    player.rotation.y = dampAngle(player.rotation.y, targetYaw, 13, dt);
  }
  animatePlayer(dt, moving);

  nearestTerminal = findNearestTerminal();
  interactionHint.classList.toggle('hidden', !nearestTerminal);
  if (interactBtn) interactBtn.style.opacity = nearestTerminal ? '1' : '.42';

  elapsedQuarter += dt;
  const remaining = Math.max(0, Math.ceil(QUARTER_SECONDS - elapsedQuarter));
  $('quarterValue').textContent = `${state.quarter} / 8 · ${remaining}s`;
  if (elapsedQuarter >= nextEventAt) {
    triggerEvent();
    nextEventAt += 9 + Math.random() * 7;
  }
  if (elapsedQuarter >= QUARTER_SECONDS) closeQuarter();
}

function dampAngle(current, target, lambda, dt) {
  let delta = (target - current + Math.PI) % (Math.PI * 2) - Math.PI;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return current + delta * (1 - Math.exp(-lambda * dt));
}

function updateCamera(dt) {
  if (!camera || !player) return;
  const target = new THREE.Vector3(player.position.x, 1.52, player.position.z);
  const cp = Math.cos(cameraState.pitch);
  const desired = new THREE.Vector3(
    target.x + Math.sin(cameraState.yaw) * cp * cameraState.distance,
    target.y + Math.sin(cameraState.pitch) * cameraState.distance,
    target.z + Math.cos(cameraState.yaw) * cp * cameraState.distance
  );
  const lerpFactor = 1 - Math.exp(-9 * dt);
  camera.position.lerp(desired, lerpFactor);
  const lookAhead = new THREE.Vector3(-Math.sin(cameraState.yaw), 0, -Math.cos(cameraState.yaw)).multiplyScalar(0.6);
  camera.lookAt(target.clone().add(lookAhead));
}

function animateEnvironment() {
  const t = performance.now() / 1000;
  for (let i = 0; i < animatedScreens.length; i++) {
    const screen = animatedScreens[i];
    const active = terminals.some((terminal) => terminal.screen === screen && nearestTerminal?.type === terminal.type);
    const base = active ? 2.25 : 1.2;
    screen.material.emissiveIntensity = base + Math.sin(t * 1.6 + i) * 0.08;
  }
  for (const terminal of terminals) terminal.sprite.material.opacity = 0.82 + 0.18 * Math.sin(t * 2.1 + terminal.x);
  ambientLights.forEach((light, i) => { light.intensity *= 0.9995 + Math.sin(t * 0.7 + i) * 0.0005; });
}

function monitorPerformance(dt) {
  if (!renderer || performanceState.quality === 'LOW' || performanceState.lowered) return;
  performanceState.sampleTime += dt;
  performanceState.frames++;
  if (performanceState.sampleTime < 5) return;
  const fps = performanceState.frames / performanceState.sampleTime;
  performanceState.sampleTime = 0;
  performanceState.frames = 0;
  if (fps < 38) {
    const current = renderer.getPixelRatio();
    renderer.setPixelRatio(Math.max(1, current - 0.25));
    performanceState.lowered = true;
    $('qualityValue').textContent = `${performanceState.quality}*`;
  }
}

function findNearestTerminal() {
  let best = null;
  let bestD = 2.75;
  for (const t of terminals) {
    const d = Math.hypot(player.position.x - t.x, player.position.z - t.z);
    if (d < bestD) {
      best = t;
      bestD = d;
    }
  }
  return best;
}

function triggerEvent() {
  const ev = events[Math.floor(Math.random() * events.length)];
  const s = strategies[state.strategy];
  const researchBoost = state.research * 0.004;
  const hedgeProtection = state.hedge > 0 && ev.shock < 0 ? Math.min(0.75, 0.35 + state.hedge * 0.12) : 0;
  let impact = ev.shock * (1 - hedgeProtection) * (s.vol / 0.065);
  impact += researchBoost * (ev.shock > 0 ? 1 : 0.25);
  const change = state.capital * impact;
  state.capital = Math.max(5000, state.capital + change);
  state.highWater = Math.max(state.highWater, state.capital);
  state.reputation = clamp(state.reputation + (impact > 0 ? 2 : -3), 0, 100);
  quarterEvents.push({ name: ev.name, impact, change });
  $('eventText').textContent = `${ev.name}: ${ev.text} ${pct(impact)}`;
  ticker.classList.remove('hidden');
  updateHUD();
  save();
}

function closeQuarter() {
  paused = true;
  const s = strategies[state.strategy];
  const analystBoost = state.analysts * 0.0035;
  const researchBoost = state.research * 0.0025;
  const random = (-0.5 + Math.random()) * s.vol;
  const drift = s.expected + analystBoost + researchBoost;
  const impact = drift + random;
  const before = state.capital;
  state.capital = Math.max(5000, state.capital * (1 + impact));
  const qReturn = state.capital / before - 1;
  state.highWater = Math.max(state.highWater, state.capital);
  state.reputation = clamp(state.reputation + (qReturn > 0 ? 4 : -5), 0, 100);
  state.hedge = Math.max(0, state.hedge - 1);
  updateHUD();
  save();

  const finished = state.quarter >= 8 || state.capital >= 1000000 || state.capital <= 10000;
  $('resultTitle').textContent = finished
    ? (state.capital >= 1000000 ? 'Фонд покорил рынок' : state.capital <= 10000 ? 'Фонд почти уничтожен' : '8 кварталов завершены')
    : `Квартал ${state.quarter} закрыт`;
  $('resultText').textContent = finished
    ? `Финальный капитал: ${money(state.capital)}.`
    : `Базовый квартальный результат стратегии ${state.strategy}: ${pct(qReturn)}. Рыночных событий: ${quarterEvents.length}.`;
  const dd = state.capital / state.highWater - 1;
  $('resultStats').innerHTML = `<div><small>КАПИТАЛ</small><strong>${money(state.capital)}</strong></div><div><small>КВАРТАЛЬНЫЙ RETURN</small><strong class="${qReturn >= 0 ? 'positive' : 'negative'}">${pct(qReturn)}</strong></div><div><small>РЕПУТАЦИЯ</small><strong>${Math.round(state.reputation)}/100</strong></div><div><small>DRAWDOWN</small><strong>${pct(dd)}</strong></div>`;
  $('nextQuarterBtn').classList.toggle('hidden', finished);
  $('restartBtn').classList.toggle('hidden', !finished);
  quarterModal.classList.remove('hidden');
}

function nextQuarter() {
  state.quarter += 1;
  elapsedQuarter = 0;
  nextEventAt = 7 + Math.random() * 6;
  quarterEvents = [];
  paused = false;
  quarterModal.classList.add('hidden');
  $('quarterValue').textContent = `${state.quarter} / 8`;
  save();
}

function updateHUD() {
  $('capitalValue').textContent = money(state.capital);
  $('strategyValue').textContent = state.strategy;
  $('quarterValue').textContent = `${state.quarter} / 8`;
}

function openTerminal(type) {
  paused = true;
  panel.classList.remove('hidden');
  const body = $('panelBody');

  if (type === 'market') {
    $('panelKicker').textContent = 'MARKET TERMINAL';
    $('panelTitle').textContent = 'Стратегия портфеля';
    body.innerHTML = `<p class="panel-copy">Выбери риск-профиль на текущий квартал. Доходность здесь не обещание, а игровая модель. Даже пиксельный рынок не подписывает гарантий.</p><div class="strategy-grid">${Object.entries(strategies).map(([k, v]) => `<button class="strategy-btn ${state.strategy === k ? 'active' : ''}" data-strategy="${k}"><b>${v.label}</b><span>${v.desc}<br>Drift ${(v.expected * 100).toFixed(1)}% · Vol ${(v.vol * 100).toFixed(1)}%</span></button>`).join('')}</div>`;
    body.querySelectorAll('[data-strategy]').forEach((b) => {
      b.onclick = () => {
        state.strategy = b.dataset.strategy;
        updateHUD();
        save();
        openTerminal('market');
      };
    });
  } else if (type === 'risk') {
    $('panelKicker').textContent = 'RISK DESK';
    $('panelTitle').textContent = 'Хеджирование';
    const cost = Math.round(12000 * (1 + state.hedge * 0.35));
    body.innerHTML = `<p class="panel-copy">Хедж снижает отрицательный эффект следующего крупного рыночного события. Уровень защиты растёт с каждым слоем.</p><div class="metric-strip"><div><small>HEDGE</small><strong>${state.hedge}</strong></div><div><small>ЦЕНА</small><strong>${money(cost)}</strong></div><div><small>CAPITAL</small><strong>${money(state.capital)}</strong></div></div><div class="action-grid"><button id="buyHedge" class="terminal-action" ${state.capital < cost ? 'disabled' : ''}><b>Купить хедж</b><span>Списывает ${money(cost)} и повышает защиту.</span></button></div>`;
    $('buyHedge').onclick = () => {
      if (state.capital >= cost) {
        state.capital -= cost;
        state.hedge += 1;
        updateHUD();
        save();
        openTerminal('risk');
      }
    };
  } else if (type === 'research') {
    $('panelKicker').textContent = 'RESEARCH LAB';
    $('panelTitle').textContent = 'Исследования';
    const cost = Math.round(18000 * (1 + state.research * 0.5));
    body.innerHTML = `<p class="panel-copy">Research постепенно добавляет небольшой положительный edge и усиливает реакцию на хорошие события.</p><div class="metric-strip"><div><small>LEVEL</small><strong>${state.research}</strong></div><div><small>ЦЕНА</small><strong>${money(cost)}</strong></div><div><small>EDGE/Q</small><strong>+${(state.research * 0.25).toFixed(2)}%</strong></div></div><div class="action-grid"><button id="buyResearch" class="terminal-action" ${state.capital < cost ? 'disabled' : ''}><b>Улучшить модели</b><span>Инвестировать ${money(cost)} в research.</span></button></div>`;
    $('buyResearch').onclick = () => {
      if (state.capital >= cost) {
        state.capital -= cost;
        state.research += 1;
        updateHUD();
        save();
        openTerminal('research');
      }
    };
  } else {
    $('panelKicker').textContent = 'TEAM DESK';
    $('panelTitle').textContent = 'Команда';
    const cost = Math.round(22000 * (1 + state.analysts * 0.55));
    body.innerHTML = `<p class="panel-copy">Аналитики дают небольшой постоянный бонус к квартальному drift. Люди стоят денег, удивительно.</p><div class="metric-strip"><div><small>АНАЛИТИКИ</small><strong>${state.analysts}</strong></div><div><small>НАЙМ</small><strong>${money(cost)}</strong></div><div><small>BONUS/Q</small><strong>+${(state.analysts * 0.35).toFixed(2)}%</strong></div></div><div class="action-grid"><button id="hireAnalyst" class="terminal-action" ${state.capital < cost ? 'disabled' : ''}><b>Нанять аналитика</b><span>Стоимость ${money(cost)}.</span></button></div>`;
    $('hireAnalyst').onclick = () => {
      if (state.capital >= cost) {
        state.capital -= cost;
        state.analysts += 1;
        updateHUD();
        save();
        openTerminal('hr');
      }
    };
  }
}

function closePanel() {
  panel.classList.add('hidden');
  paused = false;
}

function interact() {
  if (nearestTerminal && panel.classList.contains('hidden')) openTerminal(nearestTerminal.type);
}

function startGame(fromSave = false) {
  if (fromSave) {
    const saved = load();
    if (saved) state = { ...freshState(), ...saved };
  } else {
    state = freshState();
    save();
  }
  elapsedQuarter = 0;
  nextEventAt = 7 + Math.random() * 5;
  quarterEvents = [];
  running = true;
  paused = false;
  if (!renderer) init3D();
  player.position.set(0, 0, 4);
  startScreen.classList.add('hidden');
  hud.classList.remove('hidden');
  ticker.classList.remove('hidden');
  if (isTouch) {
    joystick.classList.remove('hidden');
    interactBtn.classList.remove('hidden');
  }
  $('eventText').textContent = 'Пройди к терминалам MARKET, RISK, RESEARCH и TEAM.';
  updateHUD();
  showCameraHint();
}

function showCameraHint() {
  cameraHint.textContent = isTouch
    ? 'Проводи пальцем по правой части экрана, чтобы осматриваться'
    : 'Drag мышью — свободный обзор · колесо — zoom';
  cameraHint.classList.remove('hidden');
  setTimeout(() => cameraHint.classList.add('hidden'), 6500);
}

function save() {
  localStorage.setItem(SAVE_KEY, JSON.stringify(state));
}

function load() {
  try {
    return JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
  } catch {
    return null;
  }
}

function saveCameraSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({
    yaw: cameraState.yaw,
    pitch: cameraState.pitch,
    distance: cameraState.distance
  }));
}

function loadCameraSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
    if (!s) return;
    if (Number.isFinite(s.yaw)) cameraState.yaw = s.yaw;
    if (Number.isFinite(s.pitch)) cameraState.pitch = clamp(s.pitch, cameraState.minPitch, cameraState.maxPitch);
    if (Number.isFinite(s.distance)) cameraState.distance = clamp(s.distance, cameraState.minDistance, cameraState.maxDistance);
  } catch {}
}

function setupCameraControls() {
  let pointerId = null;
  let lastX = 0;
  let lastY = 0;

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    if (!running || !panel.classList.contains('hidden') || !quarterModal.classList.contains('hidden')) return;
    if (isTouch && e.clientX < innerWidth * 0.43) return;
    if (!isTouch && e.button !== 0 && e.button !== 2) return;
    pointerId = e.pointerId;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture?.(pointerId);
    cameraHint.classList.add('hidden');
  });

  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerId !== pointerId) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    const sensitivity = cameraState.sensitivity * (isTouch ? 1.2 : 1);
    cameraState.yaw -= dx * sensitivity;
    cameraState.pitch = clamp(cameraState.pitch + dy * sensitivity * 0.74, cameraState.minPitch, cameraState.maxPitch);
  });

  const endPointer = (e) => {
    if (e.pointerId !== pointerId) return;
    pointerId = null;
    saveCameraSettings();
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);

  canvas.addEventListener('wheel', (e) => {
    if (!running) return;
    e.preventDefault();
    cameraState.distance = clamp(cameraState.distance + e.deltaY * 0.008, cameraState.minDistance, cameraState.maxDistance);
    saveCameraSettings();
  }, { passive: false });
}

function resizeRenderer() {
  if (!renderer || !camera) return;
  const width = Math.max(1, innerWidth);
  const height = Math.max(1, innerHeight);
  camera.aspect = width / height;
  camera.fov = height > width ? 54 : 49;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}

function setupJoystick() {
  const base = joystick.querySelector('.stick-base');
  const knob = $('stickKnob');
  let pointer = null;
  const R = 34;

  const updateStick = (e) => {
    const r = base.getBoundingClientRect();
    let dx = e.clientX - (r.left + r.width / 2);
    let dy = e.clientY - (r.top + r.height / 2);
    const len = Math.hypot(dx, dy) || 1;
    if (len > R) {
      dx = dx / len * R;
      dy = dy / len * R;
    }
    knob.style.transform = `translate(${dx}px,${dy}px)`;
    joystickVector = { x: dx / R, y: dy / R };
  };

  base.addEventListener('pointerdown', (e) => {
    pointer = e.pointerId;
    base.setPointerCapture(pointer);
    updateStick(e);
  });
  base.addEventListener('pointermove', (e) => {
    if (e.pointerId === pointer) updateStick(e);
  });
  const end = (e) => {
    if (e.pointerId !== pointer) return;
    pointer = null;
    joystickVector = { x: 0, y: 0 };
    knob.style.transform = 'translate(0,0)';
  };
  base.addEventListener('pointerup', end);
  base.addEventListener('pointercancel', end);
}

$('startBtn').onclick = () => startGame(false);
$('continueBtn').onclick = () => startGame(true);
$('closePanel').onclick = closePanel;
$('nextQuarterBtn').onclick = nextQuarter;
$('restartBtn').onclick = () => {
  quarterModal.classList.add('hidden');
  state = freshState();
  save();
  startGame(false);
};
$('pauseBtn').onclick = () => {
  paused = !paused;
  $('pauseBtn').textContent = paused ? '▶' : 'Ⅱ';
};
interactBtn.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  interact();
});

addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  keys.add(k);
  if (k === 'e') interact();
  if (k === 'escape' && !panel.classList.contains('hidden')) closePanel();
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => keys.clear());
addEventListener('resize', resizeRenderer);
addEventListener('orientationchange', () => setTimeout(resizeRenderer, 120));
visualViewport?.addEventListener('resize', resizeRenderer);

setupJoystick();
if (load()) $('continueBtn').classList.remove('hidden');
if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
