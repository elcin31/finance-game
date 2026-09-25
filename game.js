import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js';

const $ = (id) => document.getElementById(id);
const canvas = $('gameCanvas');
const startScreen = $('startScreen');
const hud = $('hud');
const ticker = $('eventTicker');
const interactionHint = $('interactionHint');
const joystick = $('joystick');
const interactBtn = $('interactBtn');
const panel = $('panel');
const quarterModal = $('quarterModal');

const SAVE_KEY = 'capital-office-v1';
const isTouch = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;

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
let renderer, scene, camera, player, clock;
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
const QUARTER_SECONDS = 52;

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

function money(n) { return new Intl.NumberFormat('en-US', { style:'currency', currency:'USD', maximumFractionDigits:0 }).format(n); }
function pct(n) { return `${n >= 0 ? '+' : ''}${(n * 100).toFixed(1)}%`; }
function clamp(v,min,max){ return Math.max(min, Math.min(max,v)); }

function init3D() {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.8));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x050b14);
  scene.fog = new THREE.FogExp2(0x050b14, 0.018);

  camera = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, 0.1, 120);
  camera.position.set(0, 7, 11);

  const hemi = new THREE.HemisphereLight(0x7fc9ff, 0x11131c, 1.35);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xd4ecff, 2.2);
  key.position.set(4, 12, 5); key.castShadow = true;
  key.shadow.mapSize.set(1024,1024); key.shadow.camera.left=-18; key.shadow.camera.right=18; key.shadow.camera.top=18; key.shadow.camera.bottom=-18;
  scene.add(key);
  const accent = new THREE.PointLight(0x36d7ff, 24, 22, 2);
  accent.position.set(0, 5, -5); scene.add(accent);

  buildOffice();
  player = buildPlayer();
  scene.add(player);
  clock = new THREE.Clock();
  animate();
}

function mat(color, rough=.6, metal=.05, emissive=0x000000, emissiveIntensity=0) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, emissive, emissiveIntensity });
}

function box(w,h,d,color, x,y,z, opts={}) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), mat(color, opts.rough ?? .65, opts.metal ?? .08, opts.emissive ?? 0x000000, opts.emissiveIntensity ?? 0));
  mesh.position.set(x,y,z); mesh.castShadow = opts.cast ?? true; mesh.receiveShadow = true; scene.add(mesh); return mesh;
}

function buildOffice() {
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(36,28), mat(0x111925,.88,.02));
  floor.rotation.x = -Math.PI/2; floor.receiveShadow = true; scene.add(floor);
  const grid = new THREE.GridHelper(36, 36, 0x18344d, 0x112638); grid.position.y=.012; scene.add(grid);

  box(36,.8,.6,0x131c29,0,.4,-14,{cast:false});
  box(.6,.8,28,0x131c29,-18,.4,0,{cast:false});
  box(.6,.8,28,0x131c29,18,.4,0,{cast:false});

  for (let i=-8;i<=8;i+=2) {
    const pane = box(1.78,8,.12,0x102b43,i,4.3,-13.64,{rough:.15,metal:.25,emissive:0x102a40,emissiveIntensity:.6,cast:false});
    pane.material.transparent=true; pane.material.opacity=.72;
  }
  for (let i=-15;i<=15;i+=2.4) {
    const h=2+Math.random()*6, w=1.2+Math.random()*.7;
    box(w,h,.8,0x07101c,i,h/2,-16-Math.random()*4,{emissive:0x102138,emissiveIntensity:.35,cast:false});
    if(Math.random()>.45){ box(w*.6,.08,.03,0x8fdfff,i,h*.65,-15.55-Math.random()*4,{emissive:0x58d8ff,emissiveIntensity:2,cast:false}); }
  }

  box(7,.35,3.2,0x172333,0,.85,-2,{rough:.32,metal:.25});
  box(.35,1.6,.35,0x0b111b,-2.5,.3,-2,{metal:.5}); box(.35,1.6,.35,0x0b111b,2.5,.3,-2,{metal:.5});
  colliders.push({x:0,z:-2,w:7.7,d:3.8});

  createDesk(-10,2,Math.PI/2); createDesk(10,2,-Math.PI/2);
  createDesk(-10,-6,Math.PI/2); createDesk(10,-6,-Math.PI/2);

  createTerminal('market', -12, 8, 0x32d6ff, 'MARKET');
  createTerminal('risk', 12, 8, 0xffa45c, 'RISK');
  createTerminal('research', -12, -10, 0xaa7cff, 'RESEARCH');
  createTerminal('hr', 12, -10, 0x67f3a5, 'TEAM');

  box(8,.32,2.6,0x1b2736,0,.82,9,{rough:.32,metal:.28});
  const monitor=box(3.5,2,.16,0x08121f,0,2.05,8.6,{emissive:0x124c66,emissiveIntensity:1.2});
  monitor.rotation.x=-.05; colliders.push({x:0,z:9,w:9,d:3.5});
  const sign = makeLabel('CAPITAL OFFICE', 0x57e0ff); sign.position.set(0,5.8,-13.2); sign.scale.set(5.2,1.3,1); scene.add(sign);

  for (const [x,z] of [[-16,-11],[16,-11],[-16,11],[16,11]]) {
    box(1,.65,1,0x26313d,x,.32,z,{cast:true});
    const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(.9,1), mat(0x1f714b,.8)); crown.position.set(x,1.3,z); crown.castShadow=true; scene.add(crown);
  }
}

