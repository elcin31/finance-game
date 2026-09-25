import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js';
import { ASSETS, createMarket, hydrateMarket, advanceMarket, getAssetChange, getResearchSignal } from './market.js';
import { createPortfolio, hydratePortfolio, getNetWorth, getPositionValue, buyByValue, sellFraction, rebalancePortfolio, markPortfolio, addCash, allocation, unrealizedPnL, riskMetrics } from './portfolio.js';
import { createTycoon, hydrateTycoon, staffEffects, officeInfo, totalAum, hireCandidate, upgradeOffice, acceptProspect, runTycoonQuarter, setFeeStructure } from './tycoon.js';
import { createAdvanced, hydrateAdvanced, setLeverage, openShort, closeShort, buyProtectivePut, settleAdvancedTick, maybeComplianceIncident, resolveCompliance, setCrisisScenario, scenarioRegime, updateAchievements, LEVERAGE_LEVELS, CRISIS_SCENARIOS } from './advanced.js';
import { createWorld, hydrateWorld, setLocation, toggleCameraMode, advanceWorldTime, updateCareer, challengeStatus, gameScore, formatClock, LOCATIONS } from './world.js';

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


const PRESETS = {
  Growth: { NXT:.28, BNK:.15, OILX:.15, MED:.12, EST:.10, DEF:.08, GLD:.04, BND:.03 },
  Balanced: { NXT:.18, MED:.12, BNK:.12, OILX:.10, GLD:.10, BND:.20, EST:.08, DEF:.05 },
  Defensive: { BND:.35, GLD:.18, MED:.14, DEF:.12, NXT:.06, BNK:.04, OILX:.03, EST:.03 },
  Cash: { BND:.15, GLD:.05 }
};

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
let officeProgressGroup = null;
let keyLight = null;
let hemiLight = null;
const LOCATION_BOUNDS = { office:{minX:-16.8,maxX:16.8,minZ:-12.8,maxZ:12.8}, apartment:{minX:51,maxX:69,minZ:-9,maxZ:9}, city:{minX:95,maxX:145,minZ:-20,maxZ:20} };
const LOCATION_SPAWNS = { office:[0,0,4], apartment:[60,0,4.5], city:[120,0,14] };
let maxLeverageSeen = 1;

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
  const market = createMarket();
  const tycoon = createTycoon();
  const advanced = createAdvanced();
  const world = createWorld();
  let portfolio = createPortfolio(100000);
  portfolio = rebalancePortfolio(portfolio, market.prices, PRESETS.Balanced);
  portfolio = markPortfolio(portfolio, market.prices);
  return {
    capital: getNetWorth(portfolio, market.prices),
    quarter: 1,
    strategy: 'Balanced',
    research: 0,
    hedge: 0,
    analysts: 0,
    reputation: 50,
    highWater: 100000,
    market,
    portfolio,
    quarterStartValue: getNetWorth(portfolio, market.prices),
    tycoon,
    advanced,
    world
  };
}

function hydrateState(saved) {
  if (!saved) return freshState();
  const market = hydrateMarket(saved.market);
  const tycoon = hydrateTycoon(saved.tycoon);
  const advanced = hydrateAdvanced(saved.advanced);
  const world = hydrateWorld(saved.world);
  let portfolio = hydratePortfolio(saved.portfolio, saved.capital || 100000);
  if (!saved.portfolio) portfolio = rebalancePortfolio(portfolio, market.prices, PRESETS[saved.strategy] || PRESETS.Balanced);
  portfolio = markPortfolio(portfolio, market.prices);
  const capital = getNetWorth(portfolio, market.prices);
  return {
    ...freshState(),
    ...saved,
    market,
    portfolio,
    capital,
    highWater: portfolio.highWater || capital,
    quarterStartValue: saved.quarterStartValue || capital,
    tycoon,
    advanced,
    world,
    analysts: (tycoon.employees || []).filter((e) => /Analyst|Portfolio Manager/.test(e.role)).length
  };
}

function syncCapital() {
  state.capital = getNetWorth(state.portfolio, state.market.prices);
  state.highWater = state.portfolio.highWater || Math.max(state.highWater || 0, state.capital);
  return state.capital;
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
  buildWorldZones();
  player = buildPlayer();
  scene.add(player);
  refreshOfficeProgress();
  loadCameraSettings();
  setupCameraControls();
  clock = new THREE.Clock();
  $('qualityValue').textContent = performanceState.quality;
  animate();
}

function setupLighting(quality) {
  const hemi = new THREE.HemisphereLight(0x8dcfff, 0x101118, 1.45);
  hemiLight = hemi;
  scene.add(hemi);

  const moon = new THREE.DirectionalLight(0xdcecff, 2.5);
  keyLight = moon;
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
  cyan.userData.baseIntensity = cyan.intensity;
  scene.add(cyan);
  ambientLights.push(cyan);

  const warm = new THREE.PointLight(0xffb46e, 18, 16, 2);
  warm.position.set(8, 3.6, 4);
  warm.userData.baseIntensity = warm.intensity;
  scene.add(warm);
  ambientLights.push(warm);

  const violet = new THREE.PointLight(0x775cff, 15, 15, 2);
  violet.position.set(0, 4.6, -10);
  violet.userData.baseIntensity = violet.intensity;
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

  // Central conference table with warm trim.
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
  createTerminal('world', 15.6, 0, 0x91a7ff, 'ELEVATOR');

  // CEO workstation.
  box(8.4, 0.32, 2.65, 0x182433, 0, 0.84, 9, { physical: true, roughness: 0.26, metalness: 0.3, clearcoat: 0.75 });
  const monitor = box(3.6, 2.0, 0.16, 0x050b12, 0, 2.06, 8.58, { emissive: 0x0b5e84, emissiveIntensity: 1.45, rough: 0.12, metal: 0.42 });
  monitor.rotation.x = -0.05;
  animatedScreens.push(monitor);
  colliders.push({ x: 0, z: 9, w: 9, d: 3.5 });
  const managementLabel = makeLabel('MANAGEMENT', 0xffd166);
  managementLabel.position.set(0, 3.35, 8.65);
  managementLabel.scale.set(3.25, .72, 1);
  scene.add(managementLabel);
  terminals.push({ type: 'management', x: 0, z: 8.1, screen: monitor, sprite: managementLabel, color: 0xffd166 });

  const sign = makeLabel('CAPITAL OFFICE', 0x57e0ff);
  sign.position.set(0, 5.75, -13.18);
  sign.scale.set(5.4, 1.35, 1);
  scene.add(sign);

  buildLounge();
  buildPlants();
}


