// Synthetic vol surface / smile generator.
// Without a live options chain we fit a parametric SVI-like smile
// around the spot using the realized vol as the ATM IV anchor.
// Real implementation would replace this with chain-derived IVs.

export interface VolSmilePoint {
  strike: number;
  moneyness: number;   // K/S - 1 (percent OTM if negative)
  iv: number;          // annualized vol implied at this strike
}

export interface VolSmile {
  spot: number;
  atmIv: number;
  dte: number;
  points: VolSmilePoint[];
  maxIv: number;
  minIv: number;
  skewPct: number;     // (ivCall - ivPut) / atmIv, measure of asymmetry
}

/** Generate a stylized smile: ATM anchor + skew + smile wings.
 *  Math: simple parametric model
 *    log-moneyness m = log(K/S)
 *    sigma(m) = atmIv * (1 + a*m + b*m^2)
 *  a = skew (negative = steeper put wing, positive = steeper call wing)
 *  b = convexity (>0 = smile, <0 = frown) */
export function generateSmile(
  spot: number,
  atmIv: number,
  dte: number,
  opts?: { skew?: number; convexity?: number; points?: number; moneynessRange?: number },
): VolSmile {
  const skew = opts?.skew ?? -2.0;       // mild put skew (typical of equity indices)
  const convexity = opts?.convexity ?? 5.0; // upward smile
  const N = opts?.points ?? 25;
  const span = opts?.moneynessRange ?? 0.20; // strikes within ±20% of spot

  // Time-scaling: smile flattens slightly for longer expiries.
  const tScale = Math.sqrt(dte / 30);
  const a = skew * tScale;
  const b = convexity;

  const out: VolSmilePoint[] = [];
  for (let i = 0; i < N; i++) {
    const m = (i / (N - 1) - 0.5) * 2 * span; // symmetric around 0
    const k = spot * Math.exp(m);
    const iv = atmIv * (1 + a * m + b * m * m);
    out.push({ strike: k, moneyness: m, iv: Math.max(0.05, iv) });
  }
  const ivs = out.map(p => p.iv);
  return {
    spot, atmIv, dte,
    points: out,
    minIv: Math.min(...ivs),
    maxIv: Math.max(...ivs),
    skewPct: a,
  };
}

/** Estimate ATM IV from a recent realized-vol series if a chain isn't available. */
export function atmIvFromRealized(realized: number): number {
  // On average IV ≈ HV × 1.1 for US large-caps. Slight skew on top of that.
  return Math.max(0.08, realized * 1.1);
}
