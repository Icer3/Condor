// Infer past earnings dates from large moves in the historical price series.
// For each historical earnings cluster, extrapolate forward to find the next estimated earnings.
// Then compute safe DTE ranges that avoid straddling earnings.

export interface EarningsSignal {
  date: string;             // YYYY-MM-DD
  absMovePct: number;       // e.g. 0.0725 = 7.25% single-day move
  type: 'historical' | 'projected';
}

export interface EarningsContext {
  signals: EarningsSignal[];
  nextProjected?: string;          // estimated next earnings date (if any)
  averageIntervalDays: number | null;   // days between earnings (if enough data)
  avoidRanges: Array<{ from: string; to: string }>;  // dte windows that straddle earnings
  recommendation: 'safe-anywhere' | 'avoid-cluster';
}

const THRESHOLD = 0.04; // 4% single-day move counts as earnings-like

export function detectEarnings(candles: { date: string; close: number }[]): EarningsContext {
  if (candles.length < 5) return { signals: [], averageIntervalDays: null, avoidRanges: [], recommendation: 'safe-anywhere' };

  const moves: EarningsSignal[] = [];
  for (let i = 1; i < candles.length; i++) {
    const pct = (candles[i].close - candles[i - 1].close) / candles[i - 1].close;
    if (Math.abs(pct) >= THRESHOLD) {
      moves.push({ date: candles[i].date, absMovePct: Math.abs(pct), type: 'historical' });
    }
  }

  // Cluster: consecutive moves within 2 days collapse to a single earnings window.
  const clustered: EarningsSignal[] = [];
  for (const m of moves) {
    const last = clustered[clustered.length - 1];
    if (last && Math.abs(new Date(m.date).getTime() - new Date(last.date).getTime()) < 4 * 86400000) {
      // Keep the larger of the two moves if same cluster.
      if (m.absMovePct > last.absMovePct) clustered[clustered.length - 1] = m;
    } else {
      clustered.push(m);
    }
  }

  if (clustered.length < 2) {
    return { signals: clustered, averageIntervalDays: null, avoidRanges: [], recommendation: 'safe-anywhere' };
  }

  // Compute typical interval.
  const intervals: number[] = [];
  for (let i = 1; i < clustered.length; i++) {
    intervals.push(Math.round((new Date(clustered[i].date).getTime() - new Date(clustered[i - 1].date).getTime()) / 86400000));
  }
  const avg = Math.round(intervals.reduce((a, b) => a + b, 0) / intervals.length);

  // Project next earnings forward from the last known signal.
  const last = clustered[clustered.length - 1];
  const projected = new Date(new Date(last.date).getTime() + avg * 86400000).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  const signals: EarningsSignal[] = [...clustered];
  if (projected > today) {
    signals.push({ date: projected, absMovePct: 0, type: 'projected' });
  }

  // Avoid-range: DTE that would straddle projected earnings.
  // If earnings is N days from today and we hold for D days, we straddle if D > N.
  // Suggest avoiding DTEs that span [earnings-2d, earnings+2d].
  const avoidRanges: { from: string; to: string }[] = [];
  const projectedDate = new Date(projected);
  if (projected > today) {
    const daysAway = Math.round((projectedDate.getTime() - Date.now()) / 86400000);
    if (daysAway > 0 && daysAway < 120) {
      const from = String(daysAway - 2);
      const to = String(daysAway + 2);
      avoidRanges.push({ from, to });
    }
  }

  return {
    signals,
    nextProjected: projected > today ? projected : undefined,
    averageIntervalDays: avg,
    avoidRanges,
    recommendation: avoidRanges.length ? 'avoid-cluster' : 'safe-anywhere',
  };
}

/** Given a chosen DTE, return whether it straddles projected earnings. */
export function dteStraddlesEarnings(dte: number, ctx: EarningsContext): boolean {
  if (!ctx.nextProjected) return false;
  const daysAway = Math.round((new Date(ctx.nextProjected).getTime() - Date.now()) / 86400000);
  if (daysAway <= 0) return false;
  // Straddles if DTE exceeds daysAway by more than 2 buffer.
  return dte > daysAway + 2;
}

export const EARNINGS_THRESHOLD = THRESHOLD;