function buildWorldZones() {
  buildApartmentZone();
  buildCityZone();
}

function buildApartmentZone() {
  const cx = 60;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(18,18), physicalMaterial({color:0x171411,roughness:.52,metalness:.04,clearcoat:.28}));
  floor.rotation.x=-Math.PI/2; floor.position.set(cx,0,0); floor.receiveShadow=true; scene.add(floor);
  box(18,.3,.35,0x221d18,cx,.15,-9,{rough:.72});
  box(.35,5.4,18,0x1c1a18,cx-9,2.7,0,{rough:.76});
  box(.35,5.4,18,0x1c1a18,cx+9,2.7,0,{rough:.76});
  box(6,.45,2.4,0x2b3037,cx-3.5,.42,2.8,{rough:.8});
  box(6,1.35,.45,0x242930,cx-3.5,1.05,3.75,{rough:.82});
  box(4.6,.35,2.1,0x30291f,cx+3.9,.8,-3.4,{physical:true,roughness:.34,metalness:.08,clearcoat:.35});
  const laptop=box(1.8,1.05,.09,0x05090d,cx+3.9,1.65,-3.9,{emissive:0x24688d,emissiveIntensity:1.15,rough:.08}); laptop.rotation.x=-.08;
  box(4.7,.55,6.2,0x3a3a40,cx-4.5,.38,-4.5,{rough:.86});
  const skyline=makeLabel('HOME / NIGHT DESK',0xffc98a); skyline.position.set(cx,4.1,-8.55); skyline.scale.set(4.5,.9,1); scene.add(skyline);
  createTerminal('world',cx+7.1,6.8,0x91a7ff,'TRAVEL');
  colliders.push({x:cx-3.5,z:3.1,w:6.8,d:2.2},{x:cx+3.9,z:-3.4,w:5.2,d:2.8},{x:cx-4.5,z:-4.5,w:5.3,d:6.7});
}

function buildCityZone() {
  const cx=120;
  const ground=new THREE.Mesh(new THREE.PlaneGeometry(52,42),mat(0x11151b,.96,.02)); ground.rotation.x=-Math.PI/2; ground.position.set(cx,-.01,0); ground.receiveShadow=true; scene.add(ground);
  const road=new THREE.Mesh(new THREE.PlaneGeometry(15,40),mat(0x090d12,.92,.02)); road.rotation.x=-Math.PI/2; road.position.set(cx,.002,0); scene.add(road);
  for(let z=-17;z<=17;z+=5){const mark=box(.18,.015,2.4,0xe7d58c,cx,.012,z,{emissive:0x6f622e,emissiveIntensity:.15,cast:false});mark.receiveShadow=false}
  for(const side of[-1,1]){
    box(17,.18,40,0x242a31,cx+side*16,.08,0,{cast:false,rough:.92});
    for(let z=-16;z<=16;z+=8){const h=5+((Math.abs(z)+side+20)%7);const b=box(9,h,6.2,side<0?0x101b29:0x171724,cx+side*20,h/2,z,{emissive:side<0?0x0c2338:0x26152e,emissiveIntensity:.45,cast:false});
      for(let y=1.2;y<h-1;y+=1.4){box(.05,.16,4.2,0xffd58a,cx+side*(15.48),y,z,{emissive:0xffb45c,emissiveIntensity:1.1,cast:false})}
    }
  }
  const exchange=makeLabel('CAPITAL EXCHANGE',0x57e0ff); exchange.position.set(cx-16,5.5,-6); exchange.scale.set(4.5,1.0,1); scene.add(exchange);
  const bank=makeLabel('MERIDIAN BANK',0xffd166); bank.position.set(cx+16,5.5,7); bank.scale.set(3.8,.9,1); scene.add(bank);
  createTerminal('world',cx,18,0x91a7ff,'OFFICE / HOME');
  const cityGlow=new THREE.PointLight(0x4d8fff,28,45,2);cityGlow.position.set(cx,8,0);scene.add(cityGlow);
}

function travelTo(location) {
  state.world = setLocation(state.world, location);
  const spawn = LOCATION_SPAWNS[location] || LOCATION_SPAWNS.office;
  player.position.set(...spawn);
  nearestTerminal=null;
  camera.position.set(spawn[0],spawn[1]+5,spawn[2]+8);
  updatePlayerVisibility();
  save();
}

function updatePlayerVisibility(){
  if(player) player.visible = state.world.cameraMode !== 'first';
  if ($('cameraModeBtn')) $('cameraModeBtn').textContent = state.world.cameraMode === 'first' ? '1P' : '3P';
  if ($('locationValue')) $('locationValue').textContent = String(state.world.location || 'office').toUpperCase();
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


function addProgressBox(group, w, h, d, color, x, y, z, opts = {}) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material(color, opts.rough ?? .5, opts.metal ?? .12, opts.emissive ?? 0, opts.emissiveIntensity ?? 0));
  m.position.set(x, y, z);
  m.castShadow = opts.cast ?? true;
  m.receiveShadow = true;
  group.add(m);
  return m;
}

