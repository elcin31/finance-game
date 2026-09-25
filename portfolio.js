import { ASSETS } from './market.js';

export function createPortfolio(cash = 100000) {
  return { cash, positions: {}, realizedPnL: 0, returns: [], highWater: cash, lastValue: cash };
}

export function hydratePortfolio(input, fallbackCash = 100000) {
  const base = createPortfolio(fallbackCash);
  if (!input) return base;
  return {
    ...base,
    ...input,
    cash: Number.isFinite(input.cash) ? input.cash : fallbackCash,
    positions: input.positions && typeof input.positions === 'object' ? input.positions : {},
    returns: Array.isArray(input.returns) ? input.returns.slice(-64) : []
  };
}

export function getNetWorth(portfolio, prices) {
  let value = portfolio.cash || 0;
  for (const [symbol, position] of Object.entries(portfolio.positions || {})) value += (position.qty || 0) * (prices[symbol] || 0);
  return value;
}

export function getPositionValue(portfolio, prices, symbol) {
  return (portfolio.positions?.[symbol]?.qty || 0) * (prices[symbol] || 0);
}

export function buyByValue(input, symbol, price, requestedValue) {
  const p = hydratePortfolio(input, input?.cash || 0);
  const value = Math.max(0, Math.min(requestedValue, p.cash));
  if (!price || value < .01) return p;
  const qty = value / price;
  const old = p.positions[symbol] || { qty: 0, avgCost: price };
  const totalQty = old.qty + qty;
  const avgCost = totalQty > 0 ? (old.qty * old.avgCost + qty * price) / totalQty : price;
  return { ...p, cash: p.cash - value, positions: { ...p.positions, [symbol]: { qty: totalQty, avgCost } } };
}

export function sellFraction(input, symbol, price, fraction = 1) {
  const p = hydratePortfolio(input, input?.cash || 0);
  const old = p.positions[symbol];
  if (!old || old.qty <= 0 || !price) return p;
  const qty = old.qty * Math.max(0, Math.min(1, fraction));
  const proceeds = qty * price;
  const realized = (price - old.avgCost) * qty;
  const remaining = old.qty - qty;
  const positions = { ...p.positions };
  if (remaining < 1e-8) delete positions[symbol];
  else positions[symbol] = { ...old, qty: remaining };
  return { ...p, cash: p.cash + proceeds, realizedPnL: (p.realizedPnL || 0) + realized, positions };
}

export function rebalancePortfolio(input, prices, weights) {
  let p = hydratePortfolio(input, input?.cash || 0);
  for (const symbol of Object.keys(p.positions)) p = sellFraction(p, symbol, prices[symbol], 1);
  const total = p.cash;
  for (const [symbol, weight] of Object.entries(weights)) p = buyByValue(p, symbol, prices[symbol], total * Math.max(0, weight));
  return p;
}

export function markPortfolio(input, prices) {
  const p = hydratePortfolio(input, input?.cash || 0);
  const value = getNetWorth(p, prices);
  const prev = p.lastValue || value;
  const ret = prev > 0 ? value / prev - 1 : 0;
  return {
    ...p,
    lastValue: value,
    highWater: Math.max(p.highWater || value, value),
    returns: [...(p.returns || []), ret].slice(-64)
  };
}

export function addCash(input, amount) {
  const p = hydratePortfolio(input, input?.cash || 0);
  return { ...p, cash: Math.max(0, p.cash + amount) };
}

export function allocation(portfolio, prices) {
  const net = getNetWorth(portfolio, prices);
  const rows = Object.keys(ASSETS).map((symbol) => ({ symbol, value: getPositionValue(portfolio, prices, symbol) }));
  return rows.map((row) => ({ ...row, weight: net > 0 ? row.value / net : 0 })).filter((row) => row.value > .01).sort((a, b) => b.weight - a.weight);
}

export function unrealizedPnL(portfolio, prices, symbol) {
  const pos = portfolio.positions?.[symbol];
  if (!pos) return 0;
  return (prices[symbol] - pos.avgCost) * pos.qty;
}

export function riskMetrics(portfolio, prices) {
  const alloc = allocation(portfolio, prices);
  const net = getNetWorth(portfolio, prices);
  let variance = 0;
  for (const a of alloc) {
    for (const b of alloc) {
      const sa = ASSETS[a.symbol];
      const sb = ASSETS[b.symbol];
      const corr = correlation(sa.sector, sb.sector);
      variance += a.weight * b.weight * sa.vol * sb.vol * corr;
    }
  }
  const concentration = alloc[0]?.weight || 0;
  const drawdown = portfolio.highWater > 0 ? net / portfolio.highWater - 1 : 0;
  const returns = (portfolio.returns || []).filter(Number.isFinite);
  let sharpe = null;
  if (returns.length >= 4) {
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const varianceR = returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / Math.max(1, returns.length - 1);
    if (varianceR > 1e-10) sharpe = mean / Math.sqrt(varianceR) * Math.sqrt(12);
  }
  return {
    net,
    cash: portfolio.cash,
    concentration,
    diversification: alloc.length,
    volatility: Math.sqrt(Math.max(0, variance)),
    drawdown,
    sharpe,
    realizedPnL: portfolio.realizedPnL || 0
  };
}

function correlation(a, b) {
  if (a === b) return 1;
  const defensive = new Set(['gold', 'bonds']);
  const risky = new Set(['technology', 'banking', 'energy', 'realestate']);
  if (defensive.has(a) && risky.has(b) || defensive.has(b) && risky.has(a)) return -.08;
  if (defensive.has(a) && defensive.has(b)) return .18;
  return .28;
}
