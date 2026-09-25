const $ = (id) => document.getElementById(id)
const menu = $('menu')
const gameScreen = $('gameScreen')
const canvas = $('gameCanvas')
const ctx = canvas.getContext('2d')
const modal = $('modal')
const continueBtn = $('continueBtn')
const newBtn = $('newBtn')
const menuBtn = $('menuBtn')
const pauseBtn = $('pauseBtn')
const banner = $('banner')
const yearLabel = $('yearLabel')
const capitalLabel = $('capitalLabel')
const timerLabel = $('timerLabel')
const diversifyLabel = $('diversifyLabel')
const shieldLabel = $('shieldLabel')
const modalEyebrow = $('modalEyebrow')
const modalTitle = $('modalTitle')
const modalMeta = $('modalMeta')
const upgradeList = $('upgradeList')

const W = canvas.width
const H = canvas.height
const YEAR_SECONDS = 40
const WIN_YEAR = 5
const SAVE_KEY = 'capital-run-save-v1'

const colors = {
  bg: '#091827', grid: '#18344f', green: '#5ef2a4', blue: '#50a7ff', gold: '#ffc857', purple: '#b887ff', red: '#ff6170', white: '#f7fbff'
}

const input = { left:false, right:false, up:false, down:false }
const freshSave = () => ({ year:1, capital:100000, bestCapital:100000, upgrades:{ shield:0, speed:0, yield:0 } })
let save = freshSave()
let running = false
let paused = false
let raf = 0
let last = 0
let secondAccumulator = 0
let assetSpawnAccumulator = 0
let shockSpawnAccumulator = 0
let timeLeft = YEAR_SECONDS
let shield = 0
let collected = new Set()
let assets = []
let shocks = []
let particles = []
let floating = []
let bannerTimer = 0
let gameOverLock = false

const player = { x:W/2, y:H/2, r:20, vx:0, vy:0 }

function loadSave(){
  try { const v = JSON.parse(localStorage.getItem(SAVE_KEY)); return v && typeof v.capital === 'number' ? v : null } catch { return null }
}
function writeSave(){ localStorage.setItem(SAVE_KEY, JSON.stringify(save)) }
function clearSave(){ localStorage.removeItem(SAVE_KEY) }
function money(v){ return '$' + Math.round(v).toLocaleString('en-US') }
function clamp(v,a,b){ return Math.max(a, Math.min(b,v)) }
function rand(a,b){ return a + Math.random()*(b-a) }
function hit(a,b,rr){ const dx=a.x-b.x, dy=a.y-b.y; return dx*dx+dy*dy < rr*rr }
function vibrate(pattern){ if ('vibrate' in navigator) navigator.vibrate(pattern) }

function updateMenu(){
  const stored = loadSave()
  continueBtn.textContent = stored ? `ПРОДОЛЖИТЬ · ГОД ${stored.year}` : 'НОВАЯ ИГРА'
}

function showMenu(){
  stopLoop()
  modal.classList.add('hidden')
  gameScreen.classList.add('hidden')
  menu.classList.remove('hidden')
  updateMenu()
}

function begin(data){
  save = structuredClone(data ?? freshSave())
  menu.classList.add('hidden')
  modal.classList.add('hidden')
  gameScreen.classList.remove('hidden')
  gameOverLock = false
  resetYear()
  startLoop()
}

function resetYear(){
  player.x=W/2; player.y=H/2; player.vx=0; player.vy=0
  timeLeft = YEAR_SECONDS
  shield = Math.min(60, save.upgrades.shield * 15)
  collected = new Set()
  assets=[]; shocks=[]; particles=[]; floating=[]
  secondAccumulator=0; assetSpawnAccumulator=0; shockSpawnAccumulator=0
  paused=false
  pauseBtn.textContent='Ⅱ'
  showBanner(`ГОД ${save.year}`, 1.1)
  updateHud()
}

function startLoop(){
  running=true; last=performance.now(); cancelAnimationFrame(raf); raf=requestAnimationFrame(loop)
}
function stopLoop(){ running=false; cancelAnimationFrame(raf) }