function refreshOfficeProgress() {
  if (!scene || !state?.tycoon) return;
  if (officeProgressGroup) scene.remove(officeProgressGroup);
  const level = officeInfo(state.tycoon).level;
  const group = new THREE.Group();
  officeProgressGroup = group;
  scene.add(group);

  if (level >= 2) {
    for (const x of [-14.7, 14.7]) {
      addProgressBox(group, 3.4, .18, 1.25, 0x1b2b3d, x, .72, -2, { metal: .28, rough: .3 });
      addProgressBox(group, 2.2, 1.05, .08, 0x07111c, x, 1.52, -2.45, { emissive: 0x1d8cb4, emissiveIntensity: 1.15, cast: false });
    }
  }
  if (level >= 3) {
    const glassMat = physicalMaterial({ color: 0x123047, roughness: .08, metalness: .04, transmission: .18, transparent: true, opacity: .32, clearcoat: .8, depthWrite: false, side: THREE.DoubleSide });
    for (const x of [-7.8, 7.8]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(.08, 3.7, 6.1), glassMat.clone());
      wall.position.set(x, 2.05, -8.2);
      group.add(wall);
    }
    const label = makeLabel('INSTITUTIONAL DESK', 0xaa7cff);
    label.position.set(0, 5.25, -8.5);
    label.scale.set(4.3, 1.0, 1);
    group.add(label);
  }
  if (level >= 4) {
    const pedestal = addProgressBox(group, 1.8, .65, 1.8, 0x202a34, 0, .33, 4.6, { metal: .35, rough: .28 });
    pedestal.rotation.y = Math.PI / 4;
    const sculpture = new THREE.Mesh(new THREE.TorusKnotGeometry(.58, .15, 70, 12), material(0xffc857, .24, .72, 0x8f5700, .3));
    sculpture.position.set(0, 1.48, 4.6);
    sculpture.castShadow = true;
    group.add(sculpture);
    const tower = makeLabel('CAPITAL TOWER', 0xffd166);
    tower.position.set(0, 6.15, -13.15);
    tower.scale.set(5.6, 1.15, 1);
    group.add(tower);
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

  // Hips and torso: visibly human proportions instead of the previous capsule-person.
  const hips = mesh(new THREE.CylinderGeometry(0.30, 0.34, 0.36, 10), suitDark, rig, 0, 1.05, 0);
  hips.scale.z = 0.74;
  const torso = mesh(new THREE.CylinderGeometry(0.43, 0.31, 0.86, 12), suit, rig, 0, 1.55, 0);
  torso.scale.z = 0.72;
  const shirtFront = mesh(new THREE.BoxGeometry(0.19, 0.58, 0.035), shirt, rig, 0, 1.61, -0.31);
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
    const fore = mesh(new THREE.CapsuleGeometry(0.095, 0.36, 5, 10), suitDark, pivot, 0, -0.74, 0);
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

  // Subtle rim device on the jacket. It helps silhouette the character without making him a cyberpunk lamp.
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
  const b = LOCATION_BOUNDS[state.world?.location || 'office'] || LOCATION_BOUNDS.office;
  if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) return true;
  return colliders.some((c) => Math.abs(x - c.x) < c.w / 2 + 0.5 && Math.abs(z - c.z) < c.d / 2 + 0.5);
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock?.getDelta() || 0, 0.04);
  const canUpdate = running && !paused && panel.classList.contains('hidden') && quarterModal.classList.contains('hidden');
  if (canUpdate) update(dt);
  else animatePlayer(dt, false);
  updateCamera(dt);
  if (running && !paused) state.world = advanceWorldTime(state.world, dt);
  updateDayNight();
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
  if (state.world?.cameraMode === 'first') {
    const centerPitch=.34, lookPitch=cameraState.pitch-centerPitch, cp=Math.cos(lookPitch);
    const eye=new THREE.Vector3(player.position.x,2.18,player.position.z);
    const dir=new THREE.Vector3(-Math.sin(cameraState.yaw)*cp,-Math.sin(lookPitch),-Math.cos(cameraState.yaw)*cp);
    camera.position.lerp(eye,1-Math.exp(-18*dt));
    camera.lookAt(eye.clone().add(dir));
    return;
  }
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


function updateDayNight() {
  if (!scene || !state.world) return;
  const hour=state.world.hour;
  const daylight=Math.max(0,Math.sin((hour-6)/24*Math.PI*2));
  const dusk=Math.max(0,1-Math.abs(hour-19)/5);
  const night=1-daylight;
  const nightColor=new THREE.Color(0x030810), dayColor=new THREE.Color(0x7297b3);
  scene.background.copy(nightColor).lerp(dayColor,daylight*.68);
  if(scene.fog) scene.fog.color.copy(scene.background);
  if(hemiLight) hemiLight.intensity=.9+daylight*1.15;
  if(keyLight){keyLight.intensity=1.5+daylight*2.3;keyLight.color.set(daylight>.15?0xfff0d4:0xdcecff)}
  ambientLights.forEach((light)=>{const base=light.userData.baseIntensity||light.intensity;light.userData.dayScale=.45+night*.75+dusk*.2;light.userData.renderBase=base*light.userData.dayScale});
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
  ambientLights.forEach((light, i) => {
    const base = light.userData.renderBase || light.userData.baseIntensity || light.intensity;
    light.intensity = base * (1 + Math.sin(t * 0.7 + i) * 0.018);
  });
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
  const before = getNetWorth(state.portfolio, state.market.prices);
  const forcedRegime = scenarioRegime(state.advanced, state.market.step);
  if (forcedRegime) state.market = { ...state.market, regime: forcedRegime, regimeAge: 0 };
  const result = advanceMarket(state.market);
  state.market = result.market;

  let after = getNetWorth(state.portfolio, state.market.prices);
  const advancedTick = settleAdvancedTick(state.advanced, { beforeNet: before, afterNet: after, prices: state.market.prices, previous: state.market.previous, step: state.market.step, highWater: state.portfolio.highWater || before });
  state.advanced = advancedTick.advanced;
  if (advancedTick.cashDelta) state.portfolio = addCash(state.portfolio, advancedTick.cashDelta);
  after = getNetWorth(state.portfolio, state.market.prices);
  let hedgeCompensation = 0;
  if (after < before && state.hedge > 0) {
    const protection = Math.min(.72, .28 + state.hedge * .12);
    hedgeCompensation = (before - after) * protection;
    state.portfolio = addCash(state.portfolio, hedgeCompensation);
  }

  const staff = staffEffects(state.tycoon);
  const alpha = before * (state.research * .00018 + staff.alpha * .000006); 
  if (alpha > 0) state.portfolio = addCash(state.portfolio, alpha);
  state.portfolio = markPortfolio(state.portfolio, state.market.prices);
  after = syncCapital();
  const stepReturn = before > 0 ? after / before - 1 : 0;
  state.reputation = clamp(state.reputation + (stepReturn > .005 ? 2 : stepReturn < -.01 ? -3 : 0), 0, 100);
  quarterEvents.push({ step: state.market.step, return: stepReturn, news: result.news?.title || null, regime: state.market.regime });

  if (result.news) $('eventText').textContent = `${state.market.regime} · ${result.news.symbol}: ${result.news.title} ${pct(result.news.shock)}`;
  else if (result.regimeChanged) $('eventText').textContent = `Режим рынка сменился: ${state.market.regime}`;
  else $('eventText').textContent = `${state.market.regime} · Portfolio ${pct(stepReturn)}${hedgeCompensation > 0 ? ' · hedge сработал' : ''}${advancedTick.notes.length ? ` · ${advancedTick.notes[0]}` : ''}`;
  ticker.classList.remove('hidden');
  updateHUD();
  save();
}

