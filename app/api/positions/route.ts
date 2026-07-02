// Server-side paper-position store. Per-user scoped via Supabase auth. The
// server is the source of truth — the browser keeps a localStorage cache for
// instant render, but every mutation syncs to Supabase. RLS scopes all reads
// and writes to the authenticated user's own row.
//
// Resilience: same missing-table handling as /api/calibration. If the user
// hasn't run supabase/migrations/001_paper_positions.sql yet, GET returns [],
// PUT is best-effort 503. The 500 you saw before this fix was Postgres
// returning 42P01 — caught here.

import { NextRequest, NextResponse } from 'next/server';
import { PaperPosition } from '@/lib/paperTrading';
import { getServerSupabase } from '@/lib/supabase/server';
import * as positionsRepo from '@/lib/db/supabase/positionsRepo';

export const runtime = 'nodejs';

function isMissingTable(err: any): boolean {
  const code = err?.code ?? err?.cause?.code ?? '';
  const msg = String(err?.message ?? '');
  return (
    code === '42P01' ||
    code === 'PGRST116' ||
    /relation .* does not exist/i.test(msg) ||
    /schema cache/i.test(msg)
  );
}

async function requireUserId(): Promise<string | null> {
  const db = await getServerSupabase();
  const { data } = await db.auth.getUser();
  return data.user?.id ?? null;
}

export async function GET(req: NextRequest) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  try {
    const positions = await positionsRepo.loadPositions(await getServerSupabase(), userId);
    return NextResponse.json({ positions, scope: 'authenticated' });
  } catch (e: any) {
    if (isMissingTable(e)) {
      console.warn('[positions] table missing — returning []:', e?.message);
      return NextResponse.json({
        positions: [],
        scope: 'authenticated',
        pending: 'run-supabase-migrations',
        hint: 'apply supabase/migrations/001_paper_positions.sql in your Supabase SQL editor',
      });
    }
    console.error('[positions] GET failed:', e);
    return NextResponse.json({ error: String(e?.message ?? 'fetch failed') }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  if (!Array.isArray(body?.positions)) {
    return NextResponse.json({ error: 'Body must be { positions: PaperPosition[] }' }, { status: 400 });
  }
  try {
    await positionsRepo.savePositions(await getServerSupabase(), userId, body.positions as PaperPosition[]);
    return NextResponse.json({ ok: true, count: body.positions.length });
  } catch (e: any) {
    if (isMissingTable(e)) {
      return NextResponse.json({
        ok: false,
        pending: 'run-supabase-migrations',
        hint: 'apply supabase/migrations/001_paper_positions.sql in your Supabase SQL editor',
      }, { status: 503 });
    }
    console.error('[positions] PUT failed:', e);
    return NextResponse.json({ error: String(e?.message ?? 'save failed') }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  try {
    await positionsRepo.deletePositions(await getServerSupabase(), userId);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    if (isMissingTable(e)) {
      return NextResponse.json({ ok: true, pending: 'run-supabase-migrations' });
    }
    console.error('[positions] DELETE failed:', e);
    return NextResponse.json({ error: String(e?.message ?? 'delete failed') }, { status: 500 });
  }
}
