import { NextRequest, NextResponse } from 'next/server';
import { generateSmile, atmIvFromRealized } from '@/lib/volSmile';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const { spot, realizedVol, daysToExpiry = 30 } = body || {};
  if (typeof spot !== 'number' || spot <= 0) {
    return NextResponse.json({ error: 'spot must be a positive number' }, { status: 400 });
  }
  const atm = typeof realizedVol === 'number' && realizedVol > 0 ? atmIvFromRealized(realizedVol) : 0.30;
  const smile = generateSmile(spot, atm, daysToExpiry);
  return NextResponse.json({ smile, atmIv: atm });
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const spot = parseFloat(url.searchParams.get('spot') ?? '0');
  const rv = parseFloat(url.searchParams.get('rv') ?? '0');
  const dte = parseInt(url.searchParams.get('dte') ?? '30', 10);
  if (!spot) return NextResponse.json({ error: 'spot required' }, { status: 400 });
  const atm = rv > 0 ? atmIvFromRealized(rv) : 0.30;
  return NextResponse.json({ smile: generateSmile(spot, atm, dte), atmIv: atm });
}
