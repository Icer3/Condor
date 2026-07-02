// Backtesting engine: replay strategy entries across historical window.
// For each (entry date) we compute strategy at that historical spot + realized vol,
// then run a quick MC at that entry to estimate outcome, log result, and aggregate stats.

import { NextRequest, NextResponse } from 'next/server';
import { buildStrategy, StrategyId, STRATEGIES } from '@/lib/strategies';
import { runMonteCarlo } from '@/lib/monteCarlo';

export const runtime = 'nodejs';

interface BacktestTrade {
  entryDate: string;
  exitDate?: string;
  entryPrice: number;
  sigma: number;
  probProfit: number;
  expectedPnl: number;
  realizedMove: number;     // actual spot move over holding period
  pnl: number;              // realized P/L per share using entry/exit prices + entry premium
  win: boolean;
}

interface BacktestResult {
  strategyId: StrategyId;
  totalTrades: number;
  wins: number;
  winRate: number;
  avgPnl: number;
  sharpe: number;
  maxDrawdown: number;
  trades: BacktestTrade[];
  startDate: string;
  endDate: string;
  holdingDays: number;
}

export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const {
    strategyId = 'iron_condor',
    closes,
    holdingDays = 30,
    entryEveryNDays = 14,
    r = 0.045,
    daysToExpiry = 30,
    delta = 0.30,
    wingWidth = 5,
    sigma = 0.30,
    numPaths = 1000,
    seed = 42,
  } = body || {};
  if (!Array.isArray(closes) || closes.length < 50) {
    return NextResponse.json({ error: 'closes array (>=50 points) required' }, { status: 400 });
  }
  if (!(strategyId in STRATEGIES)) {
    return NextResponse.json({ error: `Unknown strategyId: ${strategyId}` }, { status: 400 });
  }

  const trades: BacktestTrade[] = [];
  let peak = 0, maxDD = 0, cumulative = 0;

  for (let i = 0; i + holdingDays < closes.length; i += entryEveryNDays) {
    const entryS = closes[i];
    const exitS = closes[i + holdingDays];
    if (!Number.isFinite(entryS) || !Number.isFinite(exitS) || entryS <= 0) continue;
    // Compute historical realized vol over the prior 30 closes.
    const slice = closes.slice(Math.max(0, i - 30), i);
    const histVol = realizedVol(slice);
    const useSigma = histVol > 0 ? histVol : sigma;
    const built = buildStrategy(strategyId as StrategyId, { S: entryS, sigma: useSigma, r, daysToExpiry, delta, wingWidth });
    const mc = runMonteCarlo({ S0: entryS, mu: 0, sigma: useSigma, r, daysToExpiry, legs: built.legs, numPaths, seed: seed + i });
    // Realized P/L: use original leg entry prices, recompute intrinsic at exit price.
    let pnl = 0;
    for (const leg of built.legs) {
      const intrinsic = leg.kind === 'call' ? Math.max(0, exitS - (leg.strike ?? 0))
                      : leg.kind === 'put' ? Math.max(0, (leg.strike ?? 0) - exitS)
                      : exitS;
      pnl += (leg.side === 'long' ? 1 : -1) * (intrinsic - leg.entryPrice);
    }
    const cum = cumulative + pnl;
    if (cum > peak) peak = cum;
    const dd = peak - cum;
    if (dd > maxDD) maxDD = dd;
    cumulative = cum;
    trades.push({
      entryDate: `t=${i}`,
      exitDate: `t=${i + holdingDays}`,
      entryPrice: entryS,
      sigma: useSigma,
      probProfit: mc.probProfit,
      expectedPnl: mc.expectedPnl,
      realizedMove: (exitS - entryS) / entryS,
      pnl,
      win: pnl > 0,
    });
  }
  if (trades.length === 0) {
    return NextResponse.json({ error: 'no trades fit window' }, { status: 400 });
  }
  const wins = trades.filter(t => t.win).length;
  const pnls = trades.map(t => t.pnl);
  const mean = pnls.reduce((a, b) => a + b, 0) / pnls.length;
  const variance = pnls.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, pnls.length - 1);
  const std = Math.sqrt(variance);
  const result: BacktestResult = {
    strategyId,
    totalTrades: trades.length,
    wins,
    winRate: wins / trades.length,
    avgPnl: mean,
    sharpe: std > 0 ? mean / std : 0,
    maxDrawdown: maxDD,
    trades,
    startDate: `t=0`,
    endDate: `t=${closes.length - 1}`,
    holdingDays,
  };
  return NextResponse.json({ result });
}

function realizedVol(prices: number[]): number {
  if (prices.length < 5) return 0;
  const rets: number[] = [];
  for (let i = 1; i < prices.length; i++) rets.push(Math.log(prices[i] / prices[i - 1]));
  const m = rets.reduce((a, b) => a + b, 0) / rets.length;
  return Math.sqrt(rets.reduce((a, b) => a + (b - m) ** 2, 0) / (rets.length - 1)) * Math.sqrt(252);
}
