'use client';

// Live P/L for the auto-paper picks table. Fetches /api/quote/ for every
// unique ticker in the dataset, recomputes MTM via the SAME markToMarket
// function the cron uses, and renders a single number per row.
//
// Using the same MTM function everywhere (cron, calibration close, this page)
// is the whole point of phase 2: one source of truth, no drift.

import { useEffect, useMemo, useState } from 'react';
import { Tag } from '@/components/Panels';
import { markToMarket, remainingDte } from '@/lib/autoPaper/markToMarket';
import { Leg } from '@/lib/strategies';
import type { PickRow } from '@/lib/db/autoPaperRepo';

interface Quote { price: number; realizedVol: number | null }

interface LiveRow {
  pick: PickRow;
  quote: Quote | null;
  mtmPerContract: number | null;
  unrealizedPnl: number | null;
}

const R = 0.045;

function deriveEntryPerContract(legs: Leg[]): number {
  return legs.reduce((s, l) => s + (l.side === 'long' ? -1 : 1) * l.entryPrice * 100, 0);
}

export function AutoPaperLive({ initialRows }: { initialRows: PickRow[] }) {
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [loading, setLoading] = useState(true);

  // Unique tickers across all rows so we only fetch each one once.
  const tickers = useMemo(() => {
    const s = new Set<string>();
    for (const r of initialRows) s.add(r.ticker);
    return Array.from(s);
  }, [initialRows]);

  useEffect(() => {
    if (!tickers.length) { setLoading(false); return; }
    let cancelled = false;
    Promise.all(tickers.map(async t => {
      try {
        const res = await fetch(`/api/quote/${encodeURIComponent(t)}`);
        const data = await res.json();
        if (data?.price != null) return [t, { price: data.price, realizedVol: data.realizedVol }] as const;
      } catch {}
      return null;
    })).then(entries => {
      if (cancelled) return;
      const next: Record<string, Quote> = {};
      for (const e of entries) if (e) next[e[0]] = e[1];
      setQuotes(prev => ({ ...prev, ...next }));
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [tickers.join(',')]);

  const liveRows: LiveRow[] = useMemo(() => {
    return initialRows.map(pick => {
      const q = quotes[pick.ticker] ?? null;
      if (!q) return { pick, quote: null, mtmPerContract: null, unrealizedPnl: null };
      try {
        const legs: Leg[] = JSON.parse(pick.legs_json);
        const sigma = q.realizedVol ?? pick.sigma_at_open;
        const rem = remainingDte(pick.opened_at, pick.dte);
        const mtm = markToMarket({
          legs,
          spot: q.price,
          sigma,
          r: R,
          remainingDays: rem,
          contracts: pick.contracts,
          entryPerContract: deriveEntryPerContract(legs),
        });
        return { pick, quote: q, mtmPerContract: mtm.mtmPerContract, unrealizedPnl: mtm.unrealizedPnl };
      } catch {
        return { pick, quote: q, mtmPerContract: null, unrealizedPnl: null };
      }
    });
  }, [initialRows, quotes]);

  const openRows = liveRows.filter(r => r.pick.status === 'open');
  const closedRows = liveRows.filter(r => r.pick.status !== 'open');

  return (
    <div className="space-y-3">
      {openRows.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-[var(--fg-faint)] font-bold mb-1">
            open · {openRows.length}
          </div>
          <div className="space-y-1">
            {openRows.map(r => <Row key={r.pick.id} live={r} loading={loading} />)}
          </div>
        </div>
      )}
      {closedRows.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-[var(--fg-faint)] font-bold mb-1">
            closed · {closedRows.length}
          </div>
          <div className="space-y-1">
            {closedRows.map(r => <Row key={r.pick.id} live={r} loading={loading} />)}
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ live, loading }: { live: LiveRow; loading: boolean }) {
  const { pick, quote, mtmPerContract, unrealizedPnl } = live;
  const rem = remainingDte(pick.opened_at, pick.dte);
  const isOpen = pick.status === 'open';
  const pnl = isOpen ? unrealizedPnl : pick.realized_pnl;
  const pct = (n: number | null) => n == null ? '—' : `${n >= 0 ? '+' : ''}$${n.toFixed(0)}`;

  return (
    <div className="flex items-center gap-2 text-[11px] tabular-nums border border-[var(--border)]/50 bg-[var(--bg-2)]/40 rounded px-2 py-1.5">
      <span className="text-[var(--green)] font-bold w-14">{pick.ticker}</span>
      <span className="text-[var(--fg-dim)] w-32 truncate" title={pick.strategy_id}>{pick.strategy_id}</span>
      <span className="text-[var(--fg-faint)] w-20">{pick.opened_at.slice(5, 10)}</span>
      <span className={`w-14 ${rem <= 2 ? 'text-[var(--red)]' : rem <= 7 ? 'text-[var(--yellow)]' : 'text-[var(--fg-dim)]'}`}>
        {isOpen ? `${rem.toFixed(0)}d` : '—'}
      </span>
      <span className="text-[var(--fg-dim)] w-20">σ {(pick.sigma_at_open * 100).toFixed(0)}%</span>
      <span className="text-[var(--fg-dim)] w-14">IV {pick.iv_rank_at_open.toFixed(0)}</span>
      <span className="text-[var(--fg-dim)] w-20">PoP {(pick.predicted_pop * 100).toFixed(0)}%</span>
      <span className="ml-auto flex items-center gap-2">
        {isOpen ? (
          <>
            <span className="text-[var(--fg-faint)] text-[10px]">
              spot {quote ? `$${quote.price.toFixed(2)}` : (loading ? '…' : '—')}
            </span>
            <span className={`font-bold w-20 text-right ${unrealizedPnl == null ? 'text-[var(--fg-faint)]' : unrealizedPnl >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}>
              {pct(unrealizedPnl)}
            </span>
          </>
        ) : (
          <>
            <Tag color={pick.close_reason === 'profit_target' ? 'green' : pick.close_reason === 'stop_loss' ? 'red' : 'dim'}>
              {pick.close_reason ?? pick.status}
            </Tag>
            <span className={`font-bold w-20 text-right ${pnl == null ? 'text-[var(--fg-faint)]' : pnl >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}>
              {pct(pnl)}
            </span>
          </>
        )}
      </span>
    </div>
  );
}