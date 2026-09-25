export const ASSETS = {
  NXT: { name: 'Nexora Tech', sector: 'technology', start: 128, drift: 0.0022, vol: 0.035, color: '#59ddff' },
  MED: { name: 'Medica Labs', sector: 'healthcare', start: 84, drift: 0.0014, vol: 0.021, color: '#68f0b0' },
  BNK: { name: 'Union Bank', sector: 'banking', start: 62, drift: 0.0013, vol: 0.026, color: '#ffd166' },
  OILX: { name: 'Orion Energy', sector: 'energy', start: 73, drift: 0.0012, vol: 0.03, color: '#ff9b62' },
  GLD: { name: 'Gold Trust', sector: 'gold', start: 196, drift: 0.0007, vol: 0.014, color: '#ffe08a' },
  BND: { name: 'Treasury Bond', sector: 'bonds', start: 101, drift: 0.0005, vol: 0.007, color: '#91a7ff' },
  EST: { name: 'Metro REIT', sector: 'realestate', start: 47, drift: 0.001, vol: 0.02, color: '#d2a8ff' },
  DEF: { name: 'Aegis Systems', sector: 'defense', start: 91, drift: 0.0015, vol: 0.022, color: '#ff7ca8' }
};

export const REGIMES = {
  'Bull Market': { volatility: 0.85, effects: { technology: .006, healthcare: .002, banking: .0035, energy: .002, gold: -.001, bonds: -.001, realestate: .003, defense: .0015 } },
  'Bear Market': { volatility: 1.35, effects: { technology: -.007, healthcare: -.002, banking: -.006, energy: -.0035, gold: .0025, bonds: .002, realestate: -.005, defense: .001 } },
  Inflation: { volatility: 1.15, effects: { technology: -.003, healthcare: -.001, banking: .001, energy: .007, gold: .005, bonds: -.0045, realestate: -.002, defense: .002 } },
  Recession: { volatility: 1.2, effects: { technology: -.004, healthcare: .002, banking: -.0065, energy: -.004, gold: .002, bonds: .005, realestate: -.005, defense: .0015 } },
  Bubble: { volatility: 1.5, effects: { technology: .011, healthcare: .001, banking: .002, energy: .001, gold: -.002, bonds: -.002, realestate: .004, defense: .001 } },
  'Credit Crisis': { volatility: 1.65, effects: { technology: -.006, healthcare: -.002, banking: -.012, energy: -.004, gold: .004, bonds: .003, realestate: -.009, defense: .001 } },
  Neutral: { volatility: 1, effects: { technology: .001, healthcare: .001, banking: .001, energy: .0005, gold: .0004, bonds: .0003, realestate: .0006, defense: .0008 } }
};

const NEWS = [
  { title: 'Nexora unveils new AI accelerator', symbol: 'NXT', shock: .065, tone: 'positive' },
  { title: 'Nexora faces antitrust inquiry', symbol: 'NXT', shock: -.055, tone: 'negative' },
  { title: 'Medica wins major drug approval', symbol: 'MED', shock: .05, tone: 'positive' },
  { title: 'Clinical trial misses endpoint', symbol: 'MED', shock: -.047, tone: 'negative' },
  { title: 'Credit losses rise at Union Bank', symbol: 'BNK', shock: -.06, tone: 'negative' },
  { title: 'Loan growth surprises higher', symbol: 'BNK', shock: .038, tone: 'positive' },
  { title: 'Supply disruption lifts crude prices', symbol: 'OILX', shock: .055, tone: 'positive' },
  { title: 'Oil inventories jump unexpectedly', symbol: 'OILX', shock: -.04, tone: 'negative' },
  { title: 'Central bank signals rate cuts', symbol: 'BND', shock: .025, tone: 'positive' },
  { title: 'Inflation print runs hot', symbol: 'BND', shock: -.025, tone: 'negative' },
  { title: 'Safe-haven demand accelerates', symbol: 'GLD', shock: .032, tone: 'positive' },
  { title: 'Real yields climb sharply', symbol: 'GLD', shock: -.027, tone: 'negative' },
  { title: 'Office vacancy rates improve', symbol: 'EST', shock: .035, tone: 'positive' },
  { title: 'Refinancing costs hit property sector', symbol: 'EST', shock: -.045, tone: 'negative' },
  { title: 'Aegis wins multi-year defense contract', symbol: 'DEF', shock: .043, tone: 'positive' },
  { title: 'Government trims procurement plan', symbol: 'DEF', shock: -.03, tone: 'negative' }
];

