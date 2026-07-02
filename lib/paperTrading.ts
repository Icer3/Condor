// Paper trading engine — localStorage-backed position store.
// Mark-to-market uses Black-Scholes on live quotes.

'use client';

import { Leg, StrategyId } from './strategies';
import { blackScholes } from './blackScholes';

export interface PaperPosition {
  id: string;
  strategyId: StrategyId;
  /** @deprecated Look up from STRATEGIES instead. Kept optional for backwards-compat with positions saved under the old schema. */
  strategyName?: string;
  /** @deprecated Same as strategyName. */
  emoji?: string;
  ticker: string;
  legs: Leg[];
  entryPerContract: number;  // negative = debit, positive = credit
  quantity: number;          // # of contracts
  openedAt: string;
  status: 'open' | 'closed';
  closedAt?: string;
  closePerContract?: number;
  closeSpot?: number;
  closeReason?: string;
  // Snapshot of opening conditions for context.
  spotAtEntry: number;
  dteAtEntry: number;
  /**
   * Implied-or-realized annualized vol at open time. Used as the σ fallback
   * for MTM/close computation when the live quote's realizedVol is missing,
   * so calibration is comparable across the life of the position.
   */
  sigmaAtEntry?: number;
  notes?: string;
}

const STORAGE_KEY = 'condor.paper.positions.v1';
const DEVICE_KEY = 'condor.device.id';

/** Optional calibration context — populated when a position is opened from
 *  /trade so we can later compare the model's prediction to the realized outcome. */
export interface PositionCalibrationContext {
  predicted_pop?: number;     // sim.mc.probProfit (0..1)
  predicted_pnl?: number;     // $/contract expected terminal
  predicted_maxloss?: number; // $/contract (positive number)
  max_profit?: number;        // $/contract (positive number)
}

/**
 * Fire-and-forget POST to /api/calibration. The server now requires auth
 * (RLS scopes rows to auth.uid()). For anonymous clients this silently no-ops —
 * local positions still save locally; only the predicted-vs-realized dataset
 * skips the server write. Best-effort; never throws.
 */
async function pushCalibrationOpen(p: PaperPosition) {
  if (typeof window === 'undefined') return;
  const ctx = (p as PaperPosition & { _cal?: PositionCalibrationContext })._cal;
  if (!ctx) return;
  try {
    const res = await fetch('/api/calibration', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'open',
        position_id: p.id,
        strategy_id: p.strategyId,
        ticker: p.ticker,
        opened_at: p.openedAt,
        predicted_pop: ctx.predicted_pop,
        predicted_pnl: ctx.predicted_pnl,
        predicted_maxloss: ctx.predicted_maxloss,
        max_profit: ctx.max_profit,
        sigma_at_entry: p.sigmaAtEntry ?? null,
      }),
    });
    if (res.status === 401) return; // anonymous — local-only is fine
    if (!res.ok) console.warn('[calibration] open non-2xx:', res.status);
  } catch (e) {
    console.warn('[calibration] open write failed:', e);
  }
}

async function pushCalibrationClose(p: PaperPosition, realized: number, reason: string) {
  if (typeof window === 'undefined') return;
  try {
    const res = await fetch('/api/calibration', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'close',
        position_id: p.id,
        strategy_id: p.strategyId,
        ticker: p.ticker,
        realized_pnl: realized,
        closed_at: p.closedAt ?? new Date().toISOString(),
        close_reason: reason,
      }),
    });
    if (res.status === 401) return;
    if (!res.ok) console.warn('[calibration] close non-2xx:', res.status);
  } catch (e) {
    console.warn('[calibration] close write failed:', e);
  }
}

export function getDeviceId(): string {
  if (typeof window === 'undefined') return '';
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = 'dev_' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36).slice(-4);
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

export async function loadPositionsServer(): Promise<PaperPosition[] | null> {
  if (typeof window === 'undefined') return null;
  try {
    const res = await fetch('/api/positions', { headers: { 'X-Device-Id': getDeviceId() } });
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data.positions) ? (data.positions as PaperPosition[]) : [];
  } catch { return null; }
}

export async function savePositionsServer(positions: PaperPosition[]): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  try {
    const res = await fetch('/api/positions', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Device-Id': getDeviceId() },
      body: JSON.stringify({ positions }),
    });
    return res.ok;
  } catch { return false; }
}

