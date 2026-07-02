// Supabase-backed calibration route. Stores predicted-vs-realized rows in
// `paper_position_calibration`, keyed by (auth user, position_id). RLS scopes
// reads and writes to the user's own rows. Replaces the previous SQLite route.
//
// Resilience: if the Postgres tables haven't been created yet (e.g. the user
// pulled the new code but didn't run supabase/migrations/*.sql in their
// Supabase project yet), Supabase returns a PostgresError code 42P01
// (`undefined_table`). We catch that for GET → return empty rows so the
// dashboard renders the "no closes yet" empty state. For write operations we
// return a 503 with a clear message in the console + response body so the
// dev sees it next deploy.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import * as calibrationRepo from '@/lib/db/supabase/calibrationRepo';
import { summarize, emptySummary } from '@/lib/calibration/summary';

export const runtime = 'nodejs';

async function requireUserId(): Promise<string | null> {
  const db = await getServerSupabase();
  const { data } = await db.auth.getUser();
  return data.user?.id ?? null;
}

/** True if the error looks like a missing table / not-yet-migrated schema. */
function isMissingTable(err: any): boolean {
  const code = err?.code ?? err?.cause?.code ?? '';
  const msg = String(err?.message ?? '');
  return (
    code === '42P01' ||           // Postgres: undefined_table
    code === 'PGRST116' ||        // PostgREST: schema cache not found
    /relation .* does not exist/i.test(msg) ||
    /schema cache/i.test(msg) ||
    /does not exist in schema/i.test(msg)
  );
}

export async function GET(req: NextRequest) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  try {
    const db = await getServerSupabase();
    const rows = await calibrationRepo.readAll(db, userId);
    const summary = rows.length === 0 ? emptySummary() : summarize(rows);
    return NextResponse.json({ rows, summary });
  } catch (e: any) {
    if (isMissingTable(e)) {
      console.warn('[calibration] tables missing — run supabase/migrations/*.sql:', e?.message);
      return NextResponse.json({
        rows: [],
        summary: emptySummary(),
        scope: 'authenticated',
        pending: 'run-supabase-migrations',
        hint: 'apply supabase/migrations/001_paper_positions.sql and 002_calibration.sql in your Supabase SQL editor',
      });
    }
    console.error('[calibration] GET failed:', e);
    return NextResponse.json({ error: String(e?.message ?? 'fetch failed') }, { status: 500 });
  }
}

interface PostBody {
  action: 'open' | 'close';
  position_id: string;
  strategy_id: string;
  ticker: string;
  // Open-time fields (optional on close)
  opened_at?: string;
  predicted_pop?: number;
  predicted_pnl?: number;
  predicted_maxloss?: number;
  max_profit?: number;
  sigma_at_entry?: number;
  // Close-time fields (optional on open)
  realized_pnl?: number;
  closed_at?: string;
  close_reason?: string;
}

export async function POST(req: NextRequest) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  let body: PostBody;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }

  if (!body.position_id || !body.strategy_id || !body.ticker || !body.action) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  try {
    const db = await getServerSupabase();
    if (body.action === 'open') {
      await calibrationRepo.upsertPrediction(db, userId, {
        position_id: body.position_id,
        strategy_id: body.strategy_id,
        ticker: body.ticker,
        opened_at: body.opened_at ?? new Date().toISOString(),
        predicted_pop: body.predicted_pop,
        predicted_pnl: body.predicted_pnl,
        predicted_maxloss: body.predicted_maxloss,
        max_profit: body.max_profit,
        sigma_at_entry: body.sigma_at_entry,
      });
      return NextResponse.json({ ok: true, action: 'open', scope: 'authenticated' });
    }
    if (body.action === 'close') {
      if (body.realized_pnl == null || !body.closed_at) {
        return NextResponse.json({ error: 'close requires realized_pnl + closed_at' }, { status: 400 });
      }
      await calibrationRepo.recordClose(db, userId, {
        position_id: body.position_id,
        realized_pnl: body.realized_pnl,
        closed_at: body.closed_at,
        close_reason: body.close_reason ?? null,
      });
      return NextResponse.json({ ok: true, action: 'close', scope: 'authenticated' });
    }
    return NextResponse.json({ error: `Unknown action: ${body.action}` }, { status: 400 });
  } catch (e: any) {
    if (isMissingTable(e)) {
      console.warn('[calibration] tables missing on POST — running locally:', e?.message);
      return NextResponse.json({
        ok: false,
        scope: 'authenticated',
        pending: 'run-supabase-migrations',
        hint: 'apply supabase/migrations/001_paper_positions.sql and 002_calibration.sql in your Supabase SQL editor',
      }, { status: 503 });
    }
    console.error('[calibration] POST failed:', e);
    return NextResponse.json({ error: String(e?.message ?? 'write failed') }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  try {
    const db = await getServerSupabase();
    const removed = await calibrationRepo.purgeDevice(db, userId);
    return NextResponse.json({ ok: true, removed });
  } catch (e: any) {
    if (isMissingTable(e)) {
      return NextResponse.json({ ok: true, removed: 0, pending: 'run-supabase-migrations' });
    }
    console.error('[calibration] DELETE failed:', e);
    return NextResponse.json({ error: String(e?.message ?? 'purge failed') }, { status: 500 });
  }
}