function createDesk(x,z,rot=0){
  const desk=box(4.4,.25,2,0x182534,x,.78,z,{rough:.4,metal:.2}); desk.rotation.y=rot;
  box(.28,1.45,.28,0x0b111b,x-1.5,.2,z,{metal:.5}); box(.28,1.45,.28,0x0b111b,x+1.5,.2,z,{metal:.5});
  const screen=box(1.6,1.05,.12,0x06111d,x,1.55,z-.7,{emissive:0x0c789e,emissiveIntensity:1.1}); screen.rotation.y=rot;
  colliders.push({x,z,w:rot ? 2.8 : 5,d:rot ? 5 : 2.8});
}

function createTerminal(type,x,z,color,label){
  box(2.1,1.15,1.35,0x14202d,x,.58,z,{metal:.25});
  const screen=box(1.75,1.2,.12,0x07111c,x,1.65,z-.48,{emissive:color,emissiveIntensity:1.25,rough:.2,metal:.35});
  screen.userData.type=type;
  const halo = new THREE.PointLight(color, 10, 7, 2); halo.position.set(x,2.4,z); scene.add(halo);
  const sprite=makeLabel(label,color); sprite.position.set(x,3.05,z); sprite.scale.set(2.7,.7,1); scene.add(sprite);
  terminals.push({type,x,z,screen,sprite}); colliders.push({x,z,w:2.6,d:2.1});
}

function makeLabel(text,color){
  const c=document.createElement('canvas'); c.width=512;c.height=128; const ctx=c.getContext('2d');
  ctx.clearRect(0,0,c.width,c.height); ctx.font='800 46px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.shadowBlur=18; ctx.shadowColor=`#${color.toString(16).padStart(6,'0')}`; ctx.fillStyle='#eaf8ff'; ctx.fillText(text,256,64);
  const tex=new THREE.CanvasTexture(c); tex.colorSpace=THREE.SRGBColorSpace;
  return new THREE.Sprite(new THREE.SpriteMaterial({map:tex,transparent:true,depthWrite:false}));
}

function buildPlayer(){
  const g=new THREE.Group();
  const body=new THREE.Mesh(new THREE.CapsuleGeometry(.45,1.0,6,12),mat(0x0d1621,.42,.25)); body.position.y=1.15; body.castShadow=true; g.add(body);
  const head=new THREE.Mesh(new THREE.SphereGeometry(.38,18,18),mat(0xd5aa86,.85)); head.position.y=2.22;head.castShadow=true;g.add(head);
  const visor=new THREE.Mesh(new THREE.BoxGeometry(.55,.12,.06),mat(0x57e0ff,.18,.5,0x57e0ff,1.5));visor.position.set(0,2.27,.35);g.add(visor);
  g.position.set(0,0,4); return g;
}

function isBlocked(x,z){
  if(x<-16.8||x>16.8||z<-12.8||z>12.8)return true;
  return colliders.some(c=>Math.abs(x-c.x)<c.w/2+.55&&Math.abs(z-c.z)<c.d/2+.55);
}

