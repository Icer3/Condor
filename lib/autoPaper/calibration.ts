// Auto-paper calibration analytics. Pure: takes a list of closed picks
// (the rows from auto_paper_picks) and produces the same kind of summary
// stats the /calibration dashboard shows for manual paper trades.
//
// Comparing predicted vs realized across N closes is the core dataset
// the auto-paper cron exists to collect.

export interface PickSummaryRow {
  pick_id: string;
  ticker: string;
  strategy_id: string;
  opened_at: string;
  closed_at: string | null;
  predicted_pop: number | null;
  predicted_pnl: number | null;
  predicted_maxloss: number | null;
  max_profit: number | null;
  realized_pnl: number | null;
  close_reason: string | null;
}

export interface CalibrationStats {
  total: number;
  closed: number;
  open: number;
  wins: number;
  losses: number;
  winRate: number;
  realizedTotal: number;
  predictedTotal: number;
  calibrationError: number;       // |realized - predicted| / |predicted|
  meanAbsoluteError: number;      // mean |realized - predicted|
  byStrategy: StrategyStats[];
  byRegime: RegimeStats[];
}

export interface StrategyStats {
  strategy_id: string;
  count: number;
  winRate: number;
  realizedTotal: number;
  predictedTotal: number;
  mae: number;
  avgPredictedPop: number;
  realizedPop: number;
}

export interface RegimeStats {
  regime: 'cheap' | 'normal' | 'expensive';
  count: number;
  winRate: number;
  realizedTotal: number;
}

function bucketOf(pop: number | null): number {
  if (pop == null) return -1;
  if (pop < 0.3) return 0;
  if (pop < 0.5) return 1;
  if (pop < 0.7) return 2;
  return 3;
}

/** Infer the IV regime from a predicted_pop + ticker pair. Pure heuristic —
 *  when we store the regime at open we should use the stored value; this
 *  is a fallback for rows that pre-date that column. */
function inferRegime(_pop: number | null, _strategyId: string): 'cheap' | 'normal' | 'expensive' {
  // Without a stored regime, default to "normal" — never crash the summary.
  return 'normal';
}

export function summarize(rows: PickSummaryRow[]): CalibrationStats {
  const closed = rows.filter(r => r.closed_at != null && r.realized_pnl != null);
  const open = rows.filter(r => r.closed_at == null);

  const wins = closed.filter(r => (r.realized_pnl ?? 0) > 0).length;
  const losses = closed.filter(r => (r.realized_pnl ?? 0) <= 0).length;
  const realizedTotal = closed.reduce((s, r) => s + (r.realized_pnl ?? 0), 0);
  const predictedTotal = closed.reduce((s, r) => s + (r.predicted_pnl ?? 0), 0);

  const absDiffs = closed.map(r => Math.abs((r.realized_pnl ?? 0) - (r.predicted_pnl ?? 0)));
  const meanAbsoluteError = absDiffs.length ? absDiffs.reduce((a, b) => a + b, 0) / absDiffs.length : 0;
  const calibrationError = Math.abs(predictedTotal) > 1
    ? Math.abs(realizedTotal - predictedTotal) / Math.abs(predictedTotal)
    : 0;

  // Per-strategy breakdown
  const byStrategyKey = new Map<string, PickSummaryRow[]>();
  for (const r of closed) {
    if (!byStrategyKey.has(r.strategy_id)) byStrategyKey.set(r.strategy_id, []);
    byStrategyKey.get(r.strategy_id)!.push(r);
  }
  const byStrategy: StrategyStats[] = [];
  for (const [strategy_id, list] of byStrategyKey) {
    const ws = list.filter(r => (r.realized_pnl ?? 0) > 0).length;
    const mae = list.reduce((s, r) => s + Math.abs((r.realized_pnl ?? 0) - (r.predicted_pnl ?? 0)), 0) / list.length;
    byStrategy.push({
      strategy_id,
      count: list.length,
      winRate: ws / list.length,
      realizedTotal: list.reduce((s, r) => s + (r.realized_pnl ?? 0), 0),
      predictedTotal: list.reduce((s, r) => s + (r.predicted_pnl ?? 0), 0),
      mae,
      avgPredictedPop: list.reduce((s, r) => s + (r.predicted_pop ?? 0), 0) / list.length,
      realizedPop: ws / list.length,
    });
  }
  byStrategy.sort((a, b) => b.count - a.count);

  // Per-regime breakdown (best-effort using inferRegime; if we have the
  // regime stored at open, callers should pre-bucket the rows).
  const byRegimeKey = new Map<'cheap' | 'normal' | 'expensive', PickSummaryRow[]>();
  for (const r of closed) {
    const reg = inferRegime(r.predicted_pop, r.strategy_id);
    if (!byRegimeKey.has(reg)) byRegimeKey.set(reg, []);
    byRegimeKey.get(reg)!.push(r);
  }
  const byRegime: RegimeStats[] = (['cheap', 'normal', 'expensive'] as const).map(regime => {
    const list = byRegimeKey.get(regime) ?? [];
    return {
      regime,
      count: list.length,
      winRate: list.length ? list.filter(r => (r.realized_pnl ?? 0) > 0).length / list.length : 0,
      realizedTotal: list.reduce((s, r) => s + (r.realized_pnl ?? 0), 0),
    };
  });

  return {
    total: rows.length,
    closed: closed.length,
    open: open.length,
    wins,
    losses,
    winRate: closed.length ? wins / closed.length : 0,
    realizedTotal,
    predictedTotal,
    calibrationError,
    meanAbsoluteError,
    byStrategy,
    byRegime,
  };
}

export { bucketOf };