export const ROLES = {
  'Junior Analyst': { salary: 8500, hiringFee: 9000, research: 8, risk: 2, alpha: 3, client: 1, compliance: 0 },
  'Senior Analyst': { salary: 16000, hiringFee: 18000, research: 18, risk: 5, alpha: 8, client: 2, compliance: 0 },
  'Risk Manager': { salary: 17500, hiringFee: 20000, research: 3, risk: 22, alpha: 1, client: 4, compliance: 4 },
  Economist: { salary: 15000, hiringFee: 16500, research: 16, risk: 8, alpha: 4, client: 3, compliance: 0 },
  'Portfolio Manager': { salary: 22000, hiringFee: 25000, research: 8, risk: 10, alpha: 12, client: 8, compliance: 1 },
  'Compliance Officer': { salary: 14500, hiringFee: 16000, research: 0, risk: 4, alpha: 0, client: 5, compliance: 24 },
  'Client Director': { salary: 18000, hiringFee: 21000, research: 1, risk: 1, alpha: 0, client: 24, compliance: 4 }
};

export const OFFICE_LEVELS = [
  { level: 1, name: 'Starter Office', capacity: 3, rent: 9000, upgradeCost: 0 },
  { level: 2, name: 'Boutique Floor', capacity: 6, rent: 16000, upgradeCost: 65000 },
  { level: 3, name: 'Institutional Floor', capacity: 10, rent: 30000, upgradeCost: 180000 },
  { level: 4, name: 'Capital Tower', capacity: 16, rent: 52000, upgradeCost: 500000 }
];