function animate(){
  requestAnimationFrame(animate);
  const dt=Math.min(clock?.getDelta()||0,.035);
  if(running&&!paused&&panel.classList.contains('hidden')&&quarterModal.classList.contains('hidden')) update(dt);
  if(player){
    const desired=new THREE.Vector3(player.position.x,6.4,player.position.z+9.3);
    camera.position.lerp(desired,1-Math.pow(.001,dt));
    camera.lookAt(player.position.x,1.1,player.position.z-1.6);
  }
  for(const t of terminals){ t.screen.material.emissiveIntensity=nearestTerminal?.type===t.type?2.3:1.25; t.sprite.material.opacity=.82+.18*Math.sin(performance.now()/500); }
  renderer?.render(scene,camera);
}

function update(dt){
  const speed=5.4;
  let dx=0,dz=0;
  if(keys.has('w')||keys.has('arrowup')) dz-=1;
  if(keys.has('s')||keys.has('arrowdown')) dz+=1;
  if(keys.has('a')||keys.has('arrowleft')) dx-=1;
  if(keys.has('d')||keys.has('arrowright')) dx+=1;
  dx+=joystickVector.x; dz+=joystickVector.y;
  const len=Math.hypot(dx,dz); if(len>.05){dx/=Math.max(1,len);dz/=Math.max(1,len); const nx=player.position.x+dx*speed*dt,nz=player.position.z+dz*speed*dt;
    if(!isBlocked(nx,player.position.z))player.position.x=nx; if(!isBlocked(player.position.x,nz))player.position.z=nz;
    player.rotation.y=Math.atan2(dx,dz); }
  nearestTerminal=findNearestTerminal();
  interactionHint.classList.toggle('hidden',!nearestTerminal);
  interactBtn.style.opacity=nearestTerminal?'1':'.4';

  elapsedQuarter+=dt;
  const remaining=Math.max(0,Math.ceil(QUARTER_SECONDS-elapsedQuarter));
  $('quarterValue').textContent=`${state.quarter} / 8 · ${remaining}s`;
  if(elapsedQuarter>=nextEventAt){ triggerEvent(); nextEventAt+=9+Math.random()*7; }
  if(elapsedQuarter>=QUARTER_SECONDS) closeQuarter();
}

function findNearestTerminal(){
  let best=null,bestD=2.7;
  for(const t of terminals){const d=Math.hypot(player.position.x-t.x,player.position.z-t.z);if(d<bestD){best=t;bestD=d;}}
  return best;
}

function triggerEvent(){
  const ev=events[Math.floor(Math.random()*events.length)];
  const s=strategies[state.strategy];
  const researchBoost=state.research*.004;
  const hedgeProtection=state.hedge>0&&ev.shock<0?Math.min(.75,.35+state.hedge*.12):0;
  let impact=ev.shock*(1-hedgeProtection)*(s.vol/.065);
  impact+=researchBoost*(ev.shock>0?1:.25);
  const change=state.capital*impact;
  state.capital=Math.max(5000,state.capital+change);
  state.highWater=Math.max(state.highWater,state.capital);
  state.reputation=clamp(state.reputation+(impact>0?2:-3),0,100);
  quarterEvents.push({name:ev.name,impact,change});
  $('eventText').textContent=`${ev.name}: ${ev.text} ${pct(impact)}`;
  ticker.classList.remove('hidden');
  updateHUD(); save();
}

function closeQuarter(){
  paused=true;
  const s=strategies[state.strategy];
  const analystBoost=state.analysts*.0035;
  const researchBoost=state.research*.0025;
  const random=(-.5+Math.random())*s.vol;
  const drift=s.expected+analystBoost+researchBoost;
  const impact=drift+random;
  const before=state.capital;
  state.capital=Math.max(5000,state.capital*(1+impact));
  const qReturn=state.capital/before-1;
  state.highWater=Math.max(state.highWater,state.capital);
  state.reputation=clamp(state.reputation+(qReturn>0?4:-5),0,100);
  state.hedge=Math.max(0,state.hedge-1);
  updateHUD(); save();

  const finished=state.quarter>=8||state.capital>=1000000||state.capital<=10000;
  $('resultTitle').textContent=finished?(state.capital>=1000000?'Фонд покорил рынок':state.capital<=10000?'Фонд почти уничтожен':'8 кварталов завершены'):`Квартал ${state.quarter} закрыт`;
  $('resultText').textContent=finished?`Финальный капитал: ${money(state.capital)}.`:`Базовый квартальный результат стратегии ${state.strategy}: ${pct(qReturn)}. Рыночных событий: ${quarterEvents.length}.`;
  const dd=state.capital/state.highWater-1;
  $('resultStats').innerHTML=`<div><small>КАПИТАЛ</small><strong>${money(state.capital)}</strong></div><div><small>КВАРТАЛЬНЫЙ RETURN</small><strong class="${qReturn>=0?'positive':'negative'}">${pct(qReturn)}</strong></div><div><small>РЕПУТАЦИЯ</small><strong>${Math.round(state.reputation)}/100</strong></div><div><small>DRAWDOWN</small><strong>${pct(dd)}</strong></div>`;
  $('nextQuarterBtn').classList.toggle('hidden',finished);
  $('restartBtn').classList.toggle('hidden',!finished);
  quarterModal.classList.remove('hidden');
}

