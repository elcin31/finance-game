const SCENARIOS = {
  None: null,
  'Dot-com Crash': ['Bubble','Bubble','Bear Market','Bear Market','Recession'],
  'Credit Meltdown': ['Neutral','Credit Crisis','Credit Crisis','Recession','Bear Market'],
  'Pandemic Shock': ['Bull Market','Bear Market','Bear Market','Recession','Bull Market'],
  'Inflation Spiral': ['Neutral','Inflation','Inflation','Credit Crisis','Inflation'],
  'AI Mania': ['Bull Market','Bubble','Bubble','Bubble','Bear Market']
};

export const LEVERAGE_LEVELS = [1, 1.5, 2, 3];
export const CRISIS_SCENARIOS = Object.keys(SCENARIOS);

export function createAdvanced() {
  return {
    leverage: 1,
    shorts: {},
    puts: [],
    marginCalled: false,
    marginCalls: 0,
    complianceScore: 72,
    pendingIncident: null,
    incidentHistory: [],
    crisisScenario: 'None',
    crisisStartStep: 0,
    achievements: [],
    maxDrawdownSeen: 0,
    peakConcentrationSeen: 0,
    bestNetWorth: 100000
  };
}

export function hydrateAdvanced(input) {
  const base = createAdvanced();
  if (!input) return base;
  return {
    ...base,
    ...input,
    shorts: input.shorts && typeof input.shorts === 'object' ? input.shorts : {},
    puts: Array.isArray(input.puts) ? input.puts : [],
    incidentHistory: Array.isArray(input.incidentHistory) ? input.incidentHistory : [],
    achievements: Array.isArray(input.achievements) ? input.achievements : []
  };
}

export function setLeverage(input, leverage) {
  const a = hydrateAdvanced(input);
  return { ...a, leverage: LEVERAGE_LEVELS.includes(leverage) ? leverage : 1, marginCalled: false };
}

export function openShort(input, symbol, price, notional) {
  const a = hydrateAdvanced(input);
  if (!price || notional <= 0 || a.shorts[symbol]) return { advanced: a, margin: 0, opened: false };
  const margin = notional * .35;
  return {
    advanced: {
      ...a,
      shorts: { ...a.shorts, [symbol]: { symbol, notional, entryPrice: price, markPrice: price, margin } }
    },
    margin,
    opened: true
  };
}

export function closeShort(input, symbol) {
  const a = hydrateAdvanced(input);
  const short = a.shorts[symbol];
  if (!short) return { advanced: a, releasedMargin: 0, closed: false };
  const shorts = { ...a.shorts };
  delete shorts[symbol];
  return { advanced: { ...a, shorts }, releasedMargin: short.margin || 0, closed: true };
}

export function buyProtectivePut(input, symbol, price, notional, currentStep, duration = 6) {
  const a = hydrateAdvanced(input);
  if (!price || notional <= 0) return { advanced: a, cost: 0, bought: false };
  const cost = notional * .022;
  const contract = {
    id: `put-${symbol}-${currentStep}-${Math.round(notional)}`,
    symbol,
    strike: price,
    notional,
    startStep: currentStep,
    expiryStep: currentStep + duration,
    lastIntrinsic: 0,
    cost
  };
  return { advanced: { ...a, puts: [...a.puts, contract] }, cost, bought: true };
}

export function settleAdvancedTick(input, context) {
  let a = hydrateAdvanced(input);
  const baseReturn = context.beforeNet > 0 ? context.afterNet / context.beforeNet - 1 : 0;
  let cashDelta = 0;
  const notes = [];

  if (a.leverage > 1) {
    const extraExposure = a.leverage - 1;
    const leveragedPnL = context.beforeNet * baseReturn * extraExposure;
    const financing = context.beforeNet * extraExposure * .00065;
    cashDelta += leveragedPnL - financing;
    if (Math.abs(leveragedPnL) > 1) notes.push(`Leverage ${a.leverage.toFixed(1)}x: ${signedMoney(leveragedPnL - financing)}`);
  }

  const shorts = { ...a.shorts };
  for (const [symbol, short] of Object.entries(shorts)) {
    const current = context.prices[symbol];
    if (!current || !short.markPrice) continue;
    const pnl = short.notional * (short.markPrice / current - 1);
    cashDelta += pnl;
    shorts[symbol] = { ...short, markPrice: current };
    if (Math.abs(pnl) > 1) notes.push(`Short ${symbol}: ${signedMoney(pnl)}`);
  }

  const puts = [];
  for (const put of a.puts) {
    const current = context.prices[put.symbol];
    if (!current) continue;
    const intrinsic = Math.max(0, (put.strike - current) / put.strike * put.notional);
    const delta = intrinsic - (put.lastIntrinsic || 0);
    cashDelta += delta;
    if (delta > 1) notes.push(`Put ${put.symbol}: +${money(delta)}`);
    if (context.step < put.expiryStep) puts.push({ ...put, lastIntrinsic: intrinsic });
  }

  let marginCall = false;
  const projected = context.afterNet + cashDelta;
  const stress = baseReturn < -.055 || projected < Math.max(15000, (context.highWater || projected) * .58);
  if (a.leverage >= 2 && stress) {
    marginCall = true;
    const penalty = Math.max(500, projected * .012);
    cashDelta -= penalty;
    notes.push(`MARGIN CALL: leverage reduced to 1.0x, fee ${money(penalty)}`);
    a = { ...a, leverage: 1, marginCalled: true, marginCalls: (a.marginCalls || 0) + 1 };
  }

  a = { ...a, shorts, puts };
  return { advanced: a, cashDelta, notes, marginCall, baseReturn };
}