function closeQuarter() {
  paused = true;
  state.portfolio = markPortfolio(state.portfolio, state.market.prices);
  const current = syncCapital();
  const start = state.quarterStartValue || current;
  const qReturn = start > 0 ? current / start - 1 : 0;
  state.reputation = clamp(state.reputation + (qReturn > .03 ? 4 : qReturn < -.05 ? -5 : qReturn > 0 ? 1 : -1), 0, 100);
  state.hedge = Math.max(0, state.hedge - 1);
  const risk = riskMetrics(state.portfolio, state.market.prices);
  const business = runTycoonQuarter(state.tycoon, { quarter: state.quarter, portfolioReturn: qReturn, drawdown: risk.drawdown, reputation: state.reputation });
  state.tycoon = business.tycoon;
  state.portfolio = addCash(state.portfolio, business.netFirmCashFlow);
  const staff = staffEffects(state.tycoon);
  state.advanced = maybeComplianceIncident(state.advanced, { quarter: state.quarter, complianceSkill: staff.compliance, leverage: state.advanced.leverage, reputation: state.reputation });
  if (business.withdrawals > 0) state.reputation = clamp(state.reputation - Math.min(8, 2 + business.clientDelta * -1), 0, 100);
  const currentAfterBusiness = syncCapital();
  const currentRisk = riskMetrics(state.portfolio, state.market.prices);
  state.advanced = updateAchievements(state.advanced, { netWorth: currentAfterBusiness, drawdown: currentRisk.drawdown, concentration: currentRisk.concentration, quarter: state.quarter, aum: totalAum(state.tycoon), clients: state.tycoon.clients.length, employees: state.tycoon.employees.length, officeLevel: state.tycoon.officeLevel });
  state.world = updateCareer(state.world,{netWorth:currentAfterBusiness,aum:totalAum(state.tycoon),officeLevel:state.tycoon.officeLevel,maxLeverage:maxLeverageSeen});
  updateHUD();
  save();

  const finished = state.quarter >= 8 || currentAfterBusiness >= 1000000 || currentAfterBusiness <= 10000;
  $('resultTitle').textContent = finished
    ? (currentAfterBusiness >= 1000000 ? 'Фонд покорил рынок' : currentAfterBusiness <= 10000 ? 'Фонд почти уничтожен' : '8 кварталов завершены')
    : `Квартал ${state.quarter} закрыт`;
  $('resultText').textContent = finished
    ? `Финальная стоимость фирмы: ${money(currentAfterBusiness)}.`
    : `Портфель: ${pct(qReturn)}. Fees: ${money(business.fees)} · расходы: ${money(business.operatingCost)}${business.withdrawals > 0 ? ` · withdrawals ${money(business.withdrawals)}` : ''}. Режим: ${state.market.regime}.`;
  $('resultStats').innerHTML = `<div><small>NET WORTH</small><strong>${money(currentAfterBusiness)}</strong></div><div><small>КВАРТАЛЬНЫЙ RETURN</small><strong class="${qReturn >= 0 ? 'positive' : 'negative'}">${pct(qReturn)}</strong></div><div><small>РЕПУТАЦИЯ</small><strong>${Math.round(state.reputation)}/100</strong></div><div><small>DRAWDOWN</small><strong>${pct(risk.drawdown)}</strong></div>`;
  $('nextQuarterBtn').classList.toggle('hidden', finished);
  $('restartBtn').classList.toggle('hidden', !finished);
  quarterModal.classList.remove('hidden');
}

function nextQuarter() {
  state.quarter += 1;
  elapsedQuarter = 0;
  nextEventAt = 6 + Math.random() * 5;
  quarterEvents = [];
  paused = false;
  quarterModal.classList.add('hidden');
  state.quarterStartValue = syncCapital();
  $('quarterValue').textContent = `${state.quarter} / 8`;
  save();
}

function updateHUD() {
  const net = syncCapital();
  $('capitalValue').textContent = money(net);
  $('strategyValue').textContent = totalAum(state.tycoon) > 0 ? `${state.strategy} · AUM ${money(totalAum(state.tycoon))}` : state.strategy;
  $('quarterValue').textContent = `${state.quarter} / 8`;
  if ($('locationValue')) $('locationValue').textContent = String(state.world?.location || 'office').toUpperCase();
  if ($('cameraModeBtn')) $('cameraModeBtn').textContent = state.world?.cameraMode === 'first' ? '1P' : '3P';
}