function loop(now){
  if(!running) return
  const dt=Math.min(.034,(now-last)/1000 || 0); last=now
  if(!paused && !gameOverLock) update(dt)
  draw()
  raf=requestAnimationFrame(loop)
}

function update(dt){
  const speed=225 + save.upgrades.speed*24
  const ax=(input.right?1:0)-(input.left?1:0)
  const ay=(input.down?1:0)-(input.up?1:0)
  const len=Math.hypot(ax,ay)||1
  const targetX=ax?ax/len*speed:0, targetY=ay?ay/len*speed:0
  const response=1-Math.pow(.0001,dt)
  player.vx += (targetX-player.vx)*response
  player.vy += (targetY-player.vy)*response
  if(!ax) player.vx*=Math.pow(.025,dt)
  if(!ay) player.vy*=Math.pow(.025,dt)
  player.x=clamp(player.x+player.vx*dt,28,W-28)
  player.y=clamp(player.y+player.vy*dt,28,H-28)

  secondAccumulator+=dt
  assetSpawnAccumulator+=dt
  shockSpawnAccumulator+=dt
  bannerTimer=Math.max(0,bannerTimer-dt)
  if(bannerTimer===0) banner.classList.add('hidden')

  if(secondAccumulator>=1){
    secondAccumulator-=1; timeLeft-=1; updateHud()
    if(timeLeft<=0){ finishYear(); return }
  }
  if(assetSpawnAccumulator>=.85){ assetSpawnAccumulator=0; spawnAsset() }
  const shockDelay=Math.max(.95,1.95-save.year*.13)
  if(shockSpawnAccumulator>=shockDelay){ shockSpawnAccumulator=0; spawnShock() }

  for(const a of assets) a.life-=dt
  assets=assets.filter(a=>a.life>0)
  for(const s of shocks){
    s.life-=dt
    const dx=player.x-s.x, dy=player.y-s.y, d=Math.hypot(dx,dy)||1
    const chase=52+save.year*8
    s.x+=dx/d*chase*dt; s.y+=dy/d*chase*dt; s.rot+=dt*2.2
  }
  shocks=shocks.filter(s=>s.life>0)

  for(let i=assets.length-1;i>=0;i--){ if(hit(player,assets[i],player.r+assets[i].r)){ collectAsset(assets[i]); assets.splice(i,1) } }
  for(let i=shocks.length-1;i>=0;i--){ if(hit(player,shocks[i],player.r+shocks[i].r)){ hitShock(shocks[i]); shocks.splice(i,1); if(gameOverLock) return } }
  for(const p of particles){ p.x+=p.vx*dt; p.y+=p.vy*dt; p.life-=dt }
  particles=particles.filter(p=>p.life>0)
  for(const f of floating){ f.y-=32*dt; f.life-=dt }
  floating=floating.filter(f=>f.life>0)
}

function spawnAsset(){
  if(assets.length>=9) return
  const kinds=['tech','bond','health']; const kind=kinds[Math.floor(Math.random()*kinds.length)]
  assets.push({ kind, x:rand(34,W-34), y:rand(34,H-34), r:15, life:6.5, pulse:Math.random()*6.28 })
}
function spawnShock(){
  if(shocks.length>=7) return
  const edge=Math.floor(Math.random()*4); let x,y
  if(edge===0){x=18;y=rand(24,H-24)} else if(edge===1){x=W-18;y=rand(24,H-24)} else if(edge===2){x=rand(24,W-24);y=18} else {x=rand(24,W-24);y=H-18}
  shocks.push({x,y,r:17,life:9,rot:0})
}

function collectAsset(a){
  collected.add(a.kind)
  const mult=1+(collected.size-1)*.18
  const yieldBoost=1+save.upgrades.yield*.12
  const base=a.kind==='tech'?1700:a.kind==='bond'?1050:1350
  const gain=Math.round(base*mult*yieldBoost)
  save.capital+=gain
  if(a.kind==='bond') shield=Math.min(100,shield+12)
  floating.push({x:player.x,y:player.y-24,text:`+${money(gain)}`,color:colors.green,life:.8})
  burst(player.x,player.y,a.kind==='tech'?colors.blue:a.kind==='bond'?colors.gold:colors.purple)
  vibrate(18); updateHud()
}

