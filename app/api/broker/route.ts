// IBKR-style broker integration stub.
//
// Real IBKR integration requires:
//   1. IBKR Client Portal API gateway (https://www.interactivebrokers.com/api)
//   2. OAuth session via /v1/api/oauth2/request_token
//   3. Live tickle every ~60s to keep session alive
//   4. Webhook for order status updates
//
// This scaffold implements the credential exchange + paper-trade flow.
// Set env vars BROKER_CLIENT_ID + BROKER_REDIRECT_URI to enable; without them it runs in stub mode.

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

interface BrokerSession {
  sessionId: string;
  accountId: string;
  createdAt: string;
  expiresAt: string;
  mode: 'live' | 'stub';
}

const SESSIONS = new Map<string, BrokerSession>();

function makeSessionId() {
  return 'brk_' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36).slice(-4);
}

const REDIRECT_URI = process.env.BROKER_REDIRECT_URI ?? '';
const CLIENT_ID = process.env.BROKER_CLIENT_ID ?? '';

function stubbed(): boolean { return !CLIENT_ID || !REDIRECT_URI; }

// POST /api/broker  { action: 'connect' } → returns session + auth URL
export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const { action, sessionId } = body || {};

  if (action === 'connect') {
    if (stubbed()) {
      const id = makeSessionId();
      const session: BrokerSession = {
        sessionId: id, accountId: 'DU1234567', mode: 'stub', createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
      };
      SESSIONS.set(id, session);
      return NextResponse.json({
        mode: 'stub',
        session,
        authUrl: '/api/broker/callback?sessionId=' + id,
        notice: 'BROKER_CLIENT_ID not set — running in stub mode. Set env vars to enable real IBKR OAuth.',
      });
    }
    // Real mode: redirect to IBKR auth endpoint.
    const state = Math.random().toString(36).slice(2, 18);
    const url = new URL('https://api.ibkr.com/v1/api/oauth2/request_token');
    url.searchParams.set('client_id', CLIENT_ID);
    url.searchParams.set('redirect_uri', REDIRECT_URI);
    url.searchParams.set('state', state);
    return NextResponse.json({ mode: 'live', authUrl: url.toString(), state });
  }

  if (action === 'submit-order') {
    if (!sessionId || !SESSIONS.has(sessionId)) return NextResponse.json({ error: 'No session' }, { status: 400 });
    const sess = SESSIONS.get(sessionId)!;
    if (sess.mode === 'stub') {
      const orderId = 'stub_' + Math.random().toString(36).slice(2, 10);
      return NextResponse.json({ ok: true, mode: 'stub', orderId, sessionId, message: 'Stub order accepted (no real execution)' });
    }
    return NextResponse.json({ ok: false, error: 'Live broker submission not configured' }, { status: 501 });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const ticker = url.searchParams.get('ticker');
  if (!ticker) return NextResponse.json({ error: 'ticker required' }, { status: 400 });
  // Real IBKR integration would call /v1/api/iserver/secdef/search?symbol=AAPL.
  // Stub: return a deterministic option chain.
  const S = 100 + ticker.charCodeAt(0);
  const strikes = Array.from({ length: 11 }, (_, i) => Math.round(S - 10 + i * 2));
  return NextResponse.json({
    mode: stubbed() ? 'stub' : 'live',
    ticker,
    underlying: { price: S },
    expirations: [7, 14, 30, 60, 90].map(d => ({ dte: d, lastTrade: new Date(Date.now() + d * 86400000).toISOString().slice(0, 10) })),
    chain: strikes.map(K => ({ strike: K, call: { bid: 0, ask: 0, mid: Math.max(0.05, Math.abs(S - K) * 0.04) }, put: { bid: 0, ask: 0, mid: Math.max(0.05, Math.abs(S - K) * 0.04) } })),
    notice: stubbed() ? 'Stub mode. Set BROKER_CLIENT_ID to enable live data.' : 'Live mode.',
  });
}

export async function DELETE(req: NextRequest) {
  const url = new URL(req.url);
  const id = url.searchParams.get('sessionId');
  if (id) SESSIONS.delete(id);
  return NextResponse.json({ ok: true });
}
