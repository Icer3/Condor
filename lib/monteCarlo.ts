// Monte Carlo simulation under Geometric Brownian Motion.
// Operates on a generic Leg[] (works for any strategy in lib/strategies.ts).

import { Leg, payoffAtExpiry } from './strategies';

export interface MCInputs {
  S0: number;
  mu: number;
  sigma: number;
  r: number;
  daysToExpiry: number;
  legs: Leg[];
  numPaths: number;
  seed?: number;
}

export interface MCResult {
  probProfit: number;
  expectedPnl: number;       // per share
  medianPnl: number;
  stdPnl: number;
  var95: number;
  cvar95: number;
  pctMaxProfit: number;
  pctMaxLoss: number;
  histogram: { bin: number; count: number }[];
  pathFan: { pct: number; path: number[] }[];
  allPaths: number[][];      // [pathIdx][dayIdx] -> price
  pathCount: number;         // total simulated paths (may exceed allPaths.length)
  tradingDays: number;       // # of daily steps in each path
  sampleSize: number;
}

export type InsightLevel = 'good' | 'warn' | 'bad' | 'info';
export interface Insight { level: InsightLevel; text: string; }

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussianFromRng(rng: () => number): number {
  const u1 = rng() || 1e-12;
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

export function runMonteCarlo(inp: MCInputs): MCResult {
  const N = inp.numPaths;
  const tradingDays = Math.max(1, Math.round(inp.daysToExpiry * (252 / 365)));
  const dt = inp.daysToExpiry > 0 ? inp.daysToExpiry / (365 * tradingDays) : 0;
  const drift = (inp.mu - 0.5 * inp.sigma * inp.sigma) * dt;
  const diffusion = inp.sigma * Math.sqrt(dt);
  const rng = inp.seed !== undefined ? makeRng(inp.seed) : null;

  // Compute "max profit" / "max loss" baseline via payoff curve sampling
  // (works for defined and undefined risk).
  let maxProfit = -Infinity;
  let maxLoss = Infinity;
  for (let S = inp.S0 * 0.5; S <= inp.S0 * 1.5; S += inp.S0 * 0.005) {
    const p = payoffAtExpiry(inp.legs, S);
    if (p > maxProfit) maxProfit = p;
    if (p < maxLoss) maxLoss = p;
  }

  // Always store all paths so the UI can render them individually.
  // Cap to keep memory + JSON payload sane.
  const MAX_STORED_PATHS = 2000;
  const storeCount = Math.min(N, MAX_STORED_PATHS);
  const stride = N > MAX_STORED_PATHS ? Math.floor(N / MAX_STORED_PATHS) : 1;
  const allPaths = new Float64Array(storeCount * (tradingDays + 1));
  const terminalPrices = new Float64Array(N);
  const pnls = new Float64Array(N);
  let nProfit = 0;
  const tol = 1e-3;

  for (let i = 0; i < N; i++) {
    let S = inp.S0;
    const storeIdx = Math.floor(i / stride);
    const isStored = storeIdx < storeCount && i % stride === 0;
    if (isStored) allPaths[storeIdx * (tradingDays + 1)] = S;
    for (let d = 0; d < tradingDays; d++) {
      const z = rng ? gaussianFromRng(rng) : Math.sqrt(-2 * Math.log(Math.random() || 1e-12)) * Math.cos(2 * Math.PI * Math.random());
      S = S * Math.exp(drift + diffusion * z);
      if (isStored) allPaths[storeIdx * (tradingDays + 1) + d + 1] = S;
    }
    terminalPrices[i] = S;
    const pnl = payoffAtExpiry(inp.legs, S);
    pnls[i] = pnl;
    if (pnl > 0) nProfit++;
  }

  const sorted = Float64Array.from(pnls).sort();
  const mean = pnls.reduce((a, b) => a + b, 0) / N;
  const variance = pnls.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, N - 1);
  const std = Math.sqrt(variance);
  const median = sorted[Math.floor(N / 2)];
  const idx5 = Math.floor(N * 0.05);
  const var95 = -sorted[idx5];
  const worst5 = sorted.slice(0, idx5);
  const cvar95 = worst5.length ? -worst5.reduce((a, b) => a + b, 0) / worst5.length : 0;

  const pMin = sorted[0], pMax = sorted[N - 1];
  const bins = 40;
  const hist = new Array(bins).fill(0).map(() => ({ bin: 0, count: 0 }));
  const span = (pMax - pMin) || 1;
  for (let i = 0; i < N; i++) {
    let b = Math.floor(((pnls[i] - pMin) / span) * bins);
    if (b >= bins) b = bins - 1;
    if (b < 0) b = 0;
    hist[b].count++;
    hist[b].bin = pMin + ((b + 0.5) / bins) * span;
  }

  let pathFan: { pct: number; path: number[] }[] = [];
  const len = tradingDays + 1;
  const cols: number[][] = Array.from({ length: len }, () => []);
  for (let i = 0; i < storeCount; i++) {
    for (let d = 0; d < len; d++) cols[d].push(allPaths[i * len + d]);
  }
  pathFan = [5, 25, 50, 75, 95].map(p => ({
    pct: p,
    path: cols.map(col => {
      const s = [...col].sort((a, b) => a - b);
      return s[Math.floor((p / 100) * s.length)];
    }),
  }));

  // Materialize allPaths as number[][] for easy frontend consumption.
  const allPathsArr: number[][] = [];
  for (let i = 0; i < storeCount; i++) {
    const row: number[] = new Array(len);
    for (let d = 0; d < len; d++) row[d] = allPaths[i * len + d];
    allPathsArr.push(row);
  }

  return {
    probProfit: nProfit / N,
    expectedPnl: mean,
    medianPnl: median,
    stdPnl: std,
    var95, cvar95,
    pctMaxProfit: pnls.filter(p => Math.abs(p - maxProfit) < tol).length / N,
    pctMaxLoss:   pnls.filter(p => Math.abs(p - maxLoss)   < tol).length / N,
    histogram: hist,
    pathFan,
    allPaths: allPathsArr,
    pathCount: N,
    tradingDays,
    sampleSize: N,
  };
}

