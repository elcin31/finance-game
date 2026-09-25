const CACHE='capital-office-3d-v8-startup-fix';
const LOCAL=['/','/index.html','/styles.css','/game.js','/market.js','/portfolio.js','/tycoon.js','/advanced.js','/world.js','/manifest.webmanifest','/icon.svg','/maskable-icon.svg'];
const THREE='https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js';
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(async cache=>{await cache.addAll(LOCAL);try{await cache.add(THREE)}catch{}}).then(()=>self.skipWaiting()))});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',event=>{if(event.request.method!=='GET')return;event.respondWith(caches.match(event.request).then(hit=>hit||fetch(event.request).then(res=>{const clone=res.clone();caches.open(CACHE).then(c=>c.put(event.request,clone)).catch(()=>{});return res;}).catch(()=>event.request.mode==='navigate'?caches.match('/index.html'):undefined)))});
