// Generic options strategy library.
// All strategies share the same Leg representation, payoff function, and metrics builder.

import { blackScholes, inverseNormCdf } from './blackScholes';

export type LegKind = 'call' | 'put' | 'stock';
export type LegSide = 'long' | 'short';

export interface Leg {
  kind: LegKind;
  side: LegSide;
  strike?: number;       // for options
  entryPrice: number;    // per-share: option premium OR stock cost basis
  quantity: number;      // # of shares (1 contract = 100 shares)
}

export type StrategyId =
  | 'long_call'
  | 'long_put'
  | 'short_put'
  | 'covered_call'
  | 'bull_call_spread'
  | 'bear_put_spread'
  | 'iron_condor'
  | 'iron_butterfly'
  | 'long_straddle'
  | 'long_strangle';

export type StrategyCategory = 'bullish' | 'bearish' | 'neutral' | 'income' | 'volatility' | 'unknown';

export interface StrategyMeta {
  id: StrategyId;
  name: string;
  emoji: string;
  category: StrategyCategory;
  shortDescription: string;
  longDescription: string;
  whenToUse: string;
  example: string;
  riskProfile: 'defined' | 'undefined';
  maxProfitFormula: string;
  maxLossFormula: string;
}

export interface StrategyParams {
  S: number;
  sigma: number;
  r: number;
  daysToExpiry: number;
  // Common
  delta?: number;        // target short-strike delta (default 0.30)
  wingWidth?: number;    // width between strikes
  // Specific
  strike?: number;       // explicit strike (for single-leg)
  lowerStrike?: number;
  upperStrike?: number;
}

export interface BuiltStrategy {
  legs: Leg[];
  entryPerShare: number;        // >0 = credit received, <0 = debit paid
  entryPerContract: number;     // ×100
  maxProfit: number | null;     // null = unlimited, in dollars per contract (×100)
  maxLoss: number | null;       // null = unlimited
  breakEvens: number[];
  breakEvenBandPct: number;
  netDelta: number;
  netTheta: number;             // per day
  netVega: number;
}