export function generateInsights(
  mc: MCResult,
  legs: { kind: string; side: string; entryPrice: number; strike?: number; quantity: number }[],
  S0: number,
  daysToExpiry: number,
  sigma: number,
  netDelta: number,
  netTheta: number,
  netVega: number,
  prob: { maxProfit: number | null; maxLoss: number | null; breakEvens: number[]; riskReward?: number },
): Insight[] {
  const out: Insight[] = [];
  const credit = (() => {
    let s = 0;
    for (const l of legs) s += (l.side === 'short' ? 1 : -1) * l.entryPrice;
    return s;
  })();

  if (mc.probProfit > 0.65) out.push({ level: 'good', text: `Probability of profit is ${(mc.probProfit*100).toFixed(1)}% — solid for this setup.` });
  else if (mc.probProfit > 0.45) out.push({ level: 'info', text: `Probability of profit is ${(mc.probProfit*100).toFixed(1)}% — coin-flip territory.` });
  else out.push({ level: 'bad', text: `Probability of profit is only ${(mc.probProfit*100).toFixed(1)}% — strikes too tight for assumed volatility.` });

  if (prob.maxProfit != null && prob.maxLoss != null) {
    const rr = prob.maxProfit / Math.max(0.0001, -prob.maxLoss);
    if (rr > 0.25) out.push({ level: 'good', text: `Risk/reward ${rr.toFixed(2)} is favorable for a defined-risk trade.` });
    else if (rr < 0.15) out.push({ level: 'warn', text: `Risk/reward ${rr.toFixed(2)} is low — premium collected does not justify max loss.` });
  }

  const expectedMove = sigma * S0 * Math.sqrt(daysToExpiry / 365);
  out.push({ level: 'info', text: `Expected 1-σ move by expiry ≈ $${expectedMove.toFixed(2)} (${((expectedMove/S0)*100).toFixed(1)}%). Strikes should bracket this comfortably.` });

  if (prob.breakEvens.length >= 2) {
    const beBand = prob.breakEvens[prob.breakEvens.length - 1] - prob.breakEvens[0];
    if (beBand < 2 * expectedMove) out.push({ level: 'warn', text: `Breakeven band ($${beBand.toFixed(2)}) is narrower than 2× the 1-σ move. Expect more pin-risk touches.` });
  }

  if (mc.cvar95 > Math.abs(prob.maxLoss ?? 0) * 0.7) {
    out.push({ level: 'warn', text: `Tail risk: in the worst 5% of paths the average loss is $${mc.cvar95.toFixed(2)} per share.` });
  }

  if (Math.abs(netDelta) > 50) out.push({ level: 'info', text: `Net delta is ${netDelta.toFixed(0)} — this position has meaningful directional exposure. Manage with hedges if needed.` });
  if (netVega < -10) out.push({ level: 'warn', text: `Net vega is ${netVega.toFixed(0)} — a spike in implied volatility hurts this position. Consider sizing smaller or hedging vega.` });
  if (netTheta > 0.5) out.push({ level: 'good', text: `Net theta is +$${netTheta.toFixed(2)}/day — time decay works in your favor while the trade is on.` });

  if (mc.expectedPnl < 0) out.push({ level: 'bad', text: `Expected value is negative ($${mc.expectedPnl.toFixed(2)}/share). The market is not paying enough for the risk being sold.` });

  return out;
}