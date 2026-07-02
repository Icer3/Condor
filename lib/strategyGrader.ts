// Strategy grader — 0-100 score with breakdown.

import { BuiltStrategy } from './strategies';

/** Subset of MCResult the grader actually inspects. Narrower than MCResult so callers
 *  that compute a quick PoP/EV estimate (e.g. compare page) don't have to fabricate all fields. */
export interface MCGraderInput {
  probProfit: number;
  expectedPnl: number;
  var95: number;
}

export interface GraderBreakdown {
  total: number;
  popScore: number;
  rrScore: number;
  ivScore: number;
  timingScore: number;
  verdict: 'take' | 'marginal' | 'skip';
  label: string;
  reasoning: string[];
  warnings: string[];
}

export function gradeStrategy(
  mc: MCGraderInput,
  built: BuiltStrategy,
  ivRank: number,
  daysToExpiry: number,
  sigma: number,
): GraderBreakdown {
  // P(profit) contribution (40 pts max). Saturates at 80% PoP.
  const popScore = Math.min(40, Math.max(0, mc.probProfit * 50));

  // Risk/reward contribution (25 pts max). Saturates at ~0.42.
  const rr = built.maxProfit != null && built.maxLoss != null && built.maxLoss < 0
    ? built.maxProfit / Math.abs(built.maxLoss)
    : 0;
  const rrScore = Math.min(25, Math.max(0, rr * 60));

  // IV environment (20 pts max). Higher IV rank = better for premium sellers.
  const ivScore = Math.min(20, Math.max(0, (ivRank / 100) * 20));

  // Timing (15 pts max). Sweet spot 21-45 DTE.
  let timingScore = 0;
  if (daysToExpiry >= 21 && daysToExpiry <= 45) timingScore = 15;
  else if (daysToExpiry >= 14 && daysToExpiry <= 60) timingScore = 10;
  else if (daysToExpiry >= 7 && daysToExpiry <= 75) timingScore = 6;
  else if (daysToExpiry > 0) timingScore = 3;

  const total = Math.round(popScore + rrScore + ivScore + timingScore);

  let verdict: 'take' | 'marginal' | 'skip' = 'skip';
  let label = 'skip';
  if (total >= 70) { verdict = 'take'; label = 'TAKE'; }
  else if (total >= 50) { verdict = 'marginal'; label = 'MARGINAL'; }
  else { verdict = 'skip'; label = 'SKIP'; }

  const reasoning: string[] = [];
  reasoning.push(`PoP ${(mc.probProfit * 100).toFixed(0)}% → ${popScore.toFixed(0)}/40`);
  reasoning.push(`R/R ${rr.toFixed(2)} → ${rrScore.toFixed(0)}/25`);
  reasoning.push(`IV rank ${ivRank.toFixed(0)}% → ${ivScore.toFixed(0)}/20`);
  reasoning.push(`DTE ${daysToExpiry}d → ${timingScore}/15`);

  const warnings: string[] = [];
  if (mc.probProfit < 0.5) warnings.push('PoP below 50% — strike selection too aggressive');
  if (rr < 0.15 && built.maxLoss != null) warnings.push('R/R below 0.15 — premium doesn\'t justify the risk');
  if (ivRank < 30) warnings.push('Vol is cheap — selling premium is fighting the trend');
  if (daysToExpiry < 7) warnings.push('Less than 1 week to expiry — gamma risk extreme');
  if (daysToExpiry > 60) warnings.push('Over 60 DTE — capital tied up, slow theta');
  if (mc.expectedPnl < 0) warnings.push('Negative expected value — the math says skip');
  if (mc.var95 > Math.abs(built.maxLoss ?? 0) * 0.7) warnings.push('Tail risk (CVaR) consumes most of max loss');

  return { total, popScore, rrScore, ivScore, timingScore, verdict, label, reasoning, warnings };
}