function sparkline(values, color) {
  if (!Array.isArray(values) || values.length < 2) return '<span class="spark-empty">—</span>';
  const min = Math.min(...values), max = Math.max(...values), range = Math.max(.0001, max - min);
  const points = values.map((v, i) => `${(i / (values.length - 1) * 100).toFixed(1)},${(28 - (v - min) / range * 24).toFixed(1)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 100 32" preserveAspectRatio="none"><polyline points="${points}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>`;
}

function allocationHtml() {
  const rows = allocation(state.portfolio, state.market.prices).slice(0, 6);
  const cashWeight = state.capital > 0 ? state.portfolio.cash / state.capital : 0;
  return `<div class="allocation-list">${rows.map((r) => `<div class="allocation-row"><span>${r.symbol}</span><div><i style="width:${Math.max(2, r.weight * 100)}%"></i></div><b>${(r.weight * 100).toFixed(0)}%</b></div>`).join('')}<div class="allocation-row cash"><span>CASH</span><div><i style="width:${Math.max(2, cashWeight * 100)}%"></i></div><b>${(cashWeight * 100).toFixed(0)}%</b></div></div>`;
}

function renderMarketTerminal(body) {
  const net = syncCapital();
  const rows = Object.entries(ASSETS).map(([symbol, asset]) => {
    const price = state.market.prices[symbol];
    const change = getAssetChange(state.market, symbol);
    const value = getPositionValue(state.portfolio, state.market.prices, symbol);
    const pnl = unrealizedPnL(state.portfolio, state.market.prices, symbol);
    return `<div class="asset-row"><div class="asset-id"><b>${symbol}</b><span>${asset.name}</span></div><div class="asset-price"><b>${money(price)}</b><span class="${change >= 0 ? 'positive' : 'negative'}">${pct(change)}</span></div><div class="asset-spark">${sparkline(state.market.history[symbol], asset.color)}</div><div class="asset-position"><small>ПОЗИЦИЯ</small><b>${money(value)}</b><span class="${pnl >= 0 ? 'positive' : 'negative'}">P&amp;L ${money(pnl)}</span></div><div class="asset-actions"><button data-buy="${symbol}" ${state.portfolio.cash < 100 ? 'disabled' : ''}>+5%</button><button data-sell="${symbol}" ${value < 10 ? 'disabled' : ''}>−25%</button></div></div>`;
  }).join('');

  body.innerHTML = `<div class="market-summary"><div><small>NET WORTH</small><strong>${money(net)}</strong></div><div><small>CASH</small><strong>${money(state.portfolio.cash)}</strong></div><div><small>REGIME</small><strong>${state.market.regime}</strong></div></div><p class="panel-copy">Можно торговать вручную или мгновенно перестроить портфель по пресету. +5% означает покупку на 5% текущего net worth, −25% — продажу четверти позиции.</p><div class="preset-grid">${Object.keys(PRESETS).map((name) => `<button class="preset-btn ${state.strategy === name ? 'active' : ''}" data-preset="${name}">${name}</button>`).join('')}</div>${allocationHtml()}<div class="asset-table">${rows}</div>`;

  body.querySelectorAll('[data-buy]').forEach((button) => button.onclick = () => {
    const symbol = button.dataset.buy;
    state.portfolio = buyByValue(state.portfolio, symbol, state.market.prices[symbol], Math.min(state.portfolio.cash, net * .05));
    state.portfolio = { ...state.portfolio, lastValue: getNetWorth(state.portfolio, state.market.prices) };
    syncCapital(); save(); renderMarketTerminal(body);
  });
  body.querySelectorAll('[data-sell]').forEach((button) => button.onclick = () => {
    const symbol = button.dataset.sell;
    state.portfolio = sellFraction(state.portfolio, symbol, state.market.prices[symbol], .25);
    state.portfolio = { ...state.portfolio, lastValue: getNetWorth(state.portfolio, state.market.prices) };
    syncCapital(); save(); renderMarketTerminal(body);
  });
  body.querySelectorAll('[data-preset]').forEach((button) => button.onclick = () => {
    state.strategy = button.dataset.preset;
    state.portfolio = rebalancePortfolio(state.portfolio, state.market.prices, PRESETS[state.strategy]);
    state.portfolio = { ...state.portfolio, lastValue: getNetWorth(state.portfolio, state.market.prices) };
    syncCapital(); updateHUD(); save(); renderMarketTerminal(body);
  });
}


function renderTeamTerminal(body) {
  const office = officeInfo(state.tycoon);
  const effects = staffEffects(state.tycoon);
  const nextOffice = state.tycoon.officeLevel < 4 ? officeInfo({ officeLevel: state.tycoon.officeLevel + 1 }) : null;
  const employees = state.tycoon.employees || [];
  const candidates = state.tycoon.candidates || [];
  body.innerHTML = `<div class="team-head"><div><small>ОФИС</small><strong>${office.name}</strong><span>${employees.length}/${office.capacity} сотрудников</span></div><div><small>PAYROLL / Q</small><strong>${money(effects.salary + office.rent)}</strong><span>salary + rent</span></div></div><div class="staff-effects"><span>Research <b>${effects.research.toFixed(0)}</b></span><span>Risk <b>${effects.risk.toFixed(0)}</b></span><span>Alpha <b>${effects.alpha.toFixed(0)}</b></span><span>Clients <b>${effects.client.toFixed(0)}</b></span></div>${employees.length ? `<h3 class="section-title">Команда</h3><div class="employee-list">${employees.map((e) => `<div><div><b>${e.name}</b><span>${e.role}</span></div><div><strong>${e.skill}</strong><small>skill</small></div><div><strong>${money(e.salary)}</strong><small>/ quarter</small></div></div>`).join('')}</div>` : '<p class="panel-copy">Команды пока нет. Очень эффективный payroll, но несколько ограниченная организация.</p>'}<h3 class="section-title">Кандидаты</h3><div class="candidate-grid">${candidates.map((c) => `<button class="candidate-card" data-hire="${c.id}" ${employees.length >= office.capacity || state.portfolio.cash < c.hiringFee ? 'disabled' : ''}><span>${c.role}</span><b>${c.name}</b><em>skill ${c.skill} · ${money(c.salary)}/Q</em><strong>Нанять · ${money(c.hiringFee)}</strong></button>`).join('')}</div>${nextOffice ? `<div class="office-upgrade"><div><small>NEXT OFFICE</small><b>${nextOffice.name}</b><span>Capacity ${nextOffice.capacity} · rent ${money(nextOffice.rent)}/Q</span></div><button id="upgradeOffice" ${state.portfolio.cash < nextOffice.upgradeCost ? 'disabled' : ''}>Upgrade · ${money(nextOffice.upgradeCost)}</button></div>` : '<div class="office-upgrade max"><b>Capital Tower достигнут</b><span>Максимальный office tier.</span></div>'}`;

  body.querySelectorAll('[data-hire]').forEach((button) => button.onclick = () => {
    const candidate = state.tycoon.candidates.find((c) => c.id === button.dataset.hire);
    if (!candidate || state.portfolio.cash < candidate.hiringFee) return;
    const result = hireCandidate(state.tycoon, candidate.id);
    if (!result.hired) return;
    state.tycoon = result.tycoon;
    state.portfolio = addCash(state.portfolio, -candidate.hiringFee);
    state.analysts = state.tycoon.employees.filter((e) => /Analyst|Portfolio Manager/.test(e.role)).length;
    syncCapital(); updateHUD(); save(); renderTeamTerminal(body);
  });
  const upgradeButton = body.querySelector('#upgradeOffice');
  if (upgradeButton) upgradeButton.onclick = () => {
    const result = upgradeOffice(state.tycoon);
    if (!result.upgraded || state.portfolio.cash < result.cost) return;
    state.portfolio = addCash(state.portfolio, -result.cost);
    state.tycoon = result.tycoon;
    refreshOfficeProgress();
    syncCapital(); updateHUD(); save(); renderTeamTerminal(body);
  };
}

function renderManagementTerminal(body) {
  const aum = totalAum(state.tycoon);
  const last = state.tycoon.lastQuarter;
  const clients = state.tycoon.clients || [];
  const prospects = state.tycoon.prospects || [];
  const leaderboard = [...state.tycoon.competitors.map((c) => ({ name: c.name, aum: c.aum, rep: c.reputation })), { name: 'YOU', aum, rep: state.reputation }].sort((a,b) => b.aum - a.aum);
  body.innerHTML = `<div class="management-summary"><div><small>CLIENT AUM</small><strong>${money(aum)}</strong></div><div><small>CLIENTS</small><strong>${clients.length}</strong></div><div><small>REPUTATION</small><strong>${Math.round(state.reputation)}/100</strong></div><div><small>FEES</small><strong>${(state.tycoon.managementFee*100).toFixed(1)}% / ${(state.tycoon.performanceFee*100).toFixed(0)}%</strong></div></div>${last ? `<div class="quarter-business"><span>Fees <b class="positive">${money(last.fees)}</b></span><span>Costs <b class="negative">${money(last.operatingCost)}</b></span><span>Withdrawals <b>${money(last.withdrawals)}</b></span></div>` : ''}<div class="fee-presets"><button data-fees="conservative">1% / 10%</button><button data-fees="standard">1.2% / 12%</button><button data-fees="hedge">2% / 20%</button></div><h3 class="section-title">Prospects</h3><div class="prospect-grid">${prospects.length ? prospects.map((c) => `<button class="prospect-card" data-client="${c.id}"><span>${c.type}</span><b>${c.name}</b><strong>${money(c.aum)}</strong><em>MaxDD ${(c.maxDrawdown*100).toFixed(0)}% · target ${(c.targetReturn*100).toFixed(1)}%</em></button>`).join('') : '<p class="panel-copy">Новых мандатов сейчас нет.</p>'}</div><h3 class="section-title">Clients</h3><div class="client-list">${clients.length ? clients.map((c) => `<div><div><b>${c.name}</b><span>${c.type}</span></div><strong>${money(c.aum)}</strong><small>MaxDD ${(c.maxDrawdown*100).toFixed(0)}%</small></div>`).join('') : '<p class="panel-copy">Ни одного клиента. Зато ни одной жалобы клиента.</p>'}</div><h3 class="section-title">Risk Governance</h3><div class="governance-card"><div><small>COMPLIANCE</small><strong>${state.advanced.complianceScore}/100</strong></div><div><small>LEVERAGE</small><strong>${state.advanced.leverage.toFixed(1)}x</strong></div><div><small>ACHIEVEMENTS</small><strong>${state.advanced.achievements.length}</strong></div></div>${state.advanced.pendingIncident?`<div class="incident-card"><span>COMPLIANCE INCIDENT</span><b>${state.advanced.pendingIncident.type}</b><p>Potential fine ${money(state.advanced.pendingIncident.fine)}.</p><div><button data-compliance="report">Report</button><button data-compliance="fire">Fire & settle</button><button data-compliance="hide">Hide</button></div></div>`:''}<div class="scenario-grid">${CRISIS_SCENARIOS.map((scenario)=>`<button data-scenario="${scenario}" class="${state.advanced.crisisScenario===scenario?'active':''}">${scenario}</button>`).join('')}</div>${state.advanced.achievements.length?`<div class="achievement-list">${state.advanced.achievements.map((a)=>`<span>${a}</span>`).join('')}</div>`:''}<h3 class="section-title">AUM League</h3><div class="leaderboard">${leaderboard.map((c,i) => `<div class="${c.name==='YOU'?'you':''}"><span>${i+1}</span><b>${c.name}</b><strong>${money(c.aum)}</strong><em>REP ${Math.round(c.rep)}</em></div>`).join('')}</div>`;

  body.querySelectorAll('[data-client]').forEach((button) => button.onclick = () => {
    const result = acceptProspect(state.tycoon, button.dataset.client, state.quarter);
    if (!result.client) return;
    state.tycoon = result.tycoon;
    state.reputation = clamp(state.reputation + 1, 0, 100);
    updateHUD(); save(); renderManagementTerminal(body);
  });
  body.querySelectorAll('[data-fees]').forEach((button) => button.onclick = () => {
    const mode = button.dataset.fees;
    state.tycoon = mode === 'conservative' ? setFeeStructure(state.tycoon, .01, .10) : mode === 'hedge' ? setFeeStructure(state.tycoon, .02, .20) : setFeeStructure(state.tycoon, .012, .12);
    save(); renderManagementTerminal(body);
  });
  body.querySelectorAll('[data-scenario]').forEach((button)=>button.onclick=()=>{state.advanced=setCrisisScenario(state.advanced,button.dataset.scenario,state.market.step);save();renderManagementTerminal(body)});
  body.querySelectorAll('[data-compliance]').forEach((button)=>button.onclick=()=>{const resolution=resolveCompliance(state.advanced,button.dataset.compliance);state.advanced=resolution.advanced;state.portfolio=addCash(state.portfolio,resolution.cashDelta);state.reputation=clamp(state.reputation+resolution.reputationDelta,0,100);syncCapital();updateHUD();save();renderManagementTerminal(body)});
}


function renderWorldTerminal(body) {
  const risk=riskMetrics(state.portfolio,state.market.prices), net=syncCapital(), aum=totalAum(state.tycoon);
  state.world=updateCareer(state.world,{netWorth:net,aum,officeLevel:state.tycoon.officeLevel,maxLeverage:maxLeverageSeen});
  const challenge=challengeStatus(state.world,{quarter:state.quarter,maxDrawdown:state.advanced.maxDrawdownSeen,aum,netWorth:net,employees:state.tycoon.employees.length,reputation:state.reputation});
  const score=gameScore({netWorth:net,aum,reputation:state.reputation,employees:state.tycoon.employees.length,achievements:state.advanced.achievements.length,maxDrawdown:state.advanced.maxDrawdownSeen,marginCalls:state.advanced.marginCalls,challengeComplete:challenge.complete});
  body.innerHTML=`<div class="world-head"><div><small>CAREER</small><strong>${state.world.career}</strong><span>${formatClock(state.world)}</span></div><div><small>SCORE</small><strong>${score.toLocaleString('en-US')}</strong><span>${state.world.cameraMode==='first'?'First person':'Third person'}</span></div></div><div class="daily-card ${challenge.complete?'complete':challenge.failed?'failed':''}"><span>DAILY CHALLENGE · SEED ${state.world.challengeSeed}</span><b>${state.world.challenge.title}</b><p>${state.world.challenge.text}</p><i><em style="width:${Math.round(challenge.progress*100)}%"></em></i><small>${challenge.failed?'FAILED':challenge.complete?'COMPLETE':`${Math.round(challenge.progress*100)}%`}</small></div><h3 class="section-title">Travel</h3><div class="location-grid">${LOCATIONS.map((loc)=>`<button data-location="${loc}" class="${state.world.location===loc?'active':''}"><b>${loc.toUpperCase()}</b><span>${loc==='office'?'Trading floor':loc==='apartment'?'Private loft':'Financial district'}</span></button>`).join('')}</div><button id="cameraMode" class="camera-mode-btn">CAMERA · ${state.world.cameraMode==='first'?'FIRST PERSON':'THIRD PERSON'}</button><div class="world-stats"><span>Net worth <b>${money(net)}</b></span><span>AUM <b>${money(aum)}</b></span><span>Drawdown <b>${pct(risk.drawdown)}</b></span><span>Day <b>${state.world.day}</b></span></div>`;
  body.querySelectorAll('[data-location]').forEach((button)=>button.onclick=()=>{travelTo(button.dataset.location);closePanel()});
  body.querySelector('#cameraMode').onclick=()=>{state.world=toggleCameraMode(state.world);updatePlayerVisibility();save();renderWorldTerminal(body)};
}

function openTerminal(type) {
  paused = true;
  panel.classList.remove('hidden');
  const body = $('panelBody');

  if (type === 'market') {
    $('panelKicker').textContent = 'MARKET TERMINAL';
    $('panelTitle').textContent = 'Портфель и рынок';
    renderMarketTerminal(body);
    return;
  }

  if (type === 'world') {
    $('panelKicker').textContent='WORLD / CAREER';
    $('panelTitle').textContent='Capital Life';
    renderWorldTerminal(body);
    return;
  }

  if (type === 'management') {
    $('panelKicker').textContent = 'MANAGEMENT DESK';
    $('panelTitle').textContent = 'AUM & Clients';
    renderManagementTerminal(body);
    return;
  }

  if (type === 'hr') {
    $('panelKicker').textContent = 'TEAM DESK';
    $('panelTitle').textContent = 'People & Office';
    renderTeamTerminal(body);
    return;
  }

  if (type === 'risk') {
    const risk = riskMetrics(state.portfolio, state.market.prices);
    const cost = Math.max(2500, Math.round(risk.net * .025 * (1 + state.hedge * .3)));
    $('panelKicker').textContent = 'RISK DESK';
    $('panelTitle').textContent = 'Риск портфеля';
    body.innerHTML = `<p class="panel-copy">Метрики рассчитаны на игровом price engine. Хедж компенсирует часть следующего отрицательного market tick.</p><div class="risk-grid"><div><small>VOLATILITY</small><strong>${pct(risk.volatility)}</strong></div><div><small>MAX WEIGHT</small><strong>${pct(risk.concentration)}</strong></div><div><small>DRAWDOWN</small><strong>${pct(risk.drawdown)}</strong></div><div><small>SHARPE</small><strong>${risk.sharpe == null ? '—' : risk.sharpe.toFixed(2)}</strong></div><div><small>ASSETS</small><strong>${risk.diversification}</strong></div><div><small>REALIZED P&amp;L</small><strong class="${risk.realizedPnL >= 0 ? 'positive' : 'negative'}">${money(risk.realizedPnL)}</strong></div></div>${allocationHtml()}<h3 class="section-title">Leverage</h3><div class="leverage-grid">${LEVERAGE_LEVELS.map((level)=>`<button data-leverage="${level}" class="${state.advanced.leverage===level?'active':''}">${level.toFixed(1)}x</button>`).join('')}</div><div class="action-grid"><button id="buyHedge" class="terminal-action" ${state.portfolio.cash < cost ? 'disabled' : ''}><b>Купить хедж · ${money(cost)}</b><span>Уровень ${state.hedge}. Защита следующего отрицательного market tick.</span></button><button id="buyPut" class="terminal-action" ${state.portfolio.cash < risk.net*.0022 ? 'disabled' : ''}><b>Protective put · NXT</b><span>Страйк по текущей цене, 6 market ticks, notional 10% net worth.</span></button></div><h3 class="section-title">Short Book</h3><div class="short-grid">${Object.keys(ASSETS).map((symbol)=>{const sh=state.advanced.shorts[symbol];return sh?`<button data-close-short="${symbol}"><b>${symbol} SHORT</b><span>${money(sh.notional)} notional · close</span></button>`:`<button data-open-short="${symbol}" ${state.portfolio.cash < risk.net*.035?'disabled':''}><b>${symbol}</b><span>Short 10% · margin 3.5%</span></button>`}).join('')}</div>`;
    $('buyHedge').onclick = () => {
      if (state.portfolio.cash >= cost) {
        state.portfolio = addCash(state.portfolio, -cost);
        state.hedge += 1;
        syncCapital(); updateHUD(); save(); openTerminal('risk');
      }
    };
    body.querySelectorAll('[data-leverage]').forEach((button)=>button.onclick=()=>{ state.advanced=setLeverage(state.advanced, Number(button.dataset.leverage)); maxLeverageSeen=Math.max(maxLeverageSeen,state.advanced.leverage); save(); openTerminal('risk'); });
    const putButton=body.querySelector('#buyPut');
    if(putButton) putButton.onclick=()=>{ const deal=buyProtectivePut(state.advanced,'NXT',state.market.prices.NXT,risk.net*.10,state.market.step,6); if(deal.bought&&state.portfolio.cash>=deal.cost){state.advanced=deal.advanced;state.portfolio=addCash(state.portfolio,-deal.cost);syncCapital();updateHUD();save();openTerminal('risk')} };
    body.querySelectorAll('[data-open-short]').forEach((button)=>button.onclick=()=>{ const symbol=button.dataset.openShort; const deal=openShort(state.advanced,symbol,state.market.prices[symbol],risk.net*.10); if(deal.opened&&state.portfolio.cash>=deal.margin){state.advanced=deal.advanced;state.portfolio=addCash(state.portfolio,-deal.margin);syncCapital();updateHUD();save();openTerminal('risk')} });
    body.querySelectorAll('[data-close-short]').forEach((button)=>button.onclick=()=>{ const deal=closeShort(state.advanced,button.dataset.closeShort); if(deal.closed){state.advanced=deal.advanced;state.portfolio=addCash(state.portfolio,deal.releasedMargin);syncCapital();updateHUD();save();openTerminal('risk')} });
    return;
  }

  if (type === 'research') {
    const signal = getResearchSignal(state.market, state.research);
    const cost = Math.max(5000, Math.round(state.capital * .035 * (1 + state.research * .45)));
    const news = (state.market.news || []).slice(0, 5);
    $('panelKicker').textContent = 'RESEARCH LAB';
    $('panelTitle').textContent = 'Research & News';
    body.innerHTML = `<div class="research-card"><small>ТЕКУЩИЙ РЕЖИМ</small><strong>${signal.regime}</strong><p>Favored: ${signal.favored.join(', ')} · Weak: ${signal.weak.join(', ')} · confidence ${signal.confidence}%</p></div><div class="news-list">${news.length ? news.map((n) => `<div><span class="${n.tone === 'positive' ? 'positive' : 'negative'}">${n.symbol}</span><b>${n.title}</b><small>${pct(n.shock)}</small></div>`).join('') : '<p class="panel-copy">Новостей пока нет. Рынок подозрительно тих, что обычно и настораживает.</p>'}</div><div class="action-grid"><button id="buyResearch" class="terminal-action" ${state.portfolio.cash < cost ? 'disabled' : ''}><b>Research level ${state.research + 1} · ${money(cost)}</b><span>Повышает качество сигнала и небольшой игровой alpha.</span></button></div>`;
    $('buyResearch').onclick = () => {
      if (state.portfolio.cash >= cost) {
        state.portfolio = addCash(state.portfolio, -cost);
        state.research += 1;
        syncCapital(); updateHUD(); save(); openTerminal('research');
      }
    };
    return;
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
  state = fromSave ? hydrateState(load()) : freshState();
  if (!fromSave) save();
  else syncCapital();
  elapsedQuarter = 0;
  nextEventAt = 6 + Math.random() * 5;
  quarterEvents = [];
  running = true;
  paused = false;
  if (!renderer) init3D();
  const spawn=LOCATION_SPAWNS[state.world.location]||LOCATION_SPAWNS.office;
  player.position.set(...spawn);
  refreshOfficeProgress();
  updatePlayerVisibility();
  startScreen.classList.add('hidden');
  hud.classList.remove('hidden');
  ticker.classList.remove('hidden');
  if (isTouch) {
    joystick.classList.remove('hidden');
    interactBtn.classList.remove('hidden');
  }
  $('eventText').textContent = `${state.world.career} · ${state.market.regime} · ${formatClock(state.world)}`;
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
  startGame(false);
};
$('cameraModeBtn').onclick = () => {
  if (!running) return;
  state.world = toggleCameraMode(state.world);
  updatePlayerVisibility();
  save();
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
  if (k === 'c' && running) { state.world=toggleCameraMode(state.world); updatePlayerVisibility(); save(); }
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
