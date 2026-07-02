// Mark-to-market for an auto-paper pick. Pure function — the caller supplies
// the legs (snapshotted at open), the live spot, sigma, and the remaining DTE.
//
// Convention matches lib/paperTrading.ts:
//   entry: + = credit received, - = debit paid (per contract)
//   mtm:   signed $/contract value of the position at the current spot
//   total unrealized: (entry + mtm) × contracts
//
// We keep this separate from paperTrading.ts so the cron path doesn't depend
// on browser-only state (localStorage, device id, etc.).

import { Leg } from '@/lib/strategies';
import { blackScholes } from '@/lib/blackScholes';

export interface MtmInput {
  legs: Leg[];
  spot: number;
  sigma: number;       // annualized realized vol
  r: number;           // risk-free rate (decimal)
  remainingDays: number;
  contracts: number;
  entryPerContract: number; // signed $/contract (positive = credit)
}

export interface MtmResult {
  mtmPerContract: number;       // signed $/contract value of position at spot
  unrealizedPnl: number;        // total $ across contracts (= (entry + mtm) × contracts)
  remainingDte: number;
  greeks: {
    delta: number;              // net delta × contracts
    theta: number;              // net theta/day × contracts
    vega: number;               // net vega (per 1% IV) × contracts
  };
}

export function markToMarket(input: MtmInput): MtmResult {
  const T = Math.max(0.0001, input.remainingDays / 365);
  let mtm = 0;
  let delta = 0, theta = 0, vega = 0;

  for (const leg of input.legs) {
    if (leg.kind === 'stock') {
      // Stock leg: signed (current − entry) × side
      mtm += leg.side === 'long' ? (input.spot - leg.entryPrice) : (leg.entryPrice - input.spot);
      delta += leg.side === 'long' ? 1 : -1;
      continue;
    }
    if (leg.strike == null || T <= 0) continue;
    const g = blackScholes({ S: input.spot, K: leg.strike, T, r: input.r, sigma: input.sigma });
    const value = leg.kind === 'call' ? g.call : g.put;
    const sign = leg.side === 'long' ? 1 : -1;
    mtm += sign * value;
    const d = leg.kind === 'call' ? g.deltaCall : g.deltaPut;
    const th = leg.kind === 'call' ? g.thetaCall : g.thetaPut;
    delta += sign * d;
    theta += sign * th;
    vega += sign * (g.vega / 100);
  }

  const mtmPerContract = mtm * 100; // legs are per-share; one contract = 100 shares
  const unrealizedPnl = (mtmPerContract + input.entryPerContract) * input.contracts;

  return {
    mtmPerContract,
    unrealizedPnl,
    remainingDte: input.remainingDays,
    greeks: {
      delta: delta * 100 * input.contracts,
      theta: theta * 100 * input.contracts,
      vega: vega * 100 * input.contracts,
    },
  };
}

/** Days remaining between now and a fixed open date + dte. */
export function remainingDte(openedAt: string, dteAtOpen: number, now = Date.now()): number {
  const elapsedDays = Math.max(0, (now - new Date(openedAt).getTime()) / 86_400_000);
  return Math.max(0, dteAtOpen - elapsedDays);
}