export function maybeComplianceIncident(input, context) {
  const a = hydrateAdvanced(input);
  if (a.pendingIncident) return a;
  const riskReduction = Math.min(.7, (context.complianceSkill || 0) / 100);
  const baseChance = .18 + Math.max(0, context.leverage - 1) * .035 + Object.keys(a.shorts).length * .018;
  const threshold = Math.max(.025, baseChance * (1 - riskReduction));
  const roll = deterministicRoll((context.quarter || 1) * 9127 + a.incidentHistory.length * 131 + Math.round(context.reputation || 50));
  if (roll > threshold) return { ...a, complianceScore: Math.min(100, a.complianceScore + 1) };
  const incidents = [
    { type: 'Personal trading breach', fine: 18000, reputationLoss: 4, hiddenRisk: 11 },
    { type: 'Late risk disclosure', fine: 26000, reputationLoss: 5, hiddenRisk: 14 },
    { type: 'Client allocation dispute', fine: 34000, reputationLoss: 7, hiddenRisk: 18 },
    { type: 'Restricted-list violation', fine: 48000, reputationLoss: 9, hiddenRisk: 24 }
  ];
  const incident = incidents[Math.floor(deterministicRoll((context.quarter || 1) * 4561) * incidents.length)];
  return { ...a, pendingIncident: { ...incident, id: `incident-${context.quarter}-${a.incidentHistory.length}`, quarter: context.quarter } };
}

export function resolveCompliance(input, action) {
  const a = hydrateAdvanced(input);
  const incident = a.pendingIncident;
  if (!incident) return { advanced: a, cashDelta: 0, reputationDelta: 0, result: null };
  let cashDelta = 0, reputationDelta = 0, scoreDelta = 0, result = action;
  if (action === 'report') {
    cashDelta = -incident.fine;
    reputationDelta = -Math.max(1, Math.round(incident.reputationLoss * .35));
    scoreDelta = 8;
  } else if (action === 'fire') {
    cashDelta = -incident.fine * .55;
    reputationDelta = 1;
    scoreDelta = 5;
  } else {
    cashDelta = 0;
    reputationDelta = 2;
    scoreDelta = -incident.hiddenRisk;
    result = 'hidden';
  }
  const history = [{ ...incident, action: result }, ...a.incidentHistory].slice(0, 12);
  return {
    advanced: { ...a, pendingIncident: null, incidentHistory: history, complianceScore: Math.max(0, Math.min(100, a.complianceScore + scoreDelta)) },
    cashDelta,
    reputationDelta,
    result
  };
}

export function setCrisisScenario(input, scenario, currentStep = 0) {
  const a = hydrateAdvanced(input);
  return { ...a, crisisScenario: SCENARIOS[scenario] === undefined ? 'None' : scenario, crisisStartStep: currentStep };
}

export function scenarioRegime(input, step) {
  const a = hydrateAdvanced(input);
  const sequence = SCENARIOS[a.crisisScenario];
  if (!sequence) return null;
  const elapsed = Math.max(0, step - (a.crisisStartStep || 0));
  const phase = Math.min(sequence.length - 1, Math.floor(elapsed / 3));
  return sequence[phase];
}

export function updateAchievements(input, context) {
  let a = hydrateAdvanced(input);
  a.maxDrawdownSeen = Math.min(a.maxDrawdownSeen || 0, context.drawdown || 0);
  a.peakConcentrationSeen = Math.max(a.peakConcentrationSeen || 0, context.concentration || 0);
  a.bestNetWorth = Math.max(a.bestNetWorth || 0, context.netWorth || 0);
  const unlocked = new Set(a.achievements || []);
  if (context.netWorth >= 1000000) unlocked.add('First Million');
  if (a.maxDrawdownSeen <= -.30) unlocked.add('Diamond Hands');
  if ((context.quarter || 0) >= 8 && a.maxDrawdownSeen > -.10) unlocked.add('Risk Manager');
  if (a.peakConcentrationSeen >= .70) unlocked.add('Concentrated Bet');
  if ((a.marginCalls || 0) > 0) unlocked.add('Margin Called');
  if ((context.aum || 0) >= 10000000) unlocked.add('Institutional');
  if ((context.clients || 0) > 0) unlocked.add('First Mandate');
  if ((context.employees || 0) >= 6) unlocked.add('Team Builder');
  if ((context.officeLevel || 1) >= 4) unlocked.add('Capital Tower');
  a.achievements = [...unlocked];
  return a;
}

function deterministicRoll(seed) {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}
function money(n) { return `$${Math.round(Math.abs(n)).toLocaleString('en-US')}`; }
function signedMoney(n) { return `${n >= 0 ? '+' : '-'}${money(n)}`; }
