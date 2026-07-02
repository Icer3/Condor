import { NextRequest, NextResponse } from 'next/server';
import { runMonteCarlo, generateInsights } from '@/lib/monteCarlo';
import { buildStrategy, StrategyId, STRATEGIES } from '@/lib/strategies';

export const runtime = 'nodejs';

const MAX_PATHS = 200_000;
const MAX_DTE = 730;

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const {
    strategyId = 'iron_condor',
    S0, mu = 0, sigma, r = 0.045, daysToExpiry,
    params = {},
    numPaths = 10000,
    seed,
  } = body || {};

  if (typeof S0 !== 'number' || typeof sigma !== 'number' || typeof daysToExpiry !== 'number') {
    return NextResponse.json({ error: 'S0, sigma, daysToExpiry must be numbers' }, { status: 400 });
  }
  if (!Number.isFinite(S0) || S0 <= 0) {
    return NextResponse.json({ error: 'S0 must be a positive finite number' }, { status: 400 });
  }
  if (!Number.isFinite(sigma) || sigma <= 0) {
    return NextResponse.json({ error: 'sigma must be a positive finite number' }, { status: 400 });
  }
  if (!Number.isFinite(daysToExpiry) || daysToExpiry < 0 || daysToExpiry > MAX_DTE) {
    return NextResponse.json({ error: `daysToExpiry must be 0..${MAX_DTE}` }, { status: 400 });
  }
  if (!Number.isFinite(numPaths) || numPaths < 100 || numPaths > MAX_PATHS) {
    return NextResponse.json({ error: `numPaths must be 100..${MAX_PATHS}` }, { status: 400 });
  }
  if (!(strategyId in STRATEGIES)) {
    return NextResponse.json({ error: `Unknown strategyId: ${strategyId}` }, { status: 400 });
  }

  try {
    const built = buildStrategy(strategyId as StrategyId, { S: S0, sigma, r, daysToExpiry, ...params });
    const mc = runMonteCarlo({ S0, mu, sigma, r, daysToExpiry, legs: built.legs, numPaths, seed });
    const insights = generateInsights(
      mc, built.legs, S0, daysToExpiry, sigma,
      built.netDelta, built.netTheta, built.netVega,
      { maxProfit: built.maxProfit, maxLoss: built.maxLoss, breakEvens: built.breakEvens, riskReward: built.maxLoss != null && built.maxProfit != null ? built.maxProfit / Math.max(0.0001, -built.maxLoss) : undefined },
    );

    return NextResponse.json({
      strategyId,
      mc,
      built,
      insights,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'simulation failed' }, { status: 500 });
  }
}