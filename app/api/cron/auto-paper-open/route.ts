// Auto-paper OPEN cron — runs after market close (16:00 ET → 21:00 UTC
// during EST, 20:00 UTC during EDT). For each ticker in AUTO_PAPER_WATCHLIST:
//   1. fetch quote + realized vol
//   2. compute IV rank (via /api/quote's history or a direct compute)
//   3. select a strategy using lib/autoPaper/strategySelector
//   4. insert a new pick row with the predicted fields
//
// Schedule is configured in vercel.json. Auth: Authorization: Bearer $CRON_SECRET
// (Vercel injects this automatically when configured).

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db/sqlite';
import {
  insertPick,
  insertRun,
  findOpenPickForTicker,
  generatePickId,
  PickRow,
} from '@/lib/db/autoPaperRepo';
import { computeIVEnvironment } from '@/lib/ivRank';
import { selectStrategyForRegime } from '@/lib/autoPaper/strategySelector';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Cron jobs can take a few seconds (one fetch per ticker). Allow up to 60s.
export const maxDuration = 60;

const DEFAULT_WATCHLIST = ['SPY', 'QQQ', 'IWM', 'AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMD', 'AMZN', 'META', 'GOOGL', 'JPM'];
const DEFAULT_DTE = 30;
const DEFAULT_MAX_OPEN = 12;
const DEFAULT_MAX_RISK_USD = 100_000; // cap total concurrent open risk across the watchlist
const NUM_PATHS = 4000; // cron budget — 4k paths is enough for ranking

function authorize(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  // If no CRON_SECRET is configured, allow in dev (so local `curl` works).
  if (!expected) return process.env.NODE_ENV !== 'production';
  const auth = req.headers.get('authorization') ?? '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  return token === expected;
}

async function fetchQuoteForCron(symbol: string): Promise<{
  price: number | null;
  history: number[];
  realizedVol: number | null;
} | null> {
  // Cron runs server-side, so we can call our own /api/quote/ endpoint.
  const base = process.env.NEXT_PUBLIC_APP_URL ?? process.env.VERCEL_URL ?? 'http://localhost:3000';
  const url = base.startsWith('http') ? base : `https://${base}`;
  try {
    const res = await fetch(`${url}/api/quote/${encodeURIComponent(symbol)}`, {
      headers: { 'user-agent': 'condor-cron/2.0' },
      // Cache: 'no-store' — cron should see fresh data each run.
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (typeof data.price !== 'number') return null;
    return {
      price: data.price,
      history: Array.isArray(data.history) ? data.history : [],
      realizedVol: typeof data.realizedVol === 'number' ? data.realizedVol : null,
    };
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  if (!authorize(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const t0 = Date.now();
  const watchlist = (process.env.AUTO_PAPER_WATCHLIST ?? DEFAULT_WATCHLIST.join(','))
    .split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  const dte = parseInt(process.env.AUTO_PAPER_DTE ?? '') || DEFAULT_DTE;
  const maxOpen = parseInt(process.env.AUTO_PAPER_MAX_OPEN ?? '') || DEFAULT_MAX_OPEN;
  const maxRisk = parseInt(process.env.AUTO_PAPER_MAX_RISK_USD ?? '') || DEFAULT_MAX_RISK_USD;

  const errors: { ticker: string; reason: string }[] = [];
  let picksOpened = 0;
  const openedSummaries: { ticker: string; strategy: string; ivRank: number }[] = [];

  let db: Awaited<ReturnType<typeof getDb>>;
  try {
    db = await getDb();
  } catch (e: any) {
    return NextResponse.json({ error: 'DB unavailable: ' + (e?.message ?? 'unknown') }, { status: 500 });
  }

  // Fetch all open picks once to enforce the global caps.
  const openPicks = db.prepare(`SELECT * FROM auto_paper_picks WHERE status = 'open'`).all() as PickRow[];
  const openRisk = openPicks.reduce((s, p) => s + Math.abs(p.predicted_maxloss ?? 0) * p.contracts, 0);

  for (const ticker of watchlist) {
    if (openPicks.length + picksOpened >= maxOpen) {
      errors.push({ ticker, reason: `max open reached (${maxOpen})` });
      break;
    }
    // Skip if we already have an open pick for this ticker.
    const existing = findOpenPickForTicker(db, ticker);
    if (existing) {
      // Not an error — just log it and move on.
      continue;
    }

    const quote = await fetchQuoteForCron(ticker);
    if (!quote?.price || !quote.history?.length || quote.realizedVol == null) {
      errors.push({ ticker, reason: 'quote fetch failed or insufficient history' });
      continue;
    }

    // IV rank needs at least 30 days of history (the computeIVEnvironment
    // function will fall back to absolute tier with shorter data).
    const ivEnv = computeIVEnvironment(quote.realizedVol, quote.history);

    let pick;
    try {
      pick = selectStrategyForRegime({
        ticker,
        S0: quote.price,
        sigma: quote.realizedVol,
        ivRank: ivEnv.rank,
        daysToExpiry: dte,
        numPaths: NUM_PATHS,
        seed: Math.floor(Date.now() / 1000),
      });
    } catch (e: any) {
      errors.push({ ticker, reason: 'selector failed: ' + (e?.message ?? 'unknown') });
      continue;
    }

    // Risk budget check (predicted max loss × contracts ≤ remaining budget).
    const maxLossTotal = Math.abs(pick.built.maxLoss ?? 0) * 1;
    if (openRisk + maxLossTotal > maxRisk) {
      errors.push({ ticker, reason: `risk budget exhausted ($${(openRisk + maxLossTotal).toFixed(0)} > $${maxRisk})` });
      continue;
    }

    const id = generatePickId();
    insertPick(db, {
      id,
      ticker,
      strategy_id: pick.strategyId,
      opened_at: new Date().toISOString(),
      spot_at_open: quote.price,
      sigma_at_open: quote.realizedVol,
      iv_rank_at_open: ivEnv.rank,
      dte,
      contracts: 1,
      predicted_pop: pick.mc.probProfit,
      predicted_pnl: pick.mc.expectedPnl * 100,        // per-share → per-contract
      predicted_maxloss: Math.abs(pick.built.maxLoss ?? 0),
      max_profit: pick.built.maxProfit ?? 0,
      legs_json: JSON.stringify(pick.built.legs),
      notes: pick.reasoning.join(' | '),
    });
    picksOpened++;
    openedSummaries.push({ ticker, strategy: pick.strategyName, ivRank: ivEnv.rank });
  }

  const duration = Date.now() - t0;
  insertRun(db, {
    id: `run_${Date.now().toString(36)}`,
    ran_at: new Date().toISOString(),
    kind: 'open',
    tickers_seen: watchlist.length,
    picks_opened: picksOpened,
    errors: errors.map(e => `${e.ticker}: ${e.reason}`),
    duration_ms: duration,
  });

  return NextResponse.json({
    ok: true,
    kind: 'open',
    watchlist: watchlist.length,
    picksOpened,
    opened: openedSummaries,
    errors,
    durationMs: duration,
  });
}

// POST alias for cron services that prefer POST. Same body, same auth.
export const POST = GET;