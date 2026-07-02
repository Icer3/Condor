import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// In-memory cache: symbol -> { data, expiresAt }
const cache = new Map<string, { data: any; expiresAt: number }>();
const TTL_MS = 60_000; // 1 minute

// Stooq needs `.us` suffix for US tickers, `.de` for German, etc.
// We default to US for plain tickers; pass ?m=us to override.
function toStooqSymbol(raw: string): string {
  const s = raw.toLowerCase().trim();
  if (s.includes('.')) return s;
  return `${s}.us`;
}

async function fetchWithTimeout(url: string, ms = 8000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, {
      signal: ctl.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'text/csv,text/plain;q=0.9,*/*;q=0.5',
        'Accept-Language': 'en-US,en;q=0.5',
      },
    });
  } finally {
    clearTimeout(t);
  }
}

function parseStooqCsv(csv: string): { date: string; open: number; high: number; low: number; close: number; volume: number }[] {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const rows: any[] = [];
  // Skip header line.
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    if (cols.length < 6) continue;
    const [date, open, high, low, close, volume] = cols;
    const c = parseFloat(close);
    const o = parseFloat(open);
    const h = parseFloat(high);
    const l = parseFloat(low);
    const v = parseInt(volume, 10);
    if (!isFinite(c) || c <= 0) continue;
    rows.push({ date, open: o, high: h, low: l, close: c, volume: v });
  }
  return rows;
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await ctx.params;
  const sym = symbol.toUpperCase().trim();
  if (!sym) return NextResponse.json({ error: 'Missing symbol' }, { status: 400 });
  // Reject anything that can't plausibly be a ticker. Letters, digits, . - ^ = allowed.
  if (sym.length > 16 || !/^[A-Z0-9.\-^=]+$/.test(sym)) {
    return NextResponse.json({ error: `Invalid symbol: ${sym}` }, { status: 400 });
  }

  const now = Date.now();
  const cached = cache.get(sym);
  if (cached && cached.expiresAt > now) {
    return NextResponse.json({ ...cached.data, _cached: true, _source: cached.data._source });
  }

  // Try Yahoo's public chart endpoint first (often works for US tickers).
  let source: 'yahoo' | 'stooq' = 'stooq';
  let result:
    | { kind: 'yahoo'; data: any }
    | { kind: 'stooq'; data: ReturnType<typeof parseStooqCsv> }
    | null = null;
  let yahooErr: string | null = null;

  // 1) Yahoo direct — daily 1Y for realized vol / history / daily candles
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=1y&includePrePost=false`;
      const res = await fetchWithTimeout(url, 6000);
      if (res.ok) {
        const data: any = await res.json();
        const r = data?.chart?.result?.[0];
        if (r) { result = { kind: 'yahoo', data: r }; source = 'yahoo'; break; }
      }
      yahooErr = `yahoo ${res.status}`;
    } catch (e: any) {
      yahooErr = e?.message ?? 'yahoo failed';
    }
  }

  // 1b) Intraday 5m candles for TODAY — runs only when daily fetch succeeded
  //     (so we don't burn quota on a 503-prone Stooq fallback path).
  let intraday: { date: string; open: number; high: number; low: number; close: number; volume: number; ts: number }[] = [];
  if (result?.kind === 'yahoo') {
    try {
      const intradayUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=5m&range=1d&includePrePost=false`;
      const ir = await fetchWithTimeout(intradayUrl, 5000);
      if (ir.ok) {
        const idata: any = await ir.json();
        const ir0 = idata?.chart?.result?.[0];
        if (ir0) {
          const ts: number[] = ir0.timestamp ?? [];
          const opens: (number|null)[] = ir0.indicators?.quote?.[0]?.open ?? [];
          const highs: (number|null)[] = ir0.indicators?.quote?.[0]?.high ?? [];
          const lows:  (number|null)[] = ir0.indicators?.quote?.[0]?.low  ?? [];
          const closes:(number|null)[] = ir0.indicators?.quote?.[0]?.close ?? [];
          const vols:  (number|null)[] = ir0.indicators?.quote?.[0]?.volume ?? [];
          for (let i = 0; i < ts.length; i++) {
            const o = opens[i], h = highs[i], l = lows[i], c = closes[i];
            if (o == null || h == null || l == null || c == null) continue;
            const d = new Date(ts[i] * 1000);
            intraday.push({
              ts: ts[i] * 1000,
              date: d.toISOString().slice(0, 10),
              open: o, high: h, low: l, close: c,
              volume: (vols[i] ?? 0) as number,
            });
          }
        }
      }
    } catch {
      // Intraday is best-effort — daily data still works for everything else.
    }
  }

  // 2) Stooq fallback (always works, no auth).
  if (!result) {
    const stooqSym = toStooqSymbol(sym);
    const url = `https://stooq.com/q/d/l/?s=${stooqSym}&i=d`;
    const res = await fetchWithTimeout(url, 10000);
    if (!res.ok) {
      if (cached) return NextResponse.json({ ...cached.data, _cached: true, _stale: true, _source: cached.data._source });
      return NextResponse.json(
        { error: `both yahoo and stooq failed (yahoo: ${yahooErr}, stooq: ${res.status})`, symbol: sym },
        { status: 503 },
      );
    }
    const csv = await res.text();
    const rows = parseStooqCsv(csv);
    if (!rows.length) {
      if (cached) return NextResponse.json({ ...cached.data, _cached: true, _stale: true, _source: cached.data._source });
      return NextResponse.json({ error: `no data for ${sym} on stooq`, symbol: sym }, { status: 404 });
    }
    result = { kind: 'stooq', data: rows };
  }

  // Normalize output.
  let payload: any;
  if (result.kind === 'yahoo') {
    const r = result.data;
    const meta = r.meta ?? {};
    const closes: (number | null)[] = r.indicators?.quote?.[0]?.close ?? [];
    const opens: (number | null)[] = r.indicators?.quote?.[0]?.open ?? [];
    const highs: (number | null)[] = r.indicators?.quote?.[0]?.high ?? [];
    const lows: (number | null)[] = r.indicators?.quote?.[0]?.low ?? [];
    const volumes: (number | null)[] = r.indicators?.quote?.[0]?.volume ?? [];
    const timestamps: number[] = r.timestamp ?? [];
    const valid = closes.filter((v): v is number => v != null);
    const lastIdx = valid.length - 1;
    const price: number | null = meta.regularMarketPrice ?? (lastIdx >= 0 ? valid[lastIdx] : null);
    const prevClose = lastIdx >= 1 ? valid[lastIdx - 1] : null;
    const change = price != null && prevClose != null ? price - prevClose : null;
    const changePct = change != null && prevClose ? (change / prevClose) * 100 : null;
    let realizedVol: number | null = null;
    if (valid.length >= 5) {
      const rets: number[] = [];
      for (let i = 1; i < valid.length; i++) rets.push(Math.log(valid[i] / valid[i - 1]));
      const m = rets.reduce((a, b) => a + b, 0) / rets.length;
      realizedVol = Math.sqrt(rets.reduce((a, b) => a + (b - m) ** 2, 0) / (rets.length - 1)) * Math.sqrt(252);
    }
    const candleData: any[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      const o = opens[i], h = highs[i], l = lows[i], c = closes[i], v = volumes[i];
      if (o == null || h == null || l == null || c == null) continue;
      const d = new Date(timestamps[i] * 1000);
      candleData.push({
        date: d.toISOString().slice(0, 10),
        open: o, high: h, low: l, close: c, volume: v ?? 0,
      });
    }
    payload = {
      symbol: sym,
      price, change, changePct,
      dayHigh: meta.regularMarketDayHigh ?? null,
      dayLow: meta.regularMarketDayLow ?? null,
      yearHigh: meta.fiftyTwoWeekHigh ?? null,
      yearLow: meta.fiftyTwoWeekLow ?? null,
      volume: meta.regularMarketVolume ?? null,
      marketState: meta.marketState ?? null,
      currency: meta.currency ?? 'USD',
      shortName: meta.longName || meta.shortName || sym,
      history: valid.slice(-252),
      candles: candleData.slice(-60),
      intraday,
      realizedVol,
    };
  } else {
    const rows = result.data;
    const last = rows[rows.length - 1];
    const prev = rows.length > 1 ? rows[rows.length - 2] : null;
    const change = prev ? last.close - prev.close : null;
    const changePct = prev && prev.close ? ((last.close - prev.close) / prev.close) * 100 : null;
    const yearHigh = Math.max(...rows.map(r => r.high));
    const yearLow = Math.min(...rows.map(r => r.low));
    const closes = rows.map(r => r.close);
    let realizedVol: number | null = null;
    if (closes.length >= 5) {
      const rets: number[] = [];
      for (let i = 1; i < closes.length; i++) rets.push(Math.log(closes[i] / closes[i - 1]));
      const m = rets.reduce((a, b) => a + b, 0) / rets.length;
      realizedVol = Math.sqrt(rets.reduce((a, b) => a + (b - m) ** 2, 0) / (rets.length - 1)) * Math.sqrt(252);
    }
    const candleData = rows.map(r => ({
      date: r.date,
      open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume ?? 0,
    }));
    payload = {
      symbol: sym,
      price: last.close,
      change,
      changePct,
      dayHigh: last.high,
      dayLow: last.low,
      yearHigh, yearLow,
      volume: last.volume,
      marketState: 'CLOSED', // stooq is daily only, no live state
      currency: 'USD',
      shortName: sym,
      history: closes.slice(-252),
      candles: candleData.slice(-60),
      intraday: [], // stooq doesn't serve intraday; UI hides the chart if empty
      realizedVol,
    };
  }

  payload._source = source;
  cache.set(sym, { data: payload, expiresAt: now + TTL_MS });
  return NextResponse.json({ ...payload, _cached: false });
}