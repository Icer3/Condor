import { NextRequest, NextResponse } from 'next/server';
import { detectEarnings } from '@/lib/earnings';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const { candles } = body || {};
  if (!Array.isArray(candles)) return NextResponse.json({ error: 'candles must be array' }, { status: 400 });
  // Accept only {date, close} items.
  const slim = candles.map((c: any) => ({ date: c.date, close: c.close })).filter((c: any) => c.date && typeof c.close === 'number');
  return NextResponse.json({ earnings: detectEarnings(slim) });
}
