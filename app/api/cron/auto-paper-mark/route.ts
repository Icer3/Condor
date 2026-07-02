// Auto-paper MARK cron — runs ~30min after open (16:30 ET). For each open
// pick: fetch current spot, compute MTM via lib/autoPaper/markToMarket,
// insert a row into auto_paper_marks. Also handles auto-closing picks that
// hit profit target (≥ 50% of credit) or stop loss (≥ 2× debit).
//
// Schedule is configured in vercel.json.

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db/sqlite';
import {
  insertMark,
  insertRun,
  closePick,
  listOpenPicks,
  generatePickId,
  PickRow,
} from '@/lib/db/autoPaperRepo';
import { markToMarket, remainingDte } from '@/lib/autoPaper/markToMarket';
import { Leg } from '@/lib/strategies';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const PROFIT_TARGET_FRACTION = 0.50;  // close when realized ≥ 50% of credit / -50% of debit
const STOP_LOSS_FRACTION = 2.0;       // close when loss ≥ 2× the entry debit (or 2× max loss on credits)
const R = 0.045;

function authorize(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return process.env.NODE_ENV !== 'production';
  const auth = req.headers.get('authorization') ?? '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  return token === expected;
}

async function fetchQuoteForCron(symbol: string): Promise<{ price: number; realizedVol: number | null } | null> {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? process.env.VERCEL_URL ?? 'http://localhost:3000';
  const url = base.startsWith('http') ? base : `https://${base}`;
  try {
    const res = await fetch(`${url}/api/quote/${encodeURIComponent(symbol)}`, {
      headers: { 'user-agent': 'condor-cron/2.0' },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (typeof data.price !== 'number') return null;
    return { price: data.price, realizedVol: typeof data.realizedVol === 'number' ? data.realizedVol : null };
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  if (!authorize(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const t0 = Date.now();
  let picksMarked = 0;
  let picksClosed = 0;
  const errors: string[] = [];

  let db: Awaited<ReturnType<typeof getDb>>;
  try {
    db = await getDb();
  } catch (e: any) {
    return NextResponse.json({ error: 'DB unavailable: ' + (e?.message ?? 'unknown') }, { status: 500 });
  }

  const openPicks = listOpenPicks(db);

  for (const pick of openPicks) {
    try {
      const quote = await fetchQuoteForCron(pick.ticker);
      if (!quote) {
        errors.push(`${pick.ticker}: quote fetch failed`);
        continue;
      }

      const sigma = quote.realizedVol ?? pick.sigma_at_open;
      const remDays = remainingDte(pick.opened_at, pick.dte);
      const legs: Leg[] = JSON.parse(pick.legs_json);
      // entryPerContract: signed cash flow at open. long pays (-), short receives (+).
      const entryPerContract = legs.reduce((s, l) => {
        const sign = l.side === 'long' ? -1 : +1;
        return s + sign * l.entryPrice * 100;
      }, 0);
      const mtm = markToMarket({
        legs,
        spot: quote.price,
        sigma,
        r: R,
        remainingDays: remDays,
        contracts: pick.contracts,
        entryPerContract,
      });

      const nowIso = new Date().toISOString();

      // Auto-close rules
      let closeReason: string | null = null;
      // For credits (entry > 0):
      //   profit target: mtm has decayed to ≤ 50% of credit (buy back for half what we sold)
      //   stop loss: |mtm| ≥ 2× predicted_maxloss (tested through a wing, bleeding fast)
      // For debits (entry < 0):
      //   profit target: mtm ≥ 50% of |debit| (worth 1.5× what we paid)
      //   stop loss: mtm ≤ -2× |debit| (worth 1/3 of what we paid — or zero on a max-loss strategy)
      const debit = Math.abs(entryPerContract);
      if (entryPerContract >= 0) {
        if (mtm.mtmPerContract <= entryPerContract * (1 - PROFIT_TARGET_FRACTION)) {
          closeReason = 'profit_target';
        } else if (mtm.mtmPerContract < -Math.abs(pick.predicted_maxloss) * STOP_LOSS_FRACTION) {
          closeReason = 'stop_loss';
        }
      } else {
        if (mtm.mtmPerContract >= debit * PROFIT_TARGET_FRACTION) {
          closeReason = 'profit_target';
        } else if (mtm.mtmPerContract <= -debit * STOP_LOSS_FRACTION) {
          closeReason = 'stop_loss';
        }
      }
      // Expiry handling: at 0 DTE, the position is essentially worthless or full payout.
      if (remDays <= 0.5 && !closeReason) {
        closeReason = 'expiry';
      }

      // Always insert a mark so we have the daily trail.
      insertMark(db, {
        id: generatePickId(),
        pick_id: pick.id,
        marked_at: nowIso,
        spot: quote.price,
        sigma,
        remaining_dte: remDays,
        mtm_per_contract: mtm.mtmPerContract,
        unrealized_pnl: mtm.unrealizedPnl,
      });
      picksMarked++;

      // Close out if a rule fired.
      if (closeReason) {
        closePick(db, {
          id: pick.id,
          closed_at: nowIso,
          close_spot: quote.price,
          close_per_contract: mtm.mtmPerContract,
          realized_pnl: mtm.unrealizedPnl,
          close_reason: closeReason,
        });
        picksClosed++;
      }
    } catch (e: any) {
      errors.push(`${pick.ticker}: ${e?.message ?? 'unknown'}`);
    }
  }

  const duration = Date.now() - t0;
  insertRun(db, {
    id: `run_${Date.now().toString(36)}`,
    ran_at: new Date().toISOString(),
    kind: 'mark',
    tickers_seen: openPicks.length,
    picks_marked: picksMarked,
    picks_closed: picksClosed,
    errors,
    duration_ms: duration,
  });

  return NextResponse.json({
    ok: true,
    kind: 'mark',
    openPicksScanned: openPicks.length,
    picksMarked,
    picksClosed,
    errors,
    durationMs: duration,
  });
}

export const POST = GET;