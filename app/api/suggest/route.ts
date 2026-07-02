// Strategy autosuggest — given a ticker (or just S+sigma+IV rank+dte),
// rank all 10 strategies by expected grader score, then return top N.

import { NextRequest, NextResponse } from 'next/server';
import { buildStrategy, StrategyId, STRATEGIES } from '@/lib/strategies';
import { runMonteCarlo } from '@/lib/monteCarlo';
import { gradeStrategy } from '@/lib/strategyGrader';

export const runtime = 'nodejs';

interface Suggestion {
  id: StrategyId;
  name: string;
  emoji: string;
  category: string;
  score: number;
  verdict: 'take' | 'marginal' | 'skip';
  label: string;
  probProfit: number;
  expectedPnl: number;
  reasoning: string[];
  warnings: string[];
  defaults: Record<string, number>;
}

export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const { S0, mu = 0, sigma, r = 0.045, daysToExpiry = 30, ivRank = 50, numPaths = 2000, seed = 42, top = 3 } = body || {};
  if (typeof S0 !== 'number' || typeof sigma !== 'number') {
    return NextResponse.json({ error: 'S0 and sigma required' }, { status: 400 });
  }
  if (S0 <= 0 || sigma <= 0) return NextResponse.json({ error: 'S0, sigma must be > 0' }, { status: 400 });
  if (numPaths < 100 || numPaths > 20000) return NextResponse.json({ error: 'numPaths 100..20000' }, { status: 400 });

  const allIds = Object.keys(STRATEGIES) as StrategyId[];
  const results: Suggestion[] = [];
  for (const id of allIds) {
    try {
      const built = buildStrategy(id, { S: S0, sigma, r, daysToExpiry });
      const mc = runMonteCarlo({ S0, mu, sigma, r, daysToExpiry, legs: built.legs, numPaths, seed: seed + id.length });
      const score = gradeStrategy(
        { probProfit: mc.probProfit, expectedPnl: mc.expectedPnl, var95: mc.var95 },
        built, ivRank, daysToExpiry, sigma,
      );
      const meta = STRATEGIES[id].meta;
      results.push({
        id, name: meta.name, emoji: meta.emoji, category: meta.category,
        score: score.total, verdict: score.verdict, label: score.label,
        probProfit: mc.probProfit, expectedPnl: mc.expectedPnl,
        reasoning: score.reasoning, warnings: score.warnings,
        defaults: { ...STRATEGIES[id].defaultParams } as Record<string, number>,
      });
    } catch (e: any) {
      // skip broken strategies but don't crash the whole response
    }
  }
  results.sort((a, b) => b.score - a.score);
  return NextResponse.json({ suggestions: results.slice(0, top), total: results.length, rankedAll: results });
}
