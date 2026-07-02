// Trade journal generator — produces structured markdown from position data.
// Template-based (LLM-ready: if OPENAI_API_KEY or similar is in env, the route
// could be swapped for a live call without changing the response shape).

import { NextRequest, NextResponse } from 'next/server';
import { PaperPosition } from '@/lib/paperTrading';

export const runtime = 'nodejs';

interface JournalEntry {
  id: string;
  ticker: string;
  strategyId: string;
  openedAt: string;
  closedAt?: string;
  status: 'open' | 'closed';
  durationDays: number;
  entryPrice: number;
  dteAtEntry: number;
  legsSummary: string;
  entryPerContract: number;
  quantity: number;
  spotAtEntry: number;
  closePerContract?: number;
  closeReason?: string;
  realizedPnL?: number;
  realizedPnLPct?: number;
  markdown: string;
}

function summarizeLegs(legs: PaperPosition['legs']): string {
  return legs.map(l => {
    if (l.kind === 'stock') return `${l.side === 'long' ? 'long' : 'short'} stock @$${l.entryPrice.toFixed(2)}`;
    return `${l.side === 'long' ? 'long' : 'short'} ${l.kind} $${l.strike?.toFixed(0)} @$${l.entryPrice.toFixed(2)}`;
  }).join(' · ');
}

function durationDays(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
}

function fmtDate(iso?: string): string {
  return iso ? new Date(iso).toISOString().slice(0, 10) : '—';
}

function generateMarkdown(p: PaperPosition): string {
  const closed = p.status === 'closed';
  const dOpen = fmtDate(p.openedAt);
  const dClose = fmtDate(p.closedAt);
  const dur = closed ? durationDays(p.openedAt, p.closedAt!) : Math.round((Date.now() - new Date(p.openedAt).getTime()) / 86400000);
  const pnl = closed ? (p.closePerContract! + p.entryPerContract) * p.quantity : null;
  const pnlPct = pnl != null ? (pnl / (Math.abs(p.entryPerContract) * p.quantity)) * 100 : null;
  const win = pnl != null && pnl > 0;
  const durState = closed ? (win ? `closed at +${dur}d for a +${pnlPct!.toFixed(1)}% gain` : `closed at ${dur}d for a ${pnlPct!.toFixed(1)}% loss`)
                       : `still open after ${dur}d`;

  return [
    `# ${p.ticker} — ${p.strategyId.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}`,
    ``,
    `**Opened:** ${dOpen}  `,
    `**${closed ? 'Closed' : 'Status'}:** ${dClose} (${durState})`,
    ``,
    `## Structure`,
    `${summarizeLegs(p.legs)}`,
    ``,
    `**Entry per contract:** $${p.entryPerContract.toFixed(2)} × ${p.quantity} contract(s)  `,
    `**Spot at entry:** $${p.spotAtEntry.toFixed(2)}  `,
    `**DTE at entry:** ${p.dteAtEntry}d`,
    ...(closed ? [
      ``,
      `## Outcome`,
      `**Close per contract:** $${p.closePerContract!.toFixed(2)}  `,
      `**Reason:** ${p.closeReason ?? 'manual'}  `,
      `**Realized P/L:** $${pnl!.toFixed(2)} (${pnlPct! >= 0 ? '+' : ''}${pnlPct!.toFixed(1)}%)`,
    ] : []),
    ``,
    `## Notes`,
    `- Theta signed ${(p.entryPerContract > 0 ? 'positive' : 'negative')} — time worked ${p.entryPerContract > 0 ? 'for' : 'against'} this trade`,
    `- IV entry was based on ${p.dteAtEntry}-day window. Vol rank at entry would have refined strike selection.`,
  ].join('\n');
}

export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const { positions } = body || {};
  if (!Array.isArray(positions)) return NextResponse.json({ error: 'positions[] required' }, { status: 400 });
  const entries: JournalEntry[] = positions.map((p: PaperPosition) => ({
    id: p.id,
    ticker: p.ticker,
    strategyId: p.strategyId,
    openedAt: p.openedAt,
    closedAt: p.closedAt,
    status: p.status,
    durationDays: p.closedAt ? durationDays(p.openedAt, p.closedAt) : Math.round((Date.now() - new Date(p.openedAt).getTime()) / 86400000),
    entryPrice: p.spotAtEntry,
    dteAtEntry: p.dteAtEntry,
    legsSummary: summarizeLegs(p.legs),
    entryPerContract: p.entryPerContract,
    quantity: p.quantity,
    spotAtEntry: p.spotAtEntry,
    closePerContract: p.closePerContract,
    closeReason: p.closeReason,
    realizedPnL: p.status === 'closed' && p.closePerContract != null ? (p.closePerContract + p.entryPerContract) * p.quantity : undefined,
    markdown: generateMarkdown(p),
  }));
  return NextResponse.json({ journal: entries });
}