function rng(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function normalish(rand) {
  return (rand() + rand() + rand() + rand() + rand() + rand() - 3) / 1.7;
}

export function createMarket(seed = Math.floor(Math.random() * 2 ** 31)) {
  const prices = {};
  const previous = {};
  const history = {};
  for (const [symbol, asset] of Object.entries(ASSETS)) {
    prices[symbol] = asset.start;
    previous[symbol] = asset.start;
    history[symbol] = [asset.start];
  }
  return { seed, step: 0, regime: 'Neutral', regimeAge: 0, prices, previous, history, news: [] };
}

export function hydrateMarket(input) {
  const base = createMarket(input?.seed ?? Math.floor(Math.random() * 2 ** 31));
  if (!input) return base;
  const market = { ...base, ...input };
  market.prices = { ...base.prices, ...(input.prices || {}) };
  market.previous = { ...base.previous, ...(input.previous || {}) };
  market.history = { ...base.history };
  for (const symbol of Object.keys(ASSETS)) market.history[symbol] = Array.isArray(input.history?.[symbol]) ? input.history[symbol].slice(-32) : [market.prices[symbol]];
  market.news = Array.isArray(input.news) ? input.news.slice(0, 10) : [];
  return market;
}

function nextRegime(current, rand) {
  const choices = Object.keys(REGIMES).filter((name) => name !== current);
  const defensiveBias = current === 'Bubble' && rand() < .42 ? 'Bear Market' : null;
  if (defensiveBias) return defensiveBias;
  return choices[Math.floor(rand() * choices.length)];
}

export function advanceMarket(input) {
  const market = hydrateMarket(input);
  const rand = rng((market.seed + Math.imul(market.step + 1, 2654435761)) >>> 0);
  market.step += 1;
  market.regimeAge = (market.regimeAge || 0) + 1;
  let regimeChanged = false;
  if ((market.regimeAge >= 4 && rand() < .26) || market.regimeAge >= 8) {
    market.regime = nextRegime(market.regime, rand);
    market.regimeAge = 0;
    regimeChanged = true;
  }

  const regime = REGIMES[market.regime] || REGIMES.Neutral;
  const returns = {};
  market.previous = { ...market.prices };

  for (const [symbol, asset] of Object.entries(ASSETS)) {
    const regimeEffect = regime.effects[asset.sector] || 0;
    const randomMove = normalish(rand) * asset.vol * regime.volatility;
    const ret = clampReturn(asset.drift + regimeEffect + randomMove);
    market.prices[symbol] = Math.max(4, market.prices[symbol] * (1 + ret));
    returns[symbol] = ret;
  }

  let news = null;
  if (rand() < .55) {
    const template = NEWS[Math.floor(rand() * NEWS.length)];
    const shock = template.shock * (0.75 + rand() * 0.55);
    market.prices[template.symbol] = Math.max(4, market.prices[template.symbol] * (1 + shock));
    returns[template.symbol] = (market.prices[template.symbol] / market.previous[template.symbol]) - 1;
    news = { ...template, shock, step: market.step };
    market.news = [news, ...market.news].slice(0, 10);
  }

  for (const symbol of Object.keys(ASSETS)) {
    market.history[symbol] = [...(market.history[symbol] || []), market.prices[symbol]].slice(-32);
  }

  return { market, returns, news, regimeChanged };
}

function clampReturn(value) {
  return Math.max(-.22, Math.min(.22, value));
}

export function getAssetChange(market, symbol) {
  const current = market.prices[symbol];
  const previous = market.previous[symbol] || current;
  return previous ? current / previous - 1 : 0;
}

export function getResearchSignal(market, level = 0) {
  const regime = REGIMES[market.regime] || REGIMES.Neutral;
  const ranked = Object.entries(ASSETS)
    .map(([symbol, asset]) => ({ symbol, score: asset.drift + (regime.effects[asset.sector] || 0) }))
    .sort((a, b) => b.score - a.score);
  const confidence = Math.min(86, 42 + level * 8);
  return {
    regime: market.regime,
    favored: ranked.slice(0, Math.min(1 + Math.floor(level / 2), 3)).map((x) => x.symbol),
    weak: ranked.slice(-Math.min(1 + Math.floor(level / 3), 2)).map((x) => x.symbol),
    confidence
  };
}
