// Pure functions that aggregate calibration rows into dashboard-ready stats.
// No DB access here — caller passes already-fetched rows.

import type { CalibrationRow } from '@/lib/db/supabase/calibrationRepo';

export interface CalibrationSummary {
  totalOpens: number;
  totalClosed: number;
  totalOpen: number;       // currently open
  realizedTotal: number;   // sum of realized_pnl across closed rows ($)
  predictedTotal: number;  // sum of predicted_pnl across closed rows ($)
  calibrationError: number;// |realized - predicted| / |predicted|, unit-less ratio (e.g. 0.12 = 12%)
  winRate: number;         // closed positions with realized_pnl > 0 / total closed
  /** Histogram of realized win-rate per predicted-pop bucket. Bucket edges inclusive lower, exclusive upper. */
  byPopBucket: PopBucket[];
  byStrategy: StrategyBreakdown[];
  byBucketDatum: { predicted: number; realized: number; n: number }[];
}

export interface PopBucket {
  bucketLabel: string;     // "0-10%", "10-20%", ...
  predictedAvg: number;    // mean predicted_pop in this bucket
  realizedWinRate: number; // realized win rate in this bucket
  count: number;
}

export interface StrategyBreakdown {
  strategy_id: string;
  ticker: string;
  count: number;
  avgPredictedPop: number;
  realizedWinRate: number;
  predictedTotal: number;
  realizedTotal: number;
  mae: number;             // mean abs error of P/L: mean(|realized - predicted|)
}

const BUCKET_EDGES = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0001];

function bucketOf(pop: number | null): number {
  if (pop == null) return -1;
  for (let i = 0; i < BUCKET_EDGES.length - 1; i++) {
    if (pop >= BUCKET_EDGES[i] && pop < BUCKET_EDGES[i + 1]) return i;
  }
  return BUCKET_EDGES.length - 2;
}

function bucketLabel(idx: number): string {
  const lo = Math.round(BUCKET_EDGES[idx] * 100);
  const hi = Math.round(BUCKET_EDGES[idx + 1] * 100);
  return `${lo}-${hi}%`;
}

export function summarize(rows: CalibrationRow[]): CalibrationSummary {
  const closed = rows.filter(r => r.closed_at != null && r.realized_pnl != null);
  const opensOnly = rows.filter(r => r.closed_at == null);

  const realizedTotal = closed.reduce((s, r) => s + (r.realized_pnl ?? 0), 0);
  const predictedTotal = closed.reduce((s, r) => s + (r.predicted_pnl ?? 0), 0);
  const numWins = closed.filter(r => (r.realized_pnl ?? 0) > 0).length;
  const winRate = closed.length ? numWins / closed.length : 0;
  const calibrationError = Math.abs(predictedTotal) > 1
    ? Math.abs(realizedTotal - predictedTotal) / Math.abs(predictedTotal)
    : 0;

  // Bucket rows by predicted_pop
  const buckets = new Map<number, CalibrationRow[]>();
  for (const r of closed) {
    const idx = bucketOf(r.predicted_pop);
    if (idx < 0) continue;
    if (!buckets.has(idx)) buckets.set(idx, []);
    buckets.get(idx)!.push(r);
  }
  const byPopBucket: PopBucket[] = [];
  for (let i = 0; i < BUCKET_EDGES.length - 1; i++) {
    const inBucket = buckets.get(i) ?? [];
    if (inBucket.length === 0) continue;
    const predictedAvg = inBucket.reduce((s, r) => s + (r.predicted_pop ?? 0), 0) / inBucket.length;
    const wins = inBucket.filter(r => (r.realized_pnl ?? 0) > 0).length;
    byPopBucket.push({
      bucketLabel: bucketLabel(i),
      predictedAvg,
      realizedWinRate: wins / inBucket.length,
      count: inBucket.length,
    });
  }
  // Discrete-bucket chart data for scatter-like rendering
  const byBucketDatum = byPopBucket.map(b => ({
    predicted: b.predictedAvg,
    realized: b.realizedWinRate,
    n: b.count,
  }));

  // Per-strategy breakdown (across all tickers aggregated)
  const byStrategyKey = new Map<string, CalibrationRow[]>();
  for (const r of closed) {
    const k = r.strategy_id;
    if (!byStrategyKey.has(k)) byStrategyKey.set(k, []);
    byStrategyKey.get(k)!.push(r);
  }
  const byStrategy: StrategyBreakdown[] = [];
  for (const [strategy_id, list] of byStrategyKey.entries()) {
    const avgPredictedPop = list.reduce((s, r) => s + (r.predicted_pop ?? 0), 0) / list.length;
    const realizedWinRate = list.filter(r => (r.realized_pnl ?? 0) > 0).length / list.length;
    const sumRealized = list.reduce((s, r) => s + (r.realized_pnl ?? 0), 0);
    const sumPredicted = list.reduce((s, r) => s + (r.predicted_pnl ?? 0), 0);
    const mae = list.reduce((s, r) => s + Math.abs((r.realized_pnl ?? 0) - (r.predicted_pnl ?? 0)), 0) / list.length;
    // Cheapest ticker as the strategy breakdown label
    const ticker = list[0]?.ticker ?? '';
    byStrategy.push({
      strategy_id,
      ticker,
      count: list.length,
      avgPredictedPop,
      realizedWinRate,
      predictedTotal: sumPredicted,
      realizedTotal: sumRealized,
      mae,
    });
  }
  byStrategy.sort((a, b) => b.count - a.count);

  return {
    totalOpens: rows.length,
    totalClosed: closed.length,
    totalOpen: opensOnly.length,
    realizedTotal,
    predictedTotal,
    calibrationError,
    winRate,
    byPopBucket,
    byStrategy,
    byBucketDatum,
  };
}

/** Empty-summary placeholder so the dashboard renders even before any positions exist. */
export function emptySummary(): CalibrationSummary {
  return {
    totalOpens: 0,
    totalClosed: 0,
    totalOpen: 0,
    realizedTotal: 0,
    predictedTotal: 0,
    calibrationError: 0,
    winRate: 0,
    byPopBucket: [],
    byStrategy: [],
    byBucketDatum: [],
  };
}
