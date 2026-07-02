'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Panel, Stat, Tag } from '@/components/Panels';
import {
  PaperPosition, loadPositions, savePositions, closePosition, deletePosition,
  realizedPnL, unrealizedPnL, positionSummary, mtmPerContract,
  resolveSigma,
} from '@/lib/paperTrading';
import { StrategyMeta, StrategyId, STRATEGIES, buildStrategy } from '@/lib/strategies';
import { blackScholes } from '@/lib/blackScholes';

type LiveQuote = { price: number; realizedVol: number | null };

/** Safe lookup that handles positions saved before the strategyId-only schema. */
function metaFor(p: { strategyId: string; strategyName?: string }): StrategyMeta {
  const real = STRATEGIES[p.strategyId as keyof typeof STRATEGIES]?.meta;
  if (real) return real;
  return {
    id: (p.strategyId as StrategyId) ?? ('unknown' as StrategyId),
    name: p.strategyName ?? p.strategyId,
    emoji: '?',
    category: 'unknown',
    shortDescription: 'unknown strategy',
    longDescription: 'unknown strategy',
    whenToUse: '—',
    example: '—',
    riskProfile: 'undefined',
    maxProfitFormula: '—',
    maxLossFormula: '—',
  };
}

export default function PortfolioPage() {
  const [positions, setPositions] = useState<PaperPosition[]>([]);
  const [quotes, setQuotes] = useState<Record<string, LiveQuote>>({});
  const [loading, setLoading] = useState(true);
  const [closeModal, setCloseModal] = useState<{ id: string; price: number; reason: string } | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);

  useEffect(() => {
    setPositions(loadPositions());
    setLoading(false);
  }, []);

  // Refresh live quotes for unique open tickers.
  useEffect(() => {
    const tickers = Array.from(new Set(positions.filter(p => p.status === 'open').map(p => p.ticker)));
    Promise.all(tickers.map(async t => {
      try {
        const res = await fetch(`/api/quote/${t}`);
        const data = await res.json();
        if (data.price != null) return [t, { price: data.price, realizedVol: data.realizedVol }] as const;
      } catch {}
      return null;
    })).then(entries => {
      const next: Record<string, LiveQuote> = {};
      for (const e of entries) if (e) next[e[0]] = e[1];
      setQuotes(prev => ({ ...prev, ...next }));
    });
  }, [positions.length]);

  const summary = positionSummary(positions);
  const openPositions = positions.filter(p => p.status === 'open');
  const closedPositions = positions.filter(p => p.status === 'closed');

  // Compute total unrealized (requires live quotes). σ priority: live quote σ
  // > stored σ_at_open > 0.30 fallback.
  let totalUnrealized = 0;
  for (const p of openPositions) {
    const q = quotes[p.ticker];
    if (!q?.price) continue;
    const daysElapsed = Math.max(0, (Date.now() - new Date(p.openedAt).getTime()) / 86_400_000);
    const remaining = Math.max(0.01, p.dteAtEntry - daysElapsed);
    const sigma = resolveSigma(p, q.realizedVol);
    totalUnrealized += unrealizedPnL(p, q.price, sigma, 0.045, remaining);
  }

  if (loading) return <div className="text-[var(--fg-faint)] text-sm">loading portfolio…</div>;

  return (
    <div className="space-y-4">
      <Panel title="~/portfolio">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-[var(--green)] glow">Paper Trading</h1>
            <p className="text-xs text-[var(--fg-faint)] mt-1">all positions stored locally in your browser · not real money</p>
          </div>
          <div className="flex gap-2">
            {positions.length > 0 && (
              <button
                onClick={() => {
                  if (confirm('Clear ALL paper positions? This cannot be undone.')) {
                    savePositions([]);
                    setPositions([]);
                  }
                }}
                className="text-xs px-3 py-1.5 border border-[var(--red-border)] text-[var(--red)] rounded-[var(--radius-sm)] hover:bg-[var(--red-faint)]/40"
              >
                clear all
              </button>
            )}
            <Link href="/trade" className="btn-primary px-4 py-1.5 rounded-[var(--radius-sm)] text-sm">
              + open new position
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Stat label="open" value={summary.openCount} />
          <Stat label="closed" value={summary.closedCount} />
          <Stat label="realized P/L" value={`${summary.realized >= 0 ? '+' : ''}$${summary.realized.toFixed(2)}`} accent={summary.realized >= 0 ? 'green' : 'red'} />
          <Stat label="unrealized P/L" value={`${totalUnrealized >= 0 ? '+' : ''}$${totalUnrealized.toFixed(2)}`} accent={totalUnrealized >= 0 ? 'green' : 'red'} />
          <Stat label="win rate" value={closedPositions.length ? `${(summary.winRate * 100).toFixed(0)}%` : '—'} />
        </div>
      </Panel>

      {positions.length === 0 ? (
        <Panel title="~/empty">
          <div className="text-center py-12 space-y-3">
            <div className="text-5xl">📭</div>
            <div className="text-[var(--fg-dim)]">no paper positions yet</div>
            <Link href="/trade" className="btn-primary inline-block px-5 py-2 rounded-[var(--radius-sm)] text-sm">
              open your first position →
            </Link>
          </div>
        </Panel>
      ) : (
        <>
          {openPositions.length > 0 && (
            <Panel title={`~/open_positions (${openPositions.length})`}>
              <div className="space-y-3">
                {openPositions.map(p => (
                  <PositionCard
                    key={p.id}
                    position={p}
                    quote={quotes[p.ticker]}
                    onClose={() => {
                      const q = quotes[p.ticker];
                      const price = q?.price ?? p.spotAtEntry;
                      setCloseModal({ id: p.id, price, reason: 'manual' });
                    }}
                    onDetail={() => setDetailId(p.id)}
                  />
                ))}
              </div>
            </Panel>
          )}

          {closedPositions.length > 0 && (
            <Panel title={`~/history (${closedPositions.length})`}>
              <div className="space-y-2">
                {closedPositions.map(p => {
                  const pnl = realizedPnL(p);
                  return (
                    <div
                      key={p.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => setDetailId(p.id)}
                      onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && setDetailId(p.id)}
                      className="cursor-pointer rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-3)]/30 px-4 py-3 flex items-center gap-4 hover:border-[var(--green-dim)] transition"
                    >
                      <div className="text-2xl">{metaFor(p).emoji}</div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-bold text-[var(--fg)]">{metaFor(p).name} · {p.ticker}</div>
                        <div className="text-[10px] text-[var(--fg-faint)] uppercase tracking-wider mt-0.5">
                          {p.quantity}× · opened {new Date(p.openedAt).toLocaleDateString()} · closed {p.closedAt ? new Date(p.closedAt).toLocaleDateString() : '—'}
                          {p.closeReason && <span> · {p.closeReason}</span>}
                          {p.closeSpot != null && <span> @ ${p.closeSpot.toFixed(2)}</span>}
                        </div>
                      </div>
                      <div className={`text-base font-bold tabular-nums ${pnl >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}>
                        {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); setPositions(deletePosition(p.id)); }}
                        className="text-[var(--fg-faint)] hover:text-[var(--red)] text-xs"
                      >✕</button>
                    </div>
                  );
                })}
              </div>
            </Panel>
          )}
        </>
      )}

      {closeModal && (
        <ClosePositionModal
          position={positions.find(p => p.id === closeModal.id)!}
          closePrice={closeModal.price}
          realizedVol={resolveSigma(
            positions.find(p => p.id === closeModal.id)!,
            quotes[positions.find(p => p.id === closeModal.id!)?.ticker ?? '']?.realizedVol,
          )}
          onConfirm={(reason) => {
            const pos = positions.find(p => p.id === closeModal.id)!;
            const q = quotes[pos.ticker];
            const remainingDays = Math.max(0.001, pos.dteAtEntry - (Date.now() - new Date(pos.openedAt).getTime()) / 86_400_000);
            const sigma = resolveSigma(pos, q?.realizedVol);
            // BUG FIX: mtmPerContract expects T in YEARS. The previous version
            // passed raw days (~30 instead of 30/365) which valued the option
            // legs as if there were 30 YEARS left, vastly mis-stating the
            // close value and thus the ~history P/L. The modal already used
            // /365, so the stored value diverged from the modal preview; ~history
            // and the modal now agree on the same number.
            const closeValue = mtmPerContract(pos.legs, closeModal.price, sigma, 0.045, remainingDays / 365);
            // closePerContract on the stored position = signed cash flow out
            // of the position (NOT sign-flipped). realizedPnL = (close + entry)
            // × quantity reproduces exactly the modal's preview P/L.
            setPositions(closePosition(closeModal.id, closeValue, reason, closeModal.price));
            setCloseModal(null);
          }}
          onCancel={() => setCloseModal(null)}
        />
      )}

      {detailId && (() => {
        const pos = positions.find(p => p.id === detailId);
        if (!pos) return null;
        const q = quotes[pos.ticker];
        const daysElapsed = Math.max(0, (Date.now() - new Date(pos.openedAt).getTime()) / 86_400_000);
        const remainingDays = Math.max(0.001, pos.dteAtEntry - daysElapsed);
        const spot = q?.price ?? pos.spotAtEntry;
        const sigma = resolveSigma(pos, q?.realizedVol);
        return <TradeDetailModal position={pos} spot={spot} sigma={sigma} remainingDays={remainingDays} onClose={() => setDetailId(null)} />;
      })()}
    </div>
  );
}

function PositionCard({ position: p, quote, onClose, onDetail }: { position: PaperPosition; quote?: LiveQuote; onClose: () => void; onDetail: () => void; }) {
  const daysElapsed = Math.max(0, (Date.now() - new Date(p.openedAt).getTime()) / 86_400_000);
  const remaining = Math.max(0.01, p.dteAtEntry - daysElapsed);
  const sigma = resolveSigma(p, quote?.realizedVol);
  const spot = quote?.price ?? p.spotAtEntry;
  const unrealized = unrealizedPnL(p, spot, sigma, 0.045, remaining);

  return (
    <div className="rounded-[var(--radius)] border border-[var(--border)] bg-gradient-to-br from-[var(--bg-2)] to-[var(--bg)] p-4 hover:border-[var(--border-bright)] transition">
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={onDetail} className="text-2xl hover:scale-110 transition-transform" title="trade details" aria-label="trade details">{metaFor(p).emoji}</button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={onDetail} className="font-bold text-[var(--fg)] hover:text-[var(--green)] transition">{metaFor(p).name}</button>
            <span className="text-xs text-[var(--fg-dim)]">·</span>
            <span className="font-mono text-[var(--green)]">{p.ticker}</span>
            <Tag color={p.entryPerContract > 0 ? 'green' : 'yellow'}>
              {p.entryPerContract > 0 ? 'credit' : 'debit'} ${Math.abs(p.entryPerContract).toFixed(2)}
            </Tag>
            <span className="text-[10px] text-[var(--fg-faint)]">{p.quantity}× contract{p.quantity > 1 ? 's' : ''}</span>
          </div>
          <div className="text-[10px] text-[var(--fg-faint)] mt-0.5 uppercase tracking-wider">
            opened {new Date(p.openedAt).toLocaleString()} · {Math.round(remaining)} DTE left
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] text-[var(--fg-faint)] uppercase tracking-wider">unrealized</div>
          <div className={`text-xl font-bold tabular-nums ${unrealized >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}>
            {unrealized >= 0 ? '+' : ''}${unrealized.toFixed(2)}
          </div>
          <div className="text-[10px] text-[var(--fg-faint)] mt-0.1">spot ${spot.toFixed(2)}</div>
        </div>
        <button onClick={onDetail} className="px-2 py-1.5 text-[10px] rounded-[var(--radius-sm)] border border-[var(--border)] hover:border-[var(--green-dim)] hover:text-[var(--green)] transition" title="view greeks + win/lose conditions">
          details
        </button>
        <button onClick={onClose} className="px-3 py-1.5 text-xs rounded-[var(--radius-sm)] border border-[var(--border)] hover:border-[var(--red)] hover:text-[var(--red)] transition">
          close
        </button>
      </div>
      <div className="mt-3 pt-3 border-t border-[var(--border)] grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
        <Mini label="entry / contract" value={`${p.entryPerContract > 0 ? '+' : ''}$${p.entryPerContract.toFixed(2)}`} />
        <Mini label="max risk / contract" value={`$${Math.abs(p.entryPerContract * p.quantity).toFixed(0)}`} />
        <Mini label="legs" value={`${p.legs.length}`} />
        <Mini label="strategy type" value={STRATEGIES[p.strategyId]?.meta.category ?? '—'} />
      </div>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center bg-[var(--bg-3)]/40 rounded px-2 py-1">
      <span className="text-[var(--fg-faint)] uppercase tracking-wider text-[9px]">{label}</span>
      <span className="text-[var(--fg)] font-mono tabular-nums">{value}</span>
    </div>
  );
}

function ClosePositionModal({ position, closePrice, realizedVol, onConfirm, onCancel }: {
  position: PaperPosition; closePrice: number; realizedVol?: number; onConfirm: (reason: string) => void; onCancel: () => void;
}) {
  const [reason, setReason] = useState('profit target');
  const daysElapsed = Math.max(0, (Date.now() - new Date(position.openedAt).getTime()) / 86_400_000);
  const remainingDays = Math.max(0.001, position.dteAtEntry - daysElapsed);
  const sigma = resolveSigma(position, realizedVol);
  // mtmPerContract expects T in YEARS. Same calculation that the parent
  // persists into closePerContract; the modal value matches ~history exactly.
  const closeValue = mtmPerContract(position.legs, closePrice, sigma, 0.045, remainingDays / 365);
  const pnl = (closeValue + position.entryPerContract) * position.quantity;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="panel max-w-md w-full">
        <div className="panel-header">
          <span className="text-sm font-bold text-[var(--fg)]">close position</span>
          <button onClick={onCancel} className="text-[var(--fg-faint)] hover:text-[var(--fg)]">✕</button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <div className="text-xs text-[var(--fg-dim)] mb-1">{metaFor(position).emoji} {metaFor(position).name} · {position.ticker} ×{position.quantity}</div>
            <div className="text-[10px] text-[var(--fg-faint)] uppercase tracking-wider">
              closing at spot ${closePrice.toFixed(2)} · {Math.round(remainingDays)} DTE left · σ {(sigma * 100).toFixed(0)}%
            </div>
          </div>
          <div className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-3)]/40 p-4 text-center">
            <div className="text-[10px] uppercase tracking-wider text-[var(--fg-faint)]">realized P/L</div>
            <div className={`text-3xl font-bold tabular-nums mt-1 ${pnl >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}>
              {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}
            </div>
            <div className="text-[10px] text-[var(--fg-faint)] mt-1">
              P/L stored as <code>closePerContract</code> = ${closeValue.toFixed(2)} · {position.quantity} contracts
            </div>
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-[var(--fg-faint)] mb-1.5">reason</label>
            <select value={reason} onChange={e => setReason(e.target.value)} className="w-full">
              <option>profit target</option>
              <option>stop loss</option>
              <option>expiration approaching</option>
              <option>thesis invalidated</option>
              <option>manual</option>
            </select>
          </div>
          <div className="flex gap-2 pt-2">
            <button onClick={onCancel} className="flex-1 py-2 rounded-[var(--radius-sm)] border border-[var(--border)] text-[var(--fg-dim)] hover:text-[var(--fg)] transition">
              cancel
            </button>
            <button onClick={() => onConfirm(reason)} className="btn-primary flex-1 py-2 rounded-[var(--radius-sm)]">
              confirm close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * TradeDetailModal — what every position means at a glance.
 *   - strategy description + win/lose conditions + example
 *   - leg-by-leg breakdown
 *   - current greeks (delta, theta, vega, gamma) re-priced from spot + σ via Black-Scholes
 *   - break-even prices + max-profit / max-loss formulas (sourced from STRATEGIES meta)
 */
function TradeDetailModal({ position, spot, sigma, remainingDays, onClose }: {
  position: PaperPosition; spot: number; sigma: number; remainingDays: number; onClose: () => void;
}) {
  const meta = metaFor(position);
  // Recompute greeks via the same BSM the engine uses. Per-contract greeks so
  // we sum across the same sign the strategy builder uses.
  const T = Math.max(0.0001, remainingDays / 365);
  let delta = 0, theta = 0, vega = 0, gamma = 0;
  for (const leg of position.legs) {
    if (leg.kind === 'stock') { delta += leg.side === 'long' ? 1 : -1; continue; }
    if (leg.strike == null) continue;
    const g = blackScholes({ S: spot, K: leg.strike, T, r: 0.045, sigma });
    const sign = leg.side === 'long' ? 1 : -1;
    delta += sign * (leg.kind === 'call' ? g.deltaCall : g.deltaPut);
    theta += sign * (leg.kind === 'call' ? g.thetaCall : g.thetaPut);
    vega  += sign * g.vega / 100;          // greeks per 1.00 of IV
    gamma += sign * g.gamma;                // gamma is sign-symmetric (same for call & put)
  }
  const deltaX = delta * 100 * position.quantity;
  const thetaX = theta * 100 * position.quantity;  // per day, signed
  const vegaX = vega * 100 * position.quantity;     // per 1% IV move
  const gammaX = gamma * 100 * position.quantity;

  // Recover break-evens / max-profit / max-loss from the strategy definition.
  let builtInfo: { breakEvens: number[]; maxProfit: number | null; maxLoss: number | null } | null = null;
  if (position.legs.every(l => l.strike != null || l.kind === 'stock')) {
    try {
      const built = buildStrategy(position.strategyId as StrategyId, {
        S: position.spotAtEntry,
        sigma: position.sigmaAtEntry ?? sigma,
        r: 0.045,
        daysToExpiry: position.dteAtEntry,
      });
      builtInfo = { breakEvens: built.breakEvens, maxProfit: built.maxProfit, maxLoss: built.maxLoss };
    } catch { /* unknown strategy id; ignore */ }
  }

  const pnl = position.status === 'closed' ? realizedPnL(position) : (
    unrealizedPnL(position, spot, sigma, 0.045, remainingDays)
  );
  const pnlLabel = position.status === 'closed' ? 'realized P/L' : 'unrealized P/L';

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="panel max-w-2xl w-full max-h-[88vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="panel-header sticky top-0 bg-[var(--bg-2)] z-10 border-b border-[var(--border)]">
          <span className="text-sm font-bold text-[var(--fg)] flex items-center gap-2">
            <span className="text-lg">{meta.emoji}</span>
            <span>{meta.name}</span>
            <span className="text-[var(--fg-dim)] font-mono">·</span>
            <span className="font-mono text-[var(--green)]">{position.ticker}</span>
            {position.status === 'closed' && <Tag color="dim">closed</Tag>}
          </span>
          <button onClick={onClose} className="text-[var(--fg-faint)] hover:text-[var(--fg)]">✕</button>
        </div>
        <div className="p-5 space-y-4">
          <div className="text-[11px] text-[var(--fg-dim)] leading-snug italic">{meta.shortDescription}</div>

          {/* ── current P/L + live quote ── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <div className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-3)]/40 p-3 text-center">
              <div className="text-[10px] uppercase tracking-wider text-[var(--fg-faint)]">{pnlLabel}</div>
              <div className={`text-2xl font-bold tabular-nums mt-1 ${pnl >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}>
                {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}
              </div>
            </div>
            <div className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-3)]/40 p-3 text-center">
              <div className="text-[10px] uppercase tracking-wider text-[var(--fg-faint)]">spot</div>
              <div className="text-lg font-bold tabular-nums mt-1 text-[var(--fg)]">${spot.toFixed(2)}</div>
              <div className="text-[9px] text-[var(--fg-faint)] mt-0.5">σ {(sigma * 100).toFixed(0)}%</div>
            </div>
            <div className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-3)]/40 p-3 text-center">
              <div className="text-[10px] uppercase tracking-wider text-[var(--fg-faint)]">DTE</div>
              <div className="text-lg font-bold tabular-nums mt-1 text-[var(--fg)]">{Math.max(0, Math.round(remainingDays))}</div>
              <div className="text-[9px] text-[var(--fg-faint)] mt-0.5">d open {Math.max(0, position.dteAtEntry - Math.round(remainingDays))}</div>
            </div>
            <div className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-3)]/40 p-3 text-center">
              <div className="text-[10px] uppercase tracking-wider text-[var(--fg-faint)]">credit/debit</div>
              <div className={`text-lg font-bold tabular-nums mt-1 ${position.entryPerContract >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}>
                {position.entryPerContract >= 0 ? '+' : ''}${position.entryPerContract.toFixed(2)}
              </div>
              <div className="text-[9px] text-[var(--fg-faint)] mt-0.5">× {position.quantity} contracts</div>
            </div>
          </div>

          {/* ── strategy description ── */}
          <div>
            <div className="text-[10px] uppercase tracking-wider text-[var(--fg-faint)] mb-1">what this is</div>
            <div className="text-xs leading-relaxed text-[var(--fg-dim)]">{meta.longDescription}</div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            <div className="rounded-[var(--radius-sm)] border border-[var(--green-dim)] bg-[var(--green-faint)]/10 p-3">
              <div className="text-[10px] uppercase tracking-wider text-[var(--green)] mb-1">✓ win condition</div>
              <div className="text-[var(--fg)]">{meta.whenToUse}</div>
              <div className="text-[10px] text-[var(--fg-faint)] mt-1.5 leading-relaxed">{meta.example}</div>
              {builtInfo?.maxProfit != null && (
                <div className="text-[11px] mt-2 font-mono text-[var(--green)]">max profit: ${builtInfo.maxProfit.toFixed(0)}/contract</div>
              )}
              {builtInfo?.maxProfit == null && (
                <div className="text-[11px] mt-2 font-mono text-[var(--green)]">max profit: {meta.maxProfitFormula}</div>
              )}
            </div>
            <div className="rounded-[var(--radius-sm)] border border-[var(--red-border)] bg-[var(--red-faint)]/10 p-3">
              <div className="text-[10px] uppercase tracking-wider text-[var(--red)] mb-1">✗ lose condition</div>
              <div className="text-[var(--fg-dim)] text-[11px] leading-relaxed">
                {builtInfo?.maxLoss != null
                  ? <>max loss: <span className="font-mono text-[var(--red)]">${Math.abs(builtInfo.maxLoss).toFixed(0)}</span>/contract ({meta.riskProfile} risk)</>
                  : <>{meta.maxLossFormula} ({meta.riskProfile} risk)</>}
                {builtInfo?.breakEvens.length ? (
                  <div className="mt-2 text-[11px] font-mono">
                    break-even{builtInfo.breakEvens.length > 1 ? 's' : ''}: {builtInfo.breakEvens.map(b => `$${b.toFixed(2)}`).join(', ')}
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          {/* ── greeks ── */}
          <div>
            <div className="text-[10px] uppercase tracking-wider text-[var(--fg-faint)] mb-1">live greeks (per contract × qty)</div>
            <div className="grid grid-cols-4 gap-2">
              <Greek label="Δ delta" value={deltaX} fmt={v => v.toFixed(2)} hint="dollars per $1 stock move" />
              <Greek label="Θ theta" value={thetaX} fmt={v => v.toFixed(2)} hint="dollars per day (negative = bleeding)" />
              <Greek label="V vega" value={vegaX} fmt={v => v.toFixed(2)} hint="dollars per 1% IV move" />
              <Greek label="Γ gamma" value={gammaX} fmt={v => (v / 100).toFixed(4)} hint="acceleration of delta" />
            </div>
          </div>

          {/* ── legs ── */}
          <div>
            <div className="text-[10px] uppercase tracking-wider text-[var(--fg-faint)] mb-1">legs</div>
            <div className="overflow-x-auto">
              <table className="text-xs w-full border-collapse">
                <thead>
                  <tr className="text-[var(--fg-faint)] uppercase tracking-wider text-[9px] border-b border-[var(--border)]">
                    <th className="text-left py-1.5 pr-2 font-medium">side</th>
                    <th className="text-left py-1.5 px-2 font-medium">type</th>
                    <th className="text-right py-1.5 px-2 font-medium">strike</th>
                    <th className="text-right py-1.5 px-2 font-medium">entry</th>
                    <th className="text-right py-1.5 px-2 font-medium">current</th>
                    <th className="text-right py-1.5 pl-2 font-medium">P/L</th>
                  </tr>
                </thead>
                <tbody>
                  {position.legs.map((leg, i) => {
                    const isStock = leg.kind === 'stock';
                    const sign = leg.side === 'long' ? 1 : -1;
                    const cur = isStock
                      ? (sign === 1 ? spot : -spot)
                      : (leg.strike != null
                          ? sign * blackScholes({ S: spot, K: leg.strike, T, r: 0.045, sigma })[leg.kind === 'call' ? 'call' : 'put']
                          : 0);
                    const entry = sign * (isStock ? (leg.entryPrice ?? position.spotAtEntry) : (leg.entryPrice ?? 0));
                    const legPnl = (cur - leg.entryPrice) * sign * 100;
                    return (
                      <tr key={i} className="border-b border-[var(--border)]/40">
                        <td className={`py-1.5 pr-2 font-bold ${leg.side === 'long' ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}>{leg.side}</td>
                        <td className="py-1.5 px-2 text-[var(--fg-dim)]">{leg.kind}</td>
                        <td className="py-1.5 px-2 text-right tabular-nums text-[var(--fg-dim)] font-mono">{isStock ? '—' : `$${leg.strike}`}</td>
                        <td className="py-1.5 px-2 text-right tabular-nums text-[var(--fg-dim)] font-mono">${(leg.entryPrice ?? 0).toFixed(2)}</td>
                        <td className="py-1.5 px-2 text-right tabular-nums text-[var(--fg)] font-mono">${(isStock ? spot : (leg.strike != null ? Math.max(0, sign * blackScholes({ S: spot, K: leg.strike, T, r: 0.045, sigma })[leg.kind === 'call' ? 'call' : 'put']) : 0)).toFixed(2)}</td>
                        <td className={`py-1.5 pl-2 text-right tabular-nums font-bold ${legPnl >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}>
                          {legPnl >= 0 ? '+' : ''}${legPnl.toFixed(2)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {position.notes && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[var(--fg-faint)] mb-1">notes</div>
              <div className="text-xs text-[var(--fg-dim)] leading-relaxed">{position.notes}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Compact greek stat block. */
function Greek({ label, value, hint, fmt }: { label: string; value: number; hint: string; fmt: (v: number) => string }) {
  const signClass = value > 0.005 ? 'text-[var(--green)]' : value < -0.005 ? 'text-[var(--red)]' : 'text-[var(--fg)]';
  return (
    <div className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-3)]/40 p-2 text-center">
      <div className="text-[10px] uppercase tracking-wider text-[var(--fg-faint)]">{label}</div>
      <div className={`text-base font-bold tabular-nums mt-0.5 ${signClass}`}>{fmt(value)}</div>
      <div className="text-[8px] text-[var(--fg-faint)] mt-0.5 leading-tight">{hint}</div>
    </div>
  );
}