function hitShock(){
  const gross=Math.round(save.capital*(.035+save.year*.005))
  const absorbed=Math.min(gross,Math.round(gross*(shield/100)))
  const loss=Math.max(500,gross-absorbed)
  save.capital=Math.max(0,save.capital-loss)
  shield=Math.max(0,shield-22)
  floating.push({x:player.x,y:player.y-24,text:`−${money(loss)}`,color:colors.red,life:1})
  burst(player.x,player.y,colors.red,14); vibrate([35,30,35]); updateHud()
  if(save.capital<=0) endGame(false)
}

function finishYear(){
  if(gameOverLock) return
  gameOverLock=true
  save.bestCapital=Math.max(save.bestCapital,save.capital)
  if(save.year>=WIN_YEAR){ endGame(true); return }
  writeSave(); showUpgrade()
}

function showUpgrade(){
  modalEyebrow.textContent=`ГОД ${save.year} ЗАКРЫТ`
  modalTitle.textContent='Выбери улучшение'
  modalMeta.textContent=`Капитал: ${money(save.capital)} · следующий цикл будет агрессивнее.`
  menuBtn.classList.add('hidden'); upgradeList.innerHTML=''
  const ups=[
    ['shield','ХЕДЖИРОВАНИЕ','+15% стартовой защиты от рыночных шоков'],
    ['speed','ЛИКВИДНОСТЬ','+11% к скорости перемещения по рынку'],
    ['yield','ИССЛЕДОВАНИЯ','+12% к доходу от каждого собранного актива']
  ]
  for(const [id,title,desc] of ups){
    const b=document.createElement('button'); b.className='upgrade'
    b.innerHTML=`<strong>${title} · LVL ${save.upgrades[id]}</strong><span>${desc}</span>`
    b.addEventListener('click',()=>{ save.upgrades[id]++; save.year++; writeSave(); modal.classList.add('hidden'); gameOverLock=false; resetYear() },{once:true})
    upgradeList.appendChild(b)
  }
  modal.classList.remove('hidden')
}

function endGame(won){
  gameOverLock=true
  save.bestCapital=Math.max(save.bestCapital,save.capital); writeSave()
  modalEyebrow.textContent=won?'РЫНОЧНЫЙ ЦИКЛ ПРОЙДЕН':'GAME OVER'
  modalTitle.textContent=won?'Ты пережил 5 лет':'Капитал исчерпан'
  modalMeta.textContent=`Итог: ${money(save.capital)} · лучший капитал: ${money(save.bestCapital)}`
  upgradeList.innerHTML=''
  menuBtn.classList.remove('hidden')
  modal.classList.remove('hidden')
}

function updateHud(){
  yearLabel.textContent=`ГОД ${save.year} / ${WIN_YEAR}`
  capitalLabel.textContent=money(save.capital)
  timerLabel.textContent=`${timeLeft}s`
  diversifyLabel.textContent=`Диверсификация: ${collected.size}/3 · x${(1+(collected.size-1)*.18).toFixed(2)}`
  shieldLabel.textContent=`Защита ${Math.round(shield)}%`
}

function showBanner(text,duration=1){ banner.textContent=text; banner.classList.remove('hidden'); bannerTimer=duration }
function burst(x,y,color,count=9){ for(let i=0;i<count;i++){ const a=Math.random()*Math.PI*2,s=rand(35,105); particles.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:rand(.25,.55),color}) } }