function nextQuarter(){
  state.quarter+=1; elapsedQuarter=0; nextEventAt=7+Math.random()*6; quarterEvents=[]; paused=false; quarterModal.classList.add('hidden'); $('quarterValue').textContent=`${state.quarter} / 8`; save();
}

function updateHUD(){
  $('capitalValue').textContent=money(state.capital); $('strategyValue').textContent=state.strategy; $('quarterValue').textContent=`${state.quarter} / 8`;
}

function openTerminal(type){
  paused=true; panel.classList.remove('hidden');
  const body=$('panelBody');
  if(type==='market'){
    $('panelKicker').textContent='MARKET TERMINAL'; $('panelTitle').textContent='Стратегия портфеля';
    body.innerHTML=`<p class="panel-copy">Выбери риск-профиль на текущий квартал. Доходность здесь не обещание, а игровая модель. Даже пиксельный рынок не подписывает гарантий.</p><div class="strategy-grid">${Object.entries(strategies).map(([k,v])=>`<button class="strategy-btn ${state.strategy===k?'active':''}" data-strategy="${k}"><b>${v.label}</b><span>${v.desc}<br>Drift ${(v.expected*100).toFixed(1)}% · Vol ${(v.vol*100).toFixed(1)}%</span></button>`).join('')}</div>`;
    body.querySelectorAll('[data-strategy]').forEach(b=>b.onclick=()=>{state.strategy=b.dataset.strategy;updateHUD();save();openTerminal('market');});
  } else if(type==='risk'){
    $('panelKicker').textContent='RISK DESK'; $('panelTitle').textContent='Хеджирование'; const cost=Math.round(12000*(1+state.hedge*.35));
    body.innerHTML=`<p class="panel-copy">Хедж снижает отрицательный эффект следующего крупного рыночного события. Уровень защиты растёт с каждым слоем.</p><div class="metric-strip"><div><small>HEDGE</small><strong>${state.hedge}</strong></div><div><small>ЦЕНА</small><strong>${money(cost)}</strong></div><div><small>CAPITAL</small><strong>${money(state.capital)}</strong></div></div><div class="action-grid"><button id="buyHedge" class="terminal-action" ${state.capital<cost?'disabled':''}><b>Купить хедж</b><span>Списывает ${money(cost)} и повышает защиту.</span></button></div>`;
    $('buyHedge').onclick=()=>{ if(state.capital>=cost){state.capital-=cost;state.hedge+=1;updateHUD();save();openTerminal('risk');} };
  } else if(type==='research'){
    $('panelKicker').textContent='RESEARCH LAB'; $('panelTitle').textContent='Исследования'; const cost=Math.round(18000*(1+state.research*.5));
    body.innerHTML=`<p class="panel-copy">Research постепенно добавляет небольшой положительный edge и усиливает реакцию на хорошие события.</p><div class="metric-strip"><div><small>LEVEL</small><strong>${state.research}</strong></div><div><small>ЦЕНА</small><strong>${money(cost)}</strong></div><div><small>EDGE/Q</small><strong>+${(state.research*.25).toFixed(2)}%</strong></div></div><div class="action-grid"><button id="buyResearch" class="terminal-action" ${state.capital<cost?'disabled':''}><b>Улучшить модели</b><span>Инвестировать ${money(cost)} в research.</span></button></div>`;
    $('buyResearch').onclick=()=>{if(state.capital>=cost){state.capital-=cost;state.research+=1;updateHUD();save();openTerminal('research');}};
  } else {
    $('panelKicker').textContent='TEAM DESK'; $('panelTitle').textContent='Команда'; const cost=Math.round(22000*(1+state.analysts*.55));
    body.innerHTML=`<p class="panel-copy">Аналитики дают небольшой постоянный бонус к квартальному drift. Люди стоят денег, удивительно.</p><div class="metric-strip"><div><small>АНАЛИТИКИ</small><strong>${state.analysts}</strong></div><div><small>НАЙМ</small><strong>${money(cost)}</strong></div><div><small>BONUS/Q</small><strong>+${(state.analysts*.35).toFixed(2)}%</strong></div></div><div class="action-grid"><button id="hireAnalyst" class="terminal-action" ${state.capital<cost?'disabled':''}><b>Нанять аналитика</b><span>Стоимость ${money(cost)}.</span></button></div>`;
    $('hireAnalyst').onclick=()=>{if(state.capital>=cost){state.capital-=cost;state.analysts+=1;updateHUD();save();openTerminal('hr');}};
  }
}

