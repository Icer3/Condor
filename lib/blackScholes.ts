// Black-Scholes option pricing + normal distribution utilities.

/** Standard normal CDF (Abramowitz & Stegun 7.1.26, max error ~7.5e-8). */
export function normCdf(x: number): number {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.sqrt(2);
  const t = 1.0 / (1.0 + p * ax);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return 0.5 * (1.0 + sign * y);
}

/** Standard normal PDF. */
export function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

export interface BSInputs {
  S: number;       // spot
  K: number;       // strike
  T: number;       // years to expiry
  r: number;       // annualized risk-free rate (decimal)
  sigma: number;   // annualized vol (decimal)
}

export interface BSResult {
  call: number;
  put: number;
  d1: number;
  d2: number;
  deltaCall: number;
  deltaPut: number;
  gamma: number;
  vega: number;        // per 1.00 of sigma
  thetaCall: number;   // per day
  thetaPut: number;
}

export function blackScholes({ S, K, T, r, sigma }: BSInputs): BSResult {
  if (T <= 0 || sigma <= 0) {
    const intrinsicC = Math.max(0, S - K);
    const intrinsicP = Math.max(0, K - S);
    return {
      call: intrinsicC, put: intrinsicP,
      d1: 0, d2: 0,
      deltaCall: S > K ? 1 : 0,
      deltaPut: S < K ? -1 : 0,
      gamma: 0, vega: 0, thetaCall: 0, thetaPut: 0,
    };
  }
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  const call = S * normCdf(d1) - K * Math.exp(-r * T) * normCdf(d2);
  const put = K * Math.exp(-r * T) * normCdf(-d2) - S * normCdf(-d1);
  const deltaCall = normCdf(d1);
  const deltaPut = deltaCall - 1;
  const gamma = normPdf(d1) / (S * sigma * sqrtT);
  const vega = S * normPdf(d1) * sqrtT; // per 1.00 of sigma
  const thetaCall = (-S * normPdf(d1) * sigma / (2 * sqrtT) - r * K * Math.exp(-r * T) * normCdf(d2)) / 365;
  const thetaPut = (-S * normPdf(d1) * sigma / (2 * sqrtT) + r * K * Math.exp(-r * T) * normCdf(-d2)) / 365;
  return { call, put, d1, d2, deltaCall, deltaPut, gamma, vega, thetaCall, thetaPut };
}

/** Realized annualized vol from a series of prices (log-returns). */
export function realizedVol(prices: number[]): number | null {
  if (prices.length < 5) return null;
  const r: number[] = [];
  for (let i = 1; i < prices.length; i++) r.push(Math.log(prices[i] / prices[i - 1]));
  const m = r.reduce((a, b) => a + b, 0) / r.length;
  const v = r.reduce((a, b) => a + (b - m) ** 2, 0) / (r.length - 1);
  return Math.sqrt(v) * Math.sqrt(252);
}

/** Inverse normal CDF (Beasley-Springer-Moro). */
export function inverseNormCdf(p: number): number {
  if (p <= 0 || p >= 1) return 0;
  const a = [-39.6968302866538, 220.946098424521, -275.928510446969,
             138.357751867269, -30.6647980661472, 2.50662827745924];
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887,
             66.8013118877197, -13.2806815528857];
  const c = [-7.78489400243029e-3, -0.322396458041136, -2.40075827716184,
             -2.54973253934373, 4.37466414146497, 2.93816398269878];
  const d = [7.78469570904146e-3, 0.32246712907004, 2.445134137143, 3.75440866190742];
  const plow = 0.02425, phigh = 1 - plow;
  let q: number, rr: number;
  if (p < plow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
           ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
  }
  if (p <= phigh) {
    q = p - 0.5; rr = q*q;
    return (((((a[0]*rr+a[1])*rr+a[2])*rr+a[3])*rr+a[4])*rr+a[5])*q /
           (((((b[0]*rr+b[1])*rr+b[2])*rr+b[3])*rr+b[4])*rr+1);
  }
  q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
          ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
}