function draw(){
  ctx.clearRect(0,0,W,H); ctx.fillStyle=colors.bg; ctx.fillRect(0,0,W,H)
  ctx.strokeStyle=colors.grid; ctx.lineWidth=1; ctx.globalAlpha=.38
  for(let x=16;x<W;x+=32){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke()}
  for(let y=16;y<H;y+=32){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke()}
  ctx.globalAlpha=1

  for(const a of assets){
    a.pulse+=.05; const r=a.r+Math.sin(a.pulse)*1.5
    const c=a.kind==='tech'?colors.blue:a.kind==='bond'?colors.gold:colors.purple
    ctx.shadowBlur=18; ctx.shadowColor=c; ctx.fillStyle=c; ctx.beginPath();ctx.arc(a.x,a.y,r,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0
    ctx.fillStyle=a.kind==='bond'?'#5d4211':'#f7fbff'; ctx.globalAlpha=.9; ctx.beginPath();ctx.arc(a.x,a.y,5,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1
  }

  for(const s of shocks){
    ctx.save();ctx.translate(s.x,s.y);ctx.rotate(s.rot);ctx.fillStyle=colors.red;ctx.shadowBlur=16;ctx.shadowColor=colors.red;roundRect(ctx,-15,-15,30,30,8);ctx.fill();ctx.shadowBlur=0
    ctx.strokeStyle='#711827';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(-7,-7);ctx.lineTo(7,7);ctx.moveTo(7,-7);ctx.lineTo(-7,7);ctx.stroke();ctx.restore()
  }

  for(const p of particles){ctx.globalAlpha=Math.max(0,p.life*2);ctx.fillStyle=p.color;ctx.beginPath();ctx.arc(p.x,p.y,2.2,0,Math.PI*2);ctx.fill()} ctx.globalAlpha=1

  ctx.shadowBlur=24;ctx.shadowColor=colors.green;ctx.fillStyle=colors.green;ctx.beginPath();ctx.arc(player.x,player.y,player.r,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0
  ctx.strokeStyle='#0b5134';ctx.lineWidth=3;ctx.beginPath();ctx.arc(player.x,player.y,12,0,Math.PI*2);ctx.stroke()
  ctx.beginPath();ctx.moveTo(player.x-9,player.y+4);ctx.lineTo(player.x-2,player.y-3);ctx.lineTo(player.x+5,player.y+2);ctx.lineTo(player.x+11,player.y-8);ctx.stroke()

  ctx.textAlign='center';ctx.font='900 13px Inter, system-ui'
  for(const f of floating){ctx.globalAlpha=Math.max(0,f.life);ctx.fillStyle=f.color;ctx.fillText(f.text,f.x,f.y)} ctx.globalAlpha=1
}

function roundRect(c,x,y,w,h,r){
  const rr=Math.min(r,w/2,h/2); c.beginPath();c.moveTo(x+rr,y);c.arcTo(x+w,y,x+w,y+h,rr);c.arcTo(x+w,y+h,x,y+h,rr);c.arcTo(x,y+h,x,y,rr);c.arcTo(x,y,x+w,y,rr);c.closePath()
}

continueBtn.addEventListener('click',()=>begin(loadSave() ?? freshSave()))
newBtn.addEventListener('click',()=>{clearSave();begin(freshSave())})
menuBtn.addEventListener('click',showMenu)
pauseBtn.addEventListener('click',()=>{
  if(gameOverLock) return; paused=!paused; pauseBtn.textContent=paused?'▶':'Ⅱ'; if(paused) showBanner('ПАУЗА',999); else { bannerTimer=0; banner.classList.add('hidden'); last=performance.now() }
})

const keyMap={ArrowLeft:'left',KeyA:'left',ArrowRight:'right',KeyD:'right',ArrowUp:'up',KeyW:'up',ArrowDown:'down',KeyS:'down'}
addEventListener('keydown',(e)=>{const k=keyMap[e.code];if(k){e.preventDefault();input[k]=true}})
addEventListener('keyup',(e)=>{const k=keyMap[e.code];if(k){e.preventDefault();input[k]=false}})

document.querySelectorAll('.dpad').forEach(btn=>{
  const key=btn.dataset.key
  const down=(e)=>{e.preventDefault();input[key]=true;btn.classList.add('active')}
  const up=(e)=>{e.preventDefault();input[key]=false;btn.classList.remove('active')}
  btn.addEventListener('pointerdown',down);btn.addEventListener('pointerup',up);btn.addEventListener('pointercancel',up);btn.addEventListener('pointerleave',up)
})

document.addEventListener('visibilitychange',()=>{ if(document.hidden && running && !gameOverLock){paused=true;pauseBtn.textContent='▶';showBanner('ПАУЗА',999)} })

if('serviceWorker' in navigator){ addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(()=>{})) }
updateMenu(); draw()
