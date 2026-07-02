// Synthetic option chain: rows = strikes, cols = expiry (DTE), cells = mid price or IV.
// Real implementation needs a chain feed; this version uses the parametric smile.

import { NextRequest, NextResponse } from 'next/server';
import { generateSmile, atmIvFromRealized } from '@/lib/volSmile';
import { blackScholes } from '@/lib/blackScholes';

export const runtime = 'nodejs';

interface ChainCell {
  strike: number;
  dte: number;
  moneyness: number;
  iv: number;
  callPrice: number;
  putPrice: number;
  callDelta: number;
  putDelta: number;
}

interface ChainGrid {
  spot: number;
  dtes: number[];
  cells: ChainCell[];
  minIv: number;
  maxIv: number;
  minPrice: number;
  maxPrice: number;
  atmIv: number;
}

export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const { spot, realizedVol, dtes = [7, 14, 30, 45, 60, 90], r = 0.045, strikesAround = 12, strikeStep = 5 } = body || {};
  if (typeof spot !== 'number' || spot <= 0) {
    return NextResponse.json({ error: 'spot required' }, { status: 400 });
  }
  const atm = typeof realizedVol === 'number' && realizedVol > 0 ? atmIvFromRealized(realizedVol) : 0.30;
  const cells: ChainCell[] = [];
  let minIv = Infinity, maxIv = -Infinity, minPrice = Infinity, maxPrice = -Infinity;

  const step = spot > 500 ? 5 : spot > 100 ? strikeStep : 1;
  const center = Math.round(spot / step) * step;
  const strikes: number[] = [];
  for (let i = -strikesAround; i <= strikesAround; i++) strikes.push(center + i * step);

  for (const dte of dtes) {
    const smile = generateSmile(spot, atm, dte);
    for (const p of smile.points) {
      const K = Math.round(p.strike / step) * step;
      if (!strikes.includes(K)) continue;
      const m = Math.log(K / spot);
      const iv = atm * (1 + smile.skewPct * Math.sqrt(dte / 30) * m + 5 * m * m);
      const T = dte / 365;
      const g = blackScholes({ S: spot, K, T, r, sigma: iv });
      cells.push({
        strike: K, dte, moneyness: m, iv,
        callPrice: g.call, putPrice: g.put,
        callDelta: g.deltaCall, putDelta: g.deltaPut,
      });
      if (iv < minIv) minIv = iv;
      if (iv > maxIv) maxIv = iv;
      if (g.call < minPrice) minPrice = g.call;
      if (g.call > maxPrice) maxPrice = g.call;
      if (g.put < minPrice) minPrice = g.put;
      if (g.put > maxPrice) maxPrice = g.put;
    }
  }
  const grid: ChainGrid = { spot, dtes, cells, minIv, maxIv, minPrice, maxPrice, atmIv: atm };
  return NextResponse.json({ chain: grid });
}