export function loadPositions(): PaperPosition[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function savePositions(positions: PaperPosition[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(positions));
}

export function addPosition(p: PaperPosition, calibration?: PositionCalibrationContext) {
  const all = loadPositions();
  all.unshift(p);
  savePositions(all);
  // Side-effect: push the calibration context separately (it's a sibling write,
  // not part of the canonical PaperPosition schema).
  if (calibration) {
    pushCalibrationOpen({
      ...p,
      // Attach transient-only — passed to the helper but never persisted.
      ...({ _cal: calibration } as unknown as PaperPosition),
    } as PaperPosition);
  }
  return all;
}

export function closePosition(id: string, closePerContract: number, reason: string, closeSpot?: number) {
  const all = loadPositions();
  const idx = all.findIndex(p => p.id === id);
  if (idx < 0) return all;
  const updated: PaperPosition = {
    ...all[idx],
    status: 'closed',
    closedAt: new Date().toISOString(),
    closePerContract,
    closeSpot,
    closeReason: reason,
  };
  all[idx] = updated;
  savePositions(all);
  const realized = realizedPnL(updated);
  pushCalibrationClose(updated, realized, reason);
  return all;
}

export function deletePosition(id: string) {
  const all = loadPositions().filter(p => p.id !== id);
  savePositions(all);
  return all;
}

/**
 * Mark-to-market value in **dollars per contract** (leg prices are per-share, so ×100 at the end).
 *
 * `T` MUST be in YEARS (e.g. 30/365 for 30 DTE) — this is the standard convention
 * for Black-Scholes inputs across the codebase. At T<=0 the function falls through
 * to intrinsic value via Black-Scholes' own T<=0 branch, so an option leg at
 * expiry is valued at max(S-K, 0) / max(K-S, 0), NOT silently skipped.
 */
export function mtmPerContract(legs: Leg[], spot: number, sigma: number, r: number, T: number): number {
  let total = 0;
  for (const leg of legs) {
    if (leg.kind === 'stock') {
      total += leg.side === 'long' ? spot - leg.entryPrice : leg.entryPrice - spot;
      continue;
    }
    if (leg.strike == null) continue;
    const g = blackScholes({ S: spot, K: leg.strike, T, r, sigma });
    const value = leg.kind === 'call' ? g.call : g.put;
    total += leg.side === 'long' ? value : -value;
  }
  return total * 100;
}

/** Realized P/L for a closed position (per contract × quantity). */
export function realizedPnL(p: PaperPosition): number {
  if (p.status !== 'closed' || p.closePerContract == null) return 0;
  // entryPerContract and closePerContract are signed cash flows in $/contract:
  //   entry: + = credit (received), - = debit (paid)
  //   close: + = received on close, - = paid on close
  // Total PnL = (entry + close) × quantity.
  // Verified parity against the close modal: both use mtmPerContract with T
  // in YEARS so the ~history P/L matches what the modal showed at confirm time.
  return (p.closePerContract + p.entryPerContract) * p.quantity;
}

/** Current (open) P/L based on live MTM. sigma: live realizedVol preferred, else σ_at_open, else 0.30. */
export function unrealizedPnL(p: PaperPosition, currentSpot: number, sigma: number, r: number, remainingDays: number): number {
  if (p.status !== 'open') return 0;
  const T = Math.max(0.0001, remainingDays / 365);
  const mtm = mtmPerContract(p.legs, currentSpot, sigma, r, T);
  // mtm is the net value of the position in $/contract (positive = asset, negative = liability).
  // Closing cash flow = mtm (sell asset for +mtm, pay |mtm| to buy back liability).
  // Total PnL = (entry + mtm) × quantity.
  return (mtm + p.entryPerContract) * p.quantity;
}

/**
 * Resolve the σ to use for MTM given the live quote and the opening snapshot.
 * Priority: live realizedVol from quote → σ_at_open snapshot (saved with the
 * position) → 0.30 last-ditch fallback. This guarantees the calibration row
 * uses the SAME σ model the user saw at open time unless a fresher live σ
 * is available.
 */
export function resolveSigma(
  position: PaperPosition,
  quoteSigma: number | null | undefined,
): number {
  if (typeof quoteSigma === 'number' && quoteSigma > 0) return quoteSigma;
  if (typeof position.sigmaAtEntry === 'number' && position.sigmaAtEntry > 0) return position.sigmaAtEntry;
  return 0.30;
}

export function positionSummary(positions: PaperPosition[]) {
  const open = positions.filter(p => p.status === 'open');
  const closed = positions.filter(p => p.status === 'closed');
  const realized = closed.reduce((s, p) => s + realizedPnL(p), 0);
  const numWins = closed.filter(p => realizedPnL(p) > 0).length;
  return {
    total: positions.length,
    openCount: open.length,
    closedCount: closed.length,
    realized,
    unrealized: 0, // filled by caller once MTM is computed
    winRate: closed.length ? numWins / closed.length : 0,
    avgHoldDays: closed.length
      ? closed.reduce((s, p) => s + (new Date(p.closedAt!).getTime() - new Date(p.openedAt).getTime()) / 86_400_000, 0) / closed.length
      : 0,
  };
}

export function generateId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}