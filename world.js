const CAREER = [
  { name: 'Bedroom Trader', minNet: 0, minAum: 0, minOffice: 1 },
  { name: 'Independent Trader', minNet: 150000, minAum: 0, minOffice: 1 },
  { name: 'Portfolio Manager', minNet: 220000, minAum: 500000, minOffice: 1 },
  { name: 'Boutique Fund', minNet: 300000, minAum: 2000000, minOffice: 2 },
  { name: 'Asset Manager', minNet: 500000, minAum: 8000000, minOffice: 3 },
  { name: 'Global Investment Firm', minNet: 1000000, minAum: 25000000, minOffice: 4 }
];

const CHALLENGES = [
  { id: 'low-dd', title: 'Risk Discipline', text: 'Заверши 8 кварталов с drawdown лучше −15%.', type: 'drawdown', target: -.15 },
  { id: 'aum-5m', title: 'Capital Magnet', text: 'Доведи client AUM до $5M.', type: 'aum', target: 5000000 },
  { id: 'no-leverage', title: 'Unlevered', text: 'Достигни $250K, не используя leverage выше 1x.', type: 'net', target: 250000 },
  { id: 'team', title: 'Build the Desk', text: 'Найми 5 сотрудников.', type: 'employees', target: 5 },
  { id: 'reputation', title: 'Trusted Capital', text: 'Подними reputation до 80.', type: 'reputation', target: 80 }
];

export const LOCATIONS = ['office', 'apartment', 'city'];
export const CAMERA_MODES = ['third', 'first'];

export function createWorld(date = new Date()) {
  const seed = dateSeed(date);
  return {
    location: 'apartment',
    cameraMode: 'third',
    hour: 20.5,
    day: 1,
    challenge: CHALLENGES[seed % CHALLENGES.length],
    challengeSeed: seed,
    challengeFailed: false,
    visited: ['office'],
    career: 'Bedroom Trader'
  };
}

export function hydrateWorld(input) {
  const base = createWorld();
  if (!input) return base;
  return {
    ...base,
    ...input,
    location: LOCATIONS.includes(input.location) ? input.location : 'office',
    cameraMode: CAMERA_MODES.includes(input.cameraMode) ? input.cameraMode : 'third',
    visited: Array.isArray(input.visited) ? input.visited : ['office']
  };
}

export function setLocation(input, location) {
  const w = hydrateWorld(input);
  if (!LOCATIONS.includes(location)) return w;
  return { ...w, location, visited: [...new Set([...(w.visited || []), location])] };
}

export function toggleCameraMode(input) {
  const w = hydrateWorld(input);
  return { ...w, cameraMode: w.cameraMode === 'third' ? 'first' : 'third' };
}

export function advanceWorldTime(input, dtSeconds) {
  const w = hydrateWorld(input);
  let hour = w.hour + dtSeconds * .05;
  let day = w.day;
  while (hour >= 24) { hour -= 24; day += 1; }
  return { ...w, hour, day };
}

export function updateCareer(input, context) {
  const w = hydrateWorld(input);
  let stage = CAREER[0];
  for (const item of CAREER) {
    if ((context.netWorth || 0) >= item.minNet && (context.aum || 0) >= item.minAum && (context.officeLevel || 1) >= item.minOffice) stage = item;
  }
  const failed = w.challengeFailed || (w.challenge?.id === 'no-leverage' && (context.maxLeverage || 1) > 1);
  return { ...w, career: stage.name, challengeFailed: failed };
}

export function challengeStatus(world, context) {
  const w = hydrateWorld(world);
  const c = w.challenge;
  if (!c) return { progress: 0, complete: false, failed: false };
  let value = 0, complete = false;
  if (c.type === 'drawdown') {
    value = context.quarter >= 8 ? 1 : Math.min(1, (context.quarter || 0) / 8);
    complete = context.quarter >= 8 && (context.maxDrawdown || 0) > c.target;
  } else if (c.type === 'aum') { value = (context.aum || 0) / c.target; complete = value >= 1; }
  else if (c.type === 'net') { value = (context.netWorth || 0) / c.target; complete = value >= 1 && !w.challengeFailed; }
  else if (c.type === 'employees') { value = (context.employees || 0) / c.target; complete = value >= 1; }
  else if (c.type === 'reputation') { value = (context.reputation || 0) / c.target; complete = value >= 1; }
  return { progress: Math.max(0, Math.min(1, value)), complete, failed: !!w.challengeFailed };
}

export function gameScore(context) {
  const netScore = Math.log10(Math.max(1, context.netWorth || 1)) * 900;
  const aumScore = Math.log10(Math.max(1, context.aum || 1)) * 550;
  const repScore = (context.reputation || 0) * 14;
  const teamScore = (context.employees || 0) * 120;
  const achievementScore = (context.achievements || 0) * 300;
  const riskPenalty = Math.abs(Math.min(0, context.maxDrawdown || 0)) * 2500 + (context.marginCalls || 0) * 450;
  const challengeBonus = context.challengeComplete ? 1200 : 0;
  return Math.max(0, Math.round(netScore + aumScore + repScore + teamScore + achievementScore + challengeBonus - riskPenalty));
}

export function formatClock(world) {
  const w = hydrateWorld(world);
  const h = Math.floor(w.hour);
  const m = Math.floor((w.hour - h) * 60);
  return `DAY ${w.day} · ${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}

function dateSeed(date) {
  const y = date.getFullYear(), m = date.getMonth() + 1, d = date.getDate();
  return y * 10000 + m * 100 + d;
}
