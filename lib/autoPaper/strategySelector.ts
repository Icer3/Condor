// Auto-paper strategy selector — picks the right strategy for a ticker given
// its current IV regime. Pure function: no DB access, no fetches. The caller
// provides the quote + history and gets back a structured PickIntent.
//
// Rules of thumb (founder-mode v1):
//   - IV rank < 30 (cheap): buy premium (long calls, puts, straddles)
//     — defined risk, directional or vol plays
//   - IV rank 30–60 (normal): defined-risk directional spreads
//     — bull/bear call/put spreads
//   - IV rank > 60 (expensive): sell premium
//     — short puts, iron condors, covered calls, iron butterflies
//
// The actual pick is the highest-scoring strategy within the chosen category
// (using lib/strategyGrader on a real MC run), so the *choice* is data-driven
// but the *universe* is regime-driven.

import { StrategyId, STRATEGIES, StrategyParams, buildStrategy, BuiltStrategy, StrategyCategory } from '@/lib/strategies';
import { runMonteCarlo, MCResult } from '@/lib/monteCarlo';
import { gradeStrategy, GraderBreakdown } from '@/lib/strategyGrader';

export interface SelectorInput {
  ticker: string;
  S0: number;            // spot
  sigma: number;         // annualized realized vol (decimal, e.g. 0.27)
  ivRank: number;        // 0..100
  daysToExpiry?: number; // default 30
  contracts?: number;    // default 1
  numPaths?: number;     // default 5000
  seed?: number;         // default 7
}

export interface PickIntent {
  ticker: string;
  strategyId: StrategyId;
  strategyName: string;
  category: StrategyCategory;
  built: BuiltStrategy;
  mc: MCResult;
  grader: GraderBreakdown;
  ivRegime: 'cheap' | 'normal' | 'expensive';
  reasoning: string[];
}

// Buckets strategies by regime. Strategies can appear in multiple buckets
// (e.g. long_call works in cheap and normal regimes).
const BUCKETS: Record<'cheap' | 'normal' | 'expensive', StrategyId[]> = {
  cheap:    ['long_call', 'long_put', 'long_straddle', 'long_strangle'],
  normal:   ['long_call', 'long_put', 'bull_call_spread', 'bear_put_spread', 'short_put', 'iron_condor'],
  expensive:['short_put', 'covered_call', 'iron_condor', 'iron_butterfly', 'bull_call_spread'],
};

function pickRegime(rank: number): 'cheap' | 'normal' | 'expensive' {
  if (rank < 30) return 'cheap';
  if (rank > 60) return 'expensive';
  return 'normal';
}

export function selectStrategyForRegime(input: SelectorInput): PickIntent {
  const dte = input.daysToExpiry ?? 30;
  const contracts = input.contracts ?? 1;
  const numPaths = input.numPaths ?? 5000;
  const seed = input.seed ?? 7;
  const r = 0.045; // risk-free rate (matches the rest of the app)

  const regime = pickRegime(input.ivRank);
  const universe = BUCKETS[regime];

  // Run MC + grader on every strategy in the regime bucket, pick the highest scorer.
  let best: { id: StrategyId; built: BuiltStrategy; mc: MCResult; grader: GraderBreakdown } | null = null;
  const rejected: { id: StrategyId; score: number; reason: string }[] = [];

  for (const id of universe) {
    try {
      const params: StrategyParams = {
        S: input.S0, sigma: input.sigma, r, daysToExpiry: dte,
        // Strategy defaults are merged inside buildStrategy — we only override if the caller wants.
      };
      const built = buildStrategy(id, params);
      const mc = runMonteCarlo({ S0: input.S0, mu: 0, sigma: input.sigma, r, daysToExpiry: dte, legs: built.legs, numPaths, seed: seed + id.length });
      const grader = gradeStrategy(mc, built, input.ivRank, dte, input.sigma);
      if (!best || grader.total > best.grader.total) {
        best = { id, built, mc, grader };
      }
    } catch (e: any) {
      rejected.push({ id, score: 0, reason: e?.message ?? 'build failed' });
    }
  }

  if (!best) {
    throw new Error(`no viable strategy for ${input.ticker} under regime=${regime}; rejected=${JSON.stringify(rejected)}`);
  }

  const meta = STRATEGIES[best.id].meta;
  const reasoning: string[] = [];
  reasoning.push(`IV rank ${input.ivRank.toFixed(0)} → ${regime} vol regime`);
  reasoning.push(`${universe.length} strategies in the regime bucket; ${meta.name} wins with grader ${best.grader.total}/100 (${best.grader.label})`);
  reasoning.push(`PoP ${(best.mc.probProfit * 100).toFixed(0)}% · E[P/L] $${best.mc.expectedPnl.toFixed(0)}/sh · max loss $${Math.abs(best.built.maxLoss ?? 0).toFixed(0)}/contract`);
  if (best.grader.warnings?.length) {
    for (const w of best.grader.warnings.slice(0, 2)) reasoning.push(`⚠ ${w}`);
  }

  return {
    ticker: input.ticker,
    strategyId: best.id,
    strategyName: meta.name,
    category: meta.category,
    built: best.built,
    mc: best.mc,
    grader: best.grader,
    ivRegime: regime,
    reasoning,
  };
}