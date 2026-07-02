// IV rank / vol environment detection from historical prices.
// Computes "current" vol as the last ~21 days of realized vol,
// then ranks it against the min/max of 21-day rolling windows over the full history.
// Returns 0-100 where 0 = historically cheap, 100 = historically expensive.

export interface IVEnvironment {
  rank: number;          // 0-100, current vs historical range
  tier: 'cheap' | 'normal' | 'expensive';
  emoji: string;
  color: string;
  recommendation: string;
  minVol: number;
  maxVol: number;
  currentVol: number;    // last-21-day realized vol (annualized)
  medianVol: number;     // median over the year
}

// Annualized realized vol over a slice of closes.
function annualizedVol(closes: number[]): number {
  if (closes.length < 5) return NaN;
  const rets: number[] = [];
  for (let i = 1; i < closes.length; i++) rets.push(Math.log(closes[i] / closes[i - 1]));
  const m = rets.reduce((a, b) => a + b, 0) / rets.length;
  const v = Math.sqrt(rets.reduce((a, b) => a + (b - m) ** 2, 0) / (rets.length - 1)) * Math.sqrt(252);
  return isFinite(v) && v > 0 ? v : NaN;
}

export function computeIVEnvironment(currentVol: number, history: number[]): IVEnvironment {
  // Fallback when not enough data — use absolute vol tier and median rank.
  if (history.length < 22) {
    const tier = currentVol > 0.30 ? 'expensive' : currentVol > 0.15 ? 'normal' : 'cheap';
    return {
      rank: 50,
      tier,
      emoji: tier === 'expensive' ? '🔴' : tier === 'cheap' ? '🟢' : '🟡',
      color: tier === 'expensive' ? 'var(--red)' : tier === 'cheap' ? 'var(--green)' : 'var(--yellow)',
      recommendation: 'limited history — using absolute vol tier',
      minVol: currentVol, maxVol: currentVol, currentVol, medianVol: currentVol,
    };
  }

  // Compute "current" as the last ~21 trading days (≈ 1 month) of vol.
  // This matches what traders mean by "where is vol right now".
  const WINDOW = 21;
  const recentVol = annualizedVol(history.slice(-WINDOW));

  // Compute rolling 21-day vol windows across the full year.
  const vols: number[] = [];
  for (let i = WINDOW; i <= history.length; i++) {
    const v = annualizedVol(history.slice(i - WINDOW, i));
    if (isFinite(v)) vols.push(v);
  }

  // If we still don't have enough windows (very short history), use absolute fallback.
  if (vols.length < 5) {
    const tier = currentVol > 0.30 ? 'expensive' : currentVol > 0.15 ? 'normal' : 'cheap';
    return {
      rank: 50, tier,
      emoji: tier === 'expensive' ? '🔴' : tier === 'cheap' ? '🟢' : '🟡',
      color: tier === 'expensive' ? 'var(--red)' : tier === 'cheap' ? 'var(--green)' : 'var(--yellow)',
      recommendation: 'not enough history — using absolute vol tier',
      minVol: currentVol, maxVol: currentVol, currentVol, medianVol: currentVol,
    };
  }

  const sorted = [...vols].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const median = sorted[Math.floor(sorted.length / 2)];
  const range = max - min || 1e-6;

  // Use the recent (last-21-day) vol as the live reading, not the full-year average.
  const liveVol = isFinite(recentVol) ? recentVol : currentVol;
  const rank = Math.max(0, Math.min(100, ((liveVol - min) / range) * 100));

  let tier: 'cheap' | 'normal' | 'expensive' = 'normal';
  let emoji = '🟡';
  let color = 'var(--yellow)';
  let recommendation = 'vol is normal — no strong edge either direction';

  if (rank > 60) {
    tier = 'expensive'; emoji = '🔴'; color = 'var(--red)';
    recommendation = `expensive vol (rank ${rank.toFixed(0)}) — great for selling premium`;
  } else if (rank < 30) {
    tier = 'cheap'; emoji = '🟢'; color = 'var(--green)';
    recommendation = `cheap vol (rank ${rank.toFixed(0)}) — avoid selling, buy premium instead`;
  } else {
    recommendation = `normal vol (rank ${rank.toFixed(0)}) — pick strategy based on direction, not vol`;
  }

  return { rank, tier, emoji, color, recommendation, minVol: min, maxVol: max, currentVol: liveVol, medianVol: median };
}

// ─────────────────────────────────────────────────────────────────────────
// Vol cone — multiple rolling-window annualized vols over the last ~year.
// Powers the on-page vol-env chart (shows where the current reading sits
// relative to the historical band of each window).
// ─────────────────────────────────────────────────────────────────────────

export interface VolConePoint {
  /** Day index from the start of the history window (oldest = 0). */
  i: number;
  /** Annualized realized vol over a 10-day rolling window. */
  v10: number | null;
  /** Annualized realized vol over a 21-day rolling window. */
  v21: number | null;
  /** Annualized realized vol over a 60-day rolling window. */
  v60: number | null;
}

export interface VolConeSummary {
  series: VolConePoint[];
  current: { v10: number; v21: number; v60: number };
  band21: { min: number; p25: number; median: number; p75: number; max: number };
}

const VOL_WINDOWS = [10, 21, 60] as const;

function rollingAnnualizedVol(closes: number[], window: number): number {
  if (closes.length < window + 1) return NaN;
  const slice = closes.slice(-window - 1);
  const rets: number[] = [];
  for (let i = 1; i < slice.length; i++) rets.push(Math.log(slice[i] / slice[i - 1]));
  const m = rets.reduce((a, b) => a + b, 0) / rets.length;
  return Math.sqrt(rets.reduce((a, b) => a + (b - m) ** 2, 0) / (rets.length - 1)) * Math.sqrt(252);
}

/** Build a small vol-cone dataset: rolling 10/21/60-day annualized vols across the full year. */
export function computeVolCone(history: number[]): VolConeSummary | null {
  if (history.length < 70) return null;

  const series: VolConePoint[] = [];
  for (let i = 0; i < history.length; i++) {
    const upTo = history.slice(0, i + 1);
    series.push({
      i,
      v10: upTo.length >= 11 ? rollingAnnualizedVol(upTo, 10) : null,
      v21: upTo.length >= 22 ? rollingAnnualizedVol(upTo, 21) : null,
      v60: upTo.length >= 61 ? rollingAnnualizedVol(upTo, 60) : null,
    });
  }

  const v21s = series.map(p => p.v21).filter((v): v is number => v != null && isFinite(v));
  const sorted = [...v21s].sort((a, b) => a - b);
  const band21 = {
    min: sorted[0] ?? 0,
    p25: sorted[Math.floor(sorted.length * 0.25)] ?? 0,
    median: sorted[Math.floor(sorted.length * 0.5)] ?? 0,
    p75: sorted[Math.floor(sorted.length * 0.75)] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
  };

  const currentSlice = history.slice(-61);
  return {
    series,
    current: {
      v10: rollingAnnualizedVol(currentSlice, 10) || NaN,
      v21: rollingAnnualizedVol(currentSlice, 21) || NaN,
      v60: rollingAnnualizedVol(currentSlice, 60) || NaN,
    },
    band21,
  };
}