export interface StrategyDefinition {
  meta: StrategyMeta;
  build: (params: StrategyParams) => BuiltStrategy;
  defaultParams: Partial<StrategyParams>;
  /** Whether the strategy accepts a Δ target to pick short strikes. */
  usesDelta?: boolean;
  /** Whether the strategy uses a wing-width input (vs fixed symmetric wings). */
  usesWing?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────
// Math helpers
// ─────────────────────────────────────────────────────────────────────────

export function legIntrinsic(leg: Leg, S_T: number): number {
  if (leg.kind === 'call') return Math.max(0, S_T - (leg.strike ?? 0));
  if (leg.kind === 'put') return Math.max(0, (leg.strike ?? 0) - S_T);
  return S_T;
}

/** Per-share P/L at expiry across all legs. */
export function payoffAtExpiry(legs: Leg[], S_T: number): number {
  let total = 0;
  for (const leg of legs) {
    const intrinsic = legIntrinsic(leg, S_T);
    const sign = leg.side === 'long' ? 1 : -1;
    total += sign * (intrinsic - leg.entryPrice);
  }
  return total;
}

export function payoffCurve(legs: Leg[], S0: number, span = 0.30, steps = 161) {
  const lo = S0 * (1 - span), hi = S0 * (1 + span);
  const out: { S: number; pnl: number }[] = [];
  for (let i = 0; i < steps; i++) {
    const S = lo + (hi - lo) * (i / (steps - 1));
    out.push({ S, pnl: payoffAtExpiry(legs, S) });
  }
  return out;
}

function roundStrike(K: number, dir: 'up' | 'down'): number {
  const step = K < 100 ? 0.5 : 1.0;
  return dir === 'up' ? Math.ceil(K / step) * step : Math.floor(K / step) * step;
}

/** Find strikes by target delta for a given side. */
function strikeForDelta(inp: { S: number; sigma: number; r: number; T: number; targetDelta: number; side: 'call' | 'put'; dir: 'up' | 'down' }) {
  const z = inverseNormCdf(1 - inp.targetDelta);
  const adj = (inp.r + 0.5 * inp.sigma * inp.sigma) * inp.T;
  const lnRatio = (inp.side === 'call' ? z : -z) * inp.sigma * Math.sqrt(inp.T) - adj;
  return roundStrike(inp.S * Math.exp(lnRatio), inp.dir);
}

function priceLeg(kind: 'call' | 'put', S: number, K: number, T: number, r: number, sigma: number): number {
  return kind === 'call' ? blackScholes({ S, K, T, r, sigma }).call : blackScholes({ S, K, T, r, sigma }).put;
}

// ─────────────────────────────────────────────────────────────────────────
// Strategy builders
// ─────────────────────────────────────────────────────────────────────────

function buildLongCall(p: StrategyParams): BuiltStrategy {
  const T = p.daysToExpiry / 365;
  const d = p.delta ?? 0.50;
  const K = p.strike ?? strikeForDelta({ S: p.S, sigma: p.sigma, r: p.r, T, targetDelta: d, side: 'call', dir: 'up' });
  const premium = priceLeg('call', p.S, K, T, p.r, p.sigma);
  const legs: Leg[] = [{ kind: 'call', side: 'long', strike: K, entryPrice: premium, quantity: 100 }];
  const g = blackScholes({ S: p.S, K, T, r: p.r, sigma: p.sigma });
  return {
    legs,
    entryPerShare: -premium,
    entryPerContract: -premium * 100,
    maxProfit: null,
    maxLoss: premium * 100,
    breakEvens: [K + premium],
    breakEvenBandPct: (premium / p.S) * 100,
    netDelta: g.deltaCall * 100,
    netTheta: g.thetaCall * 100,
    netVega: g.vega / 100 * 100, // vega already per 1.00
  };
}

function buildLongPut(p: StrategyParams): BuiltStrategy {
  const T = p.daysToExpiry / 365;
  const d = p.delta ?? 0.50;
  const K = p.strike ?? strikeForDelta({ S: p.S, sigma: p.sigma, r: p.r, T, targetDelta: d, side: 'put', dir: 'down' });
  const premium = priceLeg('put', p.S, K, T, p.r, p.sigma);
  const legs: Leg[] = [{ kind: 'put', side: 'long', strike: K, entryPrice: premium, quantity: 100 }];
  const g = blackScholes({ S: p.S, K, T, r: p.r, sigma: p.sigma });
  return {
    legs,
    entryPerShare: -premium,
    entryPerContract: -premium * 100,
    maxProfit: (K - premium) * 100,
    maxLoss: premium * 100,
    breakEvens: [K - premium],
    breakEvenBandPct: (premium / p.S) * 100,
    netDelta: g.deltaPut * 100,
    netTheta: g.thetaPut * 100,
    netVega: g.vega / 100 * 100,
  };
}

function buildShortPut(p: StrategyParams): BuiltStrategy {
  const T = p.daysToExpiry / 365;
  const d = p.delta ?? 0.30;
  const K = p.strike ?? strikeForDelta({ S: p.S, sigma: p.sigma, r: p.r, T, targetDelta: d, side: 'put', dir: 'down' });
  const premium = priceLeg('put', p.S, K, T, p.r, p.sigma);
  const legs: Leg[] = [{ kind: 'put', side: 'short', strike: K, entryPrice: premium, quantity: 100 }];
  const g = blackScholes({ S: p.S, K, T, r: p.r, sigma: p.sigma });
  return {
    legs,
    entryPerShare: premium,
    entryPerContract: premium * 100,
    maxProfit: premium * 100,
    maxLoss: -(K - premium) * 100,
    breakEvens: [K - premium],
    breakEvenBandPct: (premium / p.S) * 100,
    netDelta: -g.deltaPut * 100,
    netTheta: -g.thetaPut * 100,
    netVega: -g.vega / 100 * 100,
  };
}

function buildCoveredCall(p: StrategyParams): BuiltStrategy {
  const T = p.daysToExpiry / 365;
  const d = p.delta ?? 0.30;
  const K = p.strike ?? strikeForDelta({ S: p.S, sigma: p.sigma, r: p.r, T, targetDelta: d, side: 'call', dir: 'up' });
  const premium = priceLeg('call', p.S, K, T, p.r, p.sigma);
  const legs: Leg[] = [
    { kind: 'stock', side: 'long', entryPrice: p.S, quantity: 100 },
    { kind: 'call', side: 'short', strike: K, entryPrice: premium, quantity: 100 },
  ];
  const g = blackScholes({ S: p.S, K, T, r: p.r, sigma: p.sigma });
  return {
    legs,
    entryPerShare: -p.S + premium,
    entryPerContract: -(p.S - premium) * 100,
    maxProfit: (K - p.S + premium) * 100,
    maxLoss: -(p.S - premium) * 100, // if stock → 0
    breakEvens: [p.S - premium],
    breakEvenBandPct: (premium / p.S) * 100,
    netDelta: (1 - g.deltaCall) * 100,
    netTheta: -g.thetaCall * 100,
    netVega: -g.vega / 100 * 100,
  };
}

function buildBullCallSpread(p: StrategyParams): BuiltStrategy {
  const T = p.daysToExpiry / 365;
  const d = p.delta ?? 0.50;
  const w = p.wingWidth ?? 5;
  const K1 = p.lowerStrike ?? strikeForDelta({ S: p.S, sigma: p.sigma, r: p.r, T, targetDelta: d, side: 'call', dir: 'up' });
  const K2 = K1 + w;
  const c1 = priceLeg('call', p.S, K1, T, p.r, p.sigma);
  const c2 = priceLeg('call', p.S, K2, T, p.r, p.sigma);
  const legs: Leg[] = [
    { kind: 'call', side: 'long',  strike: K1, entryPrice: c1, quantity: 100 },
    { kind: 'call', side: 'short', strike: K2, entryPrice: c2, quantity: 100 },
  ];
  const debit = c1 - c2;
  const g1 = blackScholes({ S: p.S, K: K1, T, r: p.r, sigma: p.sigma });
  const g2 = blackScholes({ S: p.S, K: K2, T, r: p.r, sigma: p.sigma });
  return {
    legs,
    entryPerShare: -debit,
    entryPerContract: -debit * 100,
    maxProfit: (w - debit) * 100,
    maxLoss: debit * 100,
    breakEvens: [K1 + debit],
    breakEvenBandPct: (debit / p.S) * 100,
    netDelta: (g1.deltaCall - g2.deltaCall) * 100,
    netTheta: (g1.thetaCall - g2.thetaCall) * 100,
    netVega: (g1.vega / 100 - g2.vega / 100) * 100,
  };
}

function buildBearPutSpread(p: StrategyParams): BuiltStrategy {
  const T = p.daysToExpiry / 365;
  const d = p.delta ?? 0.50;
  const w = p.wingWidth ?? 5;
  const K1 = p.upperStrike ?? strikeForDelta({ S: p.S, sigma: p.sigma, r: p.r, T, targetDelta: d, side: 'put', dir: 'down' });
  const K2 = K1 - w;
  const p1 = priceLeg('put', p.S, K1, T, p.r, p.sigma);
  const p2 = priceLeg('put', p.S, K2, T, p.r, p.sigma);
  const legs: Leg[] = [
    { kind: 'put', side: 'long',  strike: K1, entryPrice: p1, quantity: 100 },
    { kind: 'put', side: 'short', strike: K2, entryPrice: p2, quantity: 100 },
  ];
  const debit = p1 - p2;
  const g1 = blackScholes({ S: p.S, K: K1, T, r: p.r, sigma: p.sigma });
  const g2 = blackScholes({ S: p.S, K: K2, T, r: p.r, sigma: p.sigma });
  return {
    legs,
    entryPerShare: -debit,
    entryPerContract: -debit * 100,
    maxProfit: (w - debit) * 100,
    maxLoss: debit * 100,
    breakEvens: [K1 - debit],
    breakEvenBandPct: (debit / p.S) * 100,
    netDelta: (g1.deltaPut - g2.deltaPut) * 100,
    netTheta: (g1.thetaPut - g2.thetaPut) * 100,
    netVega: (g1.vega / 100 - g2.vega / 100) * 100,
  };
}

function buildIronCondor(p: StrategyParams): BuiltStrategy {
  const T = p.daysToExpiry / 365;
  const d = p.delta ?? 0.16;
  const w = p.wingWidth ?? 5;
  const K_sc = strikeForDelta({ S: p.S, sigma: p.sigma, r: p.r, T, targetDelta: d, side: 'call', dir: 'up' });
  const K_sp = strikeForDelta({ S: p.S, sigma: p.sigma, r: p.r, T, targetDelta: d, side: 'put',  dir: 'down' });
  const K_lc = K_sc + w;
  const K_lp = K_sp - w;
  const csc = priceLeg('call', p.S, K_sc, T, p.r, p.sigma);
  const clc = priceLeg('call', p.S, K_lc, T, p.r, p.sigma);
  const psp = priceLeg('put', p.S, K_sp, T, p.r, p.sigma);
  const plp = priceLeg('put', p.S, K_lp, T, p.r, p.sigma);
  const credit = (csc - clc) + (psp - plp);
  const wings = Math.max(K_lc - K_sc, K_sp - K_lp);
  const legs: Leg[] = [
    { kind: 'call', side: 'short', strike: K_sc, entryPrice: csc, quantity: 100 },
    { kind: 'call', side: 'long',  strike: K_lc, entryPrice: clc, quantity: 100 },
    { kind: 'put',  side: 'short', strike: K_sp, entryPrice: psp, quantity: 100 },
    { kind: 'put',  side: 'long',  strike: K_lp, entryPrice: plp, quantity: 100 },
  ];
  const gsc = blackScholes({ S: p.S, K: K_sc, T, r: p.r, sigma: p.sigma });
  const glc = blackScholes({ S: p.S, K: K_lc, T, r: p.r, sigma: p.sigma });
  const gsp = blackScholes({ S: p.S, K: K_sp, T, r: p.r, sigma: p.sigma });
  const glp = blackScholes({ S: p.S, K: K_lp, T, r: p.r, sigma: p.sigma });
  return {
    legs,
    entryPerShare: credit,
    entryPerContract: credit * 100,
    maxProfit: credit * 100,
    maxLoss: -(wings - credit) * 100,
    breakEvens: [K_sp - credit, K_sc + credit],
    breakEvenBandPct: ((K_sc + credit - (K_sp - credit)) / p.S) * 100,
    netDelta: ((gsc.deltaCall - glc.deltaCall) + (gsp.deltaPut - glp.deltaPut)) * 100,
    netTheta: ((gsc.thetaCall - glc.thetaCall) + (gsp.thetaPut - glp.thetaPut)) * 100,
    netVega: ((gsc.vega - glc.vega) + (gsp.vega - glp.vega)) / 100,
  };
}

function buildIronButterfly(p: StrategyParams): BuiltStrategy {
  const T = p.daysToExpiry / 365;
  const w = p.wingWidth ?? 5;
  // ATM strike = nearest round.
  const K_center = roundStrike(p.S, 'up');
  const K_up = K_center + w;
  const K_dn = K_center - w;
  const cc = priceLeg('call', p.S, K_center, T, p.r, p.sigma);
  const cu = priceLeg('call', p.S, K_up, T, p.r, p.sigma);
  const pc = priceLeg('put', p.S, K_center, T, p.r, p.sigma);
  const pd = priceLeg('put', p.S, K_dn, T, p.r, p.sigma);
  const credit = (cc - cu) + (pc - pd);
  const legs: Leg[] = [
    { kind: 'call', side: 'short', strike: K_center, entryPrice: cc, quantity: 100 },
    { kind: 'call', side: 'long',  strike: K_up,     entryPrice: cu, quantity: 100 },
    { kind: 'put',  side: 'short', strike: K_center, entryPrice: pc, quantity: 100 },
    { kind: 'put',  side: 'long',  strike: K_dn,     entryPrice: pd, quantity: 100 },
  ];
  const gc = blackScholes({ S: p.S, K: K_center, T, r: p.r, sigma: p.sigma });
  const gu = blackScholes({ S: p.S, K: K_up, T, r: p.r, sigma: p.sigma });
  const gd = blackScholes({ S: p.S, K: K_dn, T, r: p.r, sigma: p.sigma });
  return {
    legs,
    entryPerShare: credit,
    entryPerContract: credit * 100,
    maxProfit: credit * 100,
    maxLoss: -(w - credit) * 100,
    breakEvens: [K_center - credit, K_center + credit],
    breakEvenBandPct: ((2 * credit) / p.S) * 100,
    netDelta: ((gc.deltaCall - gu.deltaCall) + (gc.deltaPut - gd.deltaPut)) * 100,
    netTheta: ((gc.thetaCall - gu.thetaCall) + (gc.thetaPut - gd.thetaPut)) * 100,
    netVega: ((gc.vega - gu.vega) + (gc.vega - gd.vega)) / 100,
  };
}

function buildLongStraddle(p: StrategyParams): BuiltStrategy {
  const T = p.daysToExpiry / 365;
  const K = p.strike ?? roundStrike(p.S, 'up');
  const cc = priceLeg('call', p.S, K, T, p.r, p.sigma);
  const pc = priceLeg('put', p.S, K, T, p.r, p.sigma);
  const debit = cc + pc;
  const legs: Leg[] = [
    { kind: 'call', side: 'long', strike: K, entryPrice: cc, quantity: 100 },
    { kind: 'put',  side: 'long', strike: K, entryPrice: pc, quantity: 100 },
  ];
  const gc = blackScholes({ S: p.S, K, T, r: p.r, sigma: p.sigma });
  return {
    legs,
    entryPerShare: -debit,
    entryPerContract: -debit * 100,
    maxProfit: null,
    maxLoss: debit * 100,
    breakEvens: [K - debit, K + debit],
    breakEvenBandPct: ((2 * debit) / p.S) * 100,
    netDelta: (gc.deltaCall + gc.deltaPut) * 100,
    netTheta: (gc.thetaCall + gc.thetaPut) * 100,
    netVega: (gc.vega / 100) * 200,
  };
}

function buildLongStrangle(p: StrategyParams): BuiltStrategy {
  const T = p.daysToExpiry / 365;
  const d = p.delta ?? 0.16;
  const w = p.wingWidth ?? 5;
  const K_c = strikeForDelta({ S: p.S, sigma: p.sigma, r: p.r, T, targetDelta: d, side: 'call', dir: 'up' });
  const K_p = strikeForDelta({ S: p.S, sigma: p.sigma, r: p.r, T, targetDelta: d, side: 'put',  dir: 'down' });
  const cc = priceLeg('call', p.S, K_c, T, p.r, p.sigma);
  const pp = priceLeg('put', p.S, K_p, T, p.r, p.sigma);
  const debit = cc + pp;
  const legs: Leg[] = [
    { kind: 'call', side: 'long', strike: K_c, entryPrice: cc, quantity: 100 },
    { kind: 'put',  side: 'long', strike: K_p, entryPrice: pp, quantity: 100 },
  ];
  const gc = blackScholes({ S: p.S, K: K_c, T, r: p.r, sigma: p.sigma });
  const gp = blackScholes({ S: p.S, K: K_p, T, r: p.r, sigma: p.sigma });
  return {
    legs,
    entryPerShare: -debit,
    entryPerContract: -debit * 100,
    maxProfit: null,
    maxLoss: debit * 100,
    breakEvens: [K_p - debit, K_c + debit],
    breakEvenBandPct: ((K_c + debit - (K_p - debit)) / p.S) * 100,
    netDelta: (gc.deltaCall + gp.deltaPut) * 100,
    netTheta: (gc.thetaCall + gp.thetaPut) * 100,
    netVega: (gc.vega / 100 + gp.vega / 100) * 100,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Strategy registry
// ─────────────────────────────────────────────────────────────────────────

export const STRATEGIES: Record<StrategyId, StrategyDefinition> = {
  long_call: {
    meta: {
      id: 'long_call', name: 'Long Call', emoji: '📈',
      category: 'bullish',
      shortDescription: 'Bet on a rally with limited risk.',
      longDescription: 'A long call gives you the right (not obligation) to buy the underlying at the strike before expiration. You pay a premium upfront; your max loss is that premium if the stock stays below the strike at expiry.',
      whenToUse: 'You expect a meaningful move higher and want leveraged upside with capped downside.',
      example: 'AAPL @ $185, buy a $190 call for $2.50 (45 DTE). If AAPL > $190 at expiry, you make (S_T − 190 − 2.50) × 100. If AAPL ≤ $190, the call expires worthless and you lose the $250 premium.',
      riskProfile: 'defined',
      maxProfitFormula: 'Unlimited (stock can rise indefinitely)',
      maxLossFormula: 'Premium paid × 100',
    },
    build: buildLongCall,
    defaultParams: { delta: 0.50 },
    usesDelta: true,
  },
  long_put: {
    meta: {
      id: 'long_put', name: 'Long Put', emoji: '📉',
      category: 'bearish',
      shortDescription: 'Bet on a drop with limited risk.',
      longDescription: 'A long put gives you the right to sell the underlying at the strike before expiration. You pay a premium; max loss is the premium if the stock stays above the strike.',
      whenToUse: 'You expect a meaningful move lower and want leveraged downside with capped risk. Also great as portfolio insurance.',
      example: 'AAPL @ $185, buy a $180 put for $3.00 (45 DTE). If AAPL < $180 at expiry, you make (180 − S_T − 3.00) × 100. Max profit is $177 × 100 = $17,700 if AAPL goes to $0. Max loss is $300.',
      riskProfile: 'defined',
      maxProfitFormula: '(Strike − Premium) × 100',
      maxLossFormula: 'Premium paid × 100',
    },
    build: buildLongPut,
    defaultParams: { delta: 0.50 },
    usesDelta: true,
  },
  short_put: {
    meta: {
      id: 'short_put', name: 'Short Put (Cash-Secured)', emoji: '💰',
      category: 'bullish',
      shortDescription: 'Collect premium to buy the dip.',
      longDescription: 'Sell a put and collect the premium. You are obligated to buy the stock at the strike if it finishes below. Cash-secured means you keep K × 100 in cash to cover the assignment.',
      whenToUse: 'You are bullish-to-neutral and would be happy to own the stock at a lower price. Generates income while you wait.',
      example: 'AAPL @ $185, sell a $180 put for $3.00 (45 DTE). Keep $18,000 cash secured. If AAPL > $180, you keep $300. If AAPL < $180, you buy 100 shares at $180 (effective cost $177) and still keep the stock.',
      riskProfile: 'defined',
      maxProfitFormula: 'Premium received × 100',
      maxLossFormula: '(Strike − Premium) × 100',
    },
    build: buildShortPut,
    defaultParams: { delta: 0.30 },
    usesDelta: true,
  },
  covered_call: {
    meta: {
      id: 'covered_call', name: 'Covered Call', emoji: '🏦',
      category: 'income',
      shortDescription: 'Own stock + sell a call for income.',
      longDescription: 'Hold 100 shares of stock and sell a call against them. The premium is yours no matter what; in exchange you cap your upside at the strike.',
      whenToUse: 'You already own (or want to own) the stock and expect it to stay flat-to-slightly-up. Earns yield on a long position.',
      example: 'Own 100 shares of AAPL @ $185. Sell a $190 call for $2.50. If AAPL < $190 at expiry, you keep the stock and the $250. If AAPL > $190, your shares get called away at $190 — you still net $5/share gain + $250 premium.',
      riskProfile: 'defined',
      maxProfitFormula: '(Strike − Cost + Premium) × 100',
      maxLossFormula: '(Cost − Premium) × 100 (if stock → 0)',
    },
    build: buildCoveredCall,
    defaultParams: { delta: 0.30 },
    usesDelta: true,
  },
  bull_call_spread: {
    meta: {
      id: 'bull_call_spread', name: 'Bull Call Spread', emoji: '🐂',
      category: 'bullish',
      shortDescription: 'Cheaper long call with capped upside.',
      longDescription: 'Buy a call at strike K₁ and sell a call at strike K₂ (K₂ > K₁). The sold call finances part of the bought call, reducing your debit.',
      whenToUse: 'You are bullish but think the move will be capped. Cheaper than a long call but your upside is also capped at K₂.',
      example: 'AAPL @ $185. Buy $185 call for $5.00, sell $190 call for $2.50. Net debit $2.50. If AAPL > $190, you make ($5 − $2.50) × 100 = $250. If AAPL < $185, you lose $250.',
      riskProfile: 'defined',
      maxProfitFormula: '(Wing − Debit) × 100',
      maxLossFormula: 'Debit × 100',
    },
    build: buildBullCallSpread,
    defaultParams: { delta: 0.50, wingWidth: 5 },
    usesDelta: true, usesWing: true,
  },
  bear_put_spread: {
    meta: {
      id: 'bear_put_spread', name: 'Bear Put Spread', emoji: '🐻',
      category: 'bearish',
      shortDescription: 'Cheaper long put with capped downside profit.',
      longDescription: 'Buy a put at K₁ and sell a put at K₂ (K₂ < K₁). The sold put finances part of the bought put.',
      whenToUse: 'You are bearish but think the drop is bounded. Cheaper than a long put but capped profit at K₂.',
      example: 'AAPL @ $185. Buy $185 put for $4.00, sell $180 put for $2.00. Net debit $2.00. If AAPL < $180, you make $3 × 100 = $300. If AAPL > $185, you lose $200.',
      riskProfile: 'defined',
      maxProfitFormula: '(Wing − Debit) × 100',
      maxLossFormula: 'Debit × 100',
    },
    build: buildBearPutSpread,
    defaultParams: { delta: 0.50, wingWidth: 5 },
    usesDelta: true, usesWing: true,
  },
  iron_condor: {
    meta: {
      id: 'iron_condor', name: 'Iron Condor', emoji: '🦅',
      category: 'neutral',
      shortDescription: 'Range-bound premium collection.',
      longDescription: 'Sell an OTM call spread + sell an OTM put spread. Net credit received. Profits if the stock stays in a range until expiry.',
      whenToUse: 'You expect low volatility and a range-bound underlying. Classic income play.',
      example: 'AAPL @ $185, 30 DTE. Sell 195/200 call spread for $0.74, sell 176/171 put spread for $0.81. Total credit $1.55 × 100 = $155. Max profit if AAPL stays between 176 and 195 at expiry.',
      riskProfile: 'defined',
      maxProfitFormula: 'Net credit × 100',
      maxLossFormula: '(Wing − Credit) × 100',
    },
    build: buildIronCondor,
    defaultParams: { delta: 0.16, wingWidth: 5 },
    usesDelta: true, usesWing: true,
  },
  iron_butterfly: {
    meta: {
      id: 'iron_butterfly', name: 'Iron Butterfly', emoji: '🦋',
      category: 'neutral',
      shortDescription: 'Tight-range credit spread.',
      longDescription: 'Same as an iron condor but with both short strikes at the same (ATM) strike. Higher credit, narrower profit zone.',
      whenToUse: 'You think the stock will pin near a specific strike. Higher reward per trade but lower probability of profit.',
      example: 'AAPL @ $185. Sell 185/190 call spread and 185/180 put spread. Credit ≈ $4.50 × 100 = $450. Profits if AAPL is exactly at $185 at expiry.',
      riskProfile: 'defined',
      maxProfitFormula: 'Net credit × 100',
      maxLossFormula: '(Wing − Credit) × 100',
    },
    build: buildIronButterfly,
    defaultParams: { wingWidth: 5 },
    usesWing: true,
  },
  long_straddle: {
    meta: {
      id: 'long_straddle', name: 'Long Straddle', emoji: '🎢',
      category: 'volatility',
      shortDescription: 'Profit from a big move in either direction.',
      longDescription: 'Buy an ATM call and an ATM put with the same strike and expiry. Pays off if the stock moves enough in either direction to exceed the total debit paid.',
      whenToUse: 'You expect a big move but don\'t know which way (e.g. before earnings, FDA decision, court ruling).',
      example: 'AAPL @ $185, buy 185 call for $5.00 and 185 put for $4.50. Debit $9.50 × 100 = $950. Profits if AAPL moves above $194.50 or below $175.50 by expiry.',
      riskProfile: 'defined',
      maxProfitFormula: 'Unlimited (one side keeps growing)',
      maxLossFormula: 'Total debit × 100 (if pin at strike)',
    },
    build: buildLongStraddle,
    defaultParams: {},
  },
  long_strangle: {
    meta: {
      id: 'long_strangle', name: 'Long Strangle', emoji: '🐍',
      category: 'volatility',
      shortDescription: 'Cheaper straddle with wider breakevens.',
      longDescription: 'Buy an OTM call and an OTM put. Cheaper than a straddle but needs a bigger move to profit.',
      whenToUse: 'You want a volatility play but cheaper than a straddle. Good when you expect a big move but are less certain of the size.',
      example: 'AAPL @ $185, buy 190 call for $3.00 and 180 put for $2.50. Debit $5.50 × 100 = $550. Profits if AAPL > $195.50 or < $174.50 by expiry.',
      riskProfile: 'defined',
      maxProfitFormula: 'Unlimited',
      maxLossFormula: 'Total debit × 100',
    },
    build: buildLongStrangle,
    defaultParams: { delta: 0.16 },
    usesDelta: true,
  },
};

export function buildStrategy(id: StrategyId, params: StrategyParams): BuiltStrategy {
  const def = STRATEGIES[id];
  if (!def) throw new Error(`Unknown strategyId: ${id} (valid: ${Object.keys(STRATEGIES).join(', ')})`);
  const merged = { ...def.defaultParams, ...params };
  return def.build(merged);
}

export function listStrategies(): StrategyDefinition[] {
  return Object.values(STRATEGIES);
}