function closePanel(){ panel.classList.add('hidden'); paused=false; }
function interact(){ if(nearestTerminal&&panel.classList.contains('hidden')) openTerminal(nearestTerminal.type); }

function startGame(fromSave=false){
  if(fromSave){const saved=load(); if(saved)state=saved;} else {state=freshState();save();}
  elapsedQuarter=0; nextEventAt=7+Math.random()*5; quarterEvents=[]; running=true;paused=false;
  if(!renderer)init3D();
  player.position.set(0,0,4); startScreen.classList.add('hidden'); hud.classList.remove('hidden'); ticker.classList.remove('hidden');
  if(isTouch){joystick.classList.remove('hidden');interactBtn.classList.remove('hidden');}
  $('eventText').textContent='Пройди к терминалам MARKET, RISK, RESEARCH и TEAM.'; updateHUD();
}

function save(){ localStorage.setItem(SAVE_KEY,JSON.stringify(state)); }
function load(){ try{return JSON.parse(localStorage.getItem(SAVE_KEY)||'null');}catch{return null;} }

$('startBtn').onclick=()=>startGame(false);
$('continueBtn').onclick=()=>startGame(true);
$('closePanel').onclick=closePanel;
$('nextQuarterBtn').onclick=nextQuarter;
$('restartBtn').onclick=()=>{quarterModal.classList.add('hidden');state=freshState();save();startGame(false);};
$('pauseBtn').onclick=()=>{paused=!paused;$('pauseBtn').textContent=paused?'▶':'Ⅱ';};
interactBtn.addEventListener('pointerdown',(e)=>{e.preventDefault();interact();});

addEventListener('keydown',(e)=>{const k=e.key.toLowerCase();keys.add(k);if(k==='e')interact();if(k==='escape'&&!panel.classList.contains('hidden'))closePanel();});
addEventListener('keyup',(e)=>keys.delete(e.key.toLowerCase()));
addEventListener('resize',()=>{if(!renderer)return;camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});

function setupJoystick(){
  const base=joystick.querySelector('.stick-base'), knob=$('stickKnob'); let pointer=null; const R=34;
  const updateStick=(e)=>{const r=base.getBoundingClientRect();let dx=e.clientX-(r.left+r.width/2),dy=e.clientY-(r.top+r.height/2);const len=Math.hypot(dx,dy)||1;if(len>R){dx=dx/len*R;dy=dy/len*R;}knob.style.transform=`translate(${dx}px,${dy}px)`;joystickVector={x:dx/R,y:dy/R};};
  base.addEventListener('pointerdown',(e)=>{pointer=e.pointerId;base.setPointerCapture(pointer);updateStick(e);});
  base.addEventListener('pointermove',(e)=>{if(e.pointerId===pointer)updateStick(e);});
  const end=(e)=>{if(e.pointerId!==pointer)return;pointer=null;joystickVector={x:0,y:0};knob.style.transform='translate(0,0)';};
  base.addEventListener('pointerup',end);base.addEventListener('pointercancel',end);
}
setupJoystick();

if(load()) $('continueBtn').classList.remove('hidden');
if('serviceWorker' in navigator) addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(()=>{}));