const FIRST_NAMES = ['Sarah','Michael','Ava','Daniel','Maya','Lucas','Elena','David','Nora','James','Lena','Noah','Sophia','Leo','Mila','Ethan'];
const LAST_NAMES = ['Chen','Reed','Hart','Morgan','Patel','Kim','Fischer','Volkov','Bennett','Moretti','Sato','Diaz','Klein','Novak','Carter','Ibrahim'];
const CLIENT_TYPES = [
  { type: 'Family Office', minAum: 600000, maxAum: 2600000, maxDd: .18, target: .025 },
  { type: 'Entrepreneur', minAum: 250000, maxAum: 1100000, maxDd: .24, target: .035 },
  { type: 'Pension Mandate', minAum: 1400000, maxAum: 5200000, maxDd: .12, target: .018 },
  { type: 'Endowment', minAum: 900000, maxAum: 3600000, maxDd: .15, target: .022 },
  { type: 'Private Wealth', minAum: 350000, maxAum: 1800000, maxDd: .20, target: .03 }
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

function id(prefix, seed, index) { return `${prefix}-${seed.toString(36)}-${index.toString(36)}`; }
function roundMoney(v) { return Math.round(v / 100) * 100; }

export function createTycoon(seed = Math.floor(Math.random() * 2 ** 31)) {
  return {
    seed,
    officeLevel: 1,
    employees: [],
    clients: [],
    prospects: generateProspects(seed, 1, 2),
    candidates: generateCandidates(seed, 1, 4),
    managementFee: .012,
    performanceFee: .12,
    cumulativeFees: 0,
    cumulativePayroll: 0,
    cumulativeWithdrawals: 0,
    lastQuarter: null,
    competitorQuarter: 0,
    competitors: [
      { name: 'Atlas Partners', aum: 24000000, reputation: 68 },
      { name: 'Meridian Capital', aum: 17000000, reputation: 64 },
      { name: 'Northstar', aum: 9500000, reputation: 58 },
      { name: 'Helix Fund', aum: 5200000, reputation: 53 }
    ]
  };
}

export function hydrateTycoon(input) {
  const base = createTycoon(input?.seed ?? Math.floor(Math.random() * 2 ** 31));
  if (!input) return base;
  return {
    ...base,
    ...input,
    employees: Array.isArray(input.employees) ? input.employees : [],
    clients: Array.isArray(input.clients) ? input.clients : [],
    prospects: Array.isArray(input.prospects) ? input.prospects : [],
    candidates: Array.isArray(input.candidates) ? input.candidates : [],
    competitors: Array.isArray(input.competitors) ? input.competitors : base.competitors
  };
}

export function officeInfo(tycoon) {
  return OFFICE_LEVELS[Math.max(0, Math.min(OFFICE_LEVELS.length - 1, (tycoon.officeLevel || 1) - 1))];
}

export function totalAum(tycoon) {
  return (tycoon.clients || []).reduce((sum, c) => sum + Math.max(0, c.aum || 0), 0);
}

export function staffEffects(tycoon) {
  const totals = { research: 0, risk: 0, alpha: 0, client: 0, compliance: 0, salary: 0 };
  for (const employee of tycoon.employees || []) {
    const role = ROLES[employee.role];
    if (!role) continue;
    const mult = .7 + (employee.skill || 50) / 100 * .6;
    totals.research += role.research * mult;
    totals.risk += role.risk * mult;
    totals.alpha += role.alpha * mult;
    totals.client += role.client * mult;
    totals.compliance += role.compliance * mult;
    totals.salary += employee.salary || role.salary;
  }
  return totals;
}

export function generateCandidates(seed, quarter, count = 4) {
  const rand = rng((seed ^ Math.imul(quarter + 17, 2246822519)) >>> 0);
  const roles = Object.keys(ROLES);
  return Array.from({ length: count }, (_, i) => {
    const role = roles[Math.floor(rand() * roles.length)];
    const base = ROLES[role];
    const skill = Math.round(45 + rand() * 50);
    const salary = roundMoney(base.salary * (.82 + skill / 170));
    const hiringFee = roundMoney(base.hiringFee * (.85 + skill / 180));
    return {
      id: id('hire', quarter * 100 + Math.floor(rand() * 1e6), i),
      name: `${FIRST_NAMES[Math.floor(rand() * FIRST_NAMES.length)]} ${LAST_NAMES[Math.floor(rand() * LAST_NAMES.length)]}`,
      role, skill, salary, hiringFee
    };
  });
}

export function hireCandidate(input, candidateId) {
  const t = hydrateTycoon(input);
  const office = officeInfo(t);
  if (t.employees.length >= office.capacity) return { tycoon: t, hired: null, reason: 'capacity' };
  const candidate = t.candidates.find((c) => c.id === candidateId);
  if (!candidate) return { tycoon: t, hired: null, reason: 'missing' };
  return {
    tycoon: {
      ...t,
      employees: [...t.employees, { ...candidate, hiredQuarter: t.competitorQuarter + 1 }],
      candidates: t.candidates.filter((c) => c.id !== candidateId)
    },
    hired: candidate,
    reason: null
  };
}

export function upgradeOffice(input) {
  const t = hydrateTycoon(input);
  if (t.officeLevel >= OFFICE_LEVELS.length) return { tycoon: t, cost: 0, upgraded: false };
  const next = OFFICE_LEVELS[t.officeLevel];
  return { tycoon: { ...t, officeLevel: t.officeLevel + 1 }, cost: next.upgradeCost, upgraded: true };
}

export function generateProspects(seed, quarter, count = 2, reputation = 50, clientSkill = 0) {
  const rand = rng((seed ^ Math.imul(quarter + 31, 3266489917)) >>> 0);
  const quality = Math.max(.7, Math.min(1.7, .72 + reputation / 120 + clientSkill / 250));
  return Array.from({ length: count }, (_, i) => {
    const template = CLIENT_TYPES[Math.floor(rand() * CLIENT_TYPES.length)];
    const raw = template.minAum + rand() * (template.maxAum - template.minAum);
    const aum = roundMoney(raw * quality);
    return {
      id: id('client', quarter * 1000 + Math.floor(rand() * 1e6), i),
      name: `${LAST_NAMES[Math.floor(rand() * LAST_NAMES.length)]} ${template.type}`,
      type: template.type,
      aum,
      maxDrawdown: Math.max(.07, template.maxDd - Math.min(.035, clientSkill / 2500)),
      targetReturn: template.target,
      patience: Math.round(45 + rand() * 45),
      joinedQuarter: null,
      highWater: aum
    };
  });
}

export function acceptProspect(input, prospectId, quarter) {
  const t = hydrateTycoon(input);
  const prospect = t.prospects.find((p) => p.id === prospectId);
  if (!prospect) return { tycoon: t, client: null };
  const client = { ...prospect, joinedQuarter: quarter, highWater: prospect.aum };
  return { tycoon: { ...t, clients: [...t.clients, client], prospects: t.prospects.filter((p) => p.id !== prospectId) }, client };
}

export function runTycoonQuarter(input, context) {
  let t = hydrateTycoon(input);
  const rand = rng((t.seed + Math.imul((context.quarter || 1) + 101, 2654435761)) >>> 0);
  const effects = staffEffects(t);
  const office = officeInfo(t);
  let fees = 0;
  let withdrawals = 0;
  let clientDelta = 0;
  const clients = [];

  for (const client of t.clients) {
    let aum = Math.max(0, client.aum * (1 + context.portfolioReturn));
    const highWater = Math.max(client.highWater || client.aum, aum);
    const dd = highWater > 0 ? aum / highWater - 1 : 0;
    const managementFee = aum * (t.managementFee / 4);
    const performanceFee = context.portfolioReturn > 0 ? aum * context.portfolioReturn * t.performanceFee : 0;
    fees += managementFee + performanceFee;
    aum = Math.max(0, aum - managementFee - performanceFee);

    const breach = Math.abs(Math.min(0, dd)) > client.maxDrawdown;
    const disappointment = context.portfolioReturn < -client.targetReturn;
    const baseExit = breach ? .48 : disappointment ? .16 : .025;
    const loyalty = Math.min(.22, effects.client / 400 + context.reputation / 1000);
    const exitChance = Math.max(.01, baseExit - loyalty);
    if (rand() < exitChance) {
      withdrawals += aum;
      clientDelta -= 1;
      continue;
    }
    clients.push({ ...client, aum, highWater });
  }

  const payroll = effects.salary;
  const rent = office.rent;
  const operatingCost = payroll + rent;
  const netFirmCashFlow = fees - operatingCost;

  const competitors = t.competitors.map((c, i) => {
    const ret = -.015 + rand() * .075 + i * -.002;
    const flow = (rand() - .42) * .025;
    return { ...c, aum: Math.max(150000, c.aum * (1 + ret + flow)), reputation: Math.max(20, Math.min(95, c.reputation + (ret > .02 ? 1 : ret < -.02 ? -1 : 0))) };
  });

  const nextQuarter = (context.quarter || 1) + 1;
  const capacity = office.capacity;
  const candidates = generateCandidates(t.seed, nextQuarter, Math.max(3, Math.min(5, capacity - clients.length + 2)));
  const prospectCount = context.reputation >= 75 ? 3 : context.reputation >= 50 ? 2 : 1;
  const prospects = generateProspects(t.seed, nextQuarter, prospectCount, context.reputation, effects.client);

  t = {
    ...t,
    clients,
    candidates,
    prospects,
    competitors,
    competitorQuarter: nextQuarter,
    cumulativeFees: (t.cumulativeFees || 0) + fees,
    cumulativePayroll: (t.cumulativePayroll || 0) + operatingCost,
    cumulativeWithdrawals: (t.cumulativeWithdrawals || 0) + withdrawals,
    lastQuarter: { fees, payroll, rent, operatingCost, netFirmCashFlow, withdrawals, clientDelta }
  };

  return { tycoon: t, fees, payroll, rent, operatingCost, netFirmCashFlow, withdrawals, clientDelta };
}

export function setFeeStructure(input, managementFee, performanceFee) {
  const t = hydrateTycoon(input);
  return { ...t, managementFee: Math.max(.005, Math.min(.025, managementFee)), performanceFee: Math.max(.05, Math.min(.25, performanceFee)) };
}
