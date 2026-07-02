'use client';

import { useEffect, useState, Fragment } from 'react';
import { Panel, Tag, Stat } from '@/components/Panels';
import {
  loadPositions, PaperPosition, mtmPerContract,
} from '@/lib/paperTrading';
import { buildStrategy, STRATEGIES, StrategyId } from '@/lib/strategies';

// /tools — single-page UI for the API endpoints that didn't get a UI in earlier passes:
//   backtest (api/backtest)   — Sharpe / winRate / maxDD over the last year
//   presets (api/presets)     — save / load named strategy configs per ticker
//   journal (api/journal)     — generate markdown trade-journal for closed positions
//   chain   (api/chain)       — synthetic strikes × DTEs grid for the current ticker
//   broker  (api/broker)      — connection status (stub without BROKER_CLIENT_ID)

const TABS = ['backtest', 'presets', 'journal', 'chain', 'broker'] as const;
type Tab = typeof TABS[number];

interface BacktestResult {
  strategyId: string;
  totalTrades: number;
  winRate: number;
  avgPnl: number;
  sharpe: number;
  maxDrawdown: number;
  startDate: string;
  endDate: string;
  holdingDays: number;
  trades: Array<{ entryDate: string; exitDate: string; entryPrice: number; sigma: number; probProfit: number; pnl: number; win: boolean }>;
}

interface Preset {
  id: string;
  ticker: string;
  name: string;
  author: string;
  strategyId: string;
  params: Record<string, number>;
  notes: string;
  createdAt: string;
}

interface JournalEntry {
  id: string;
  ticker: string;
  strategyId: string;
  status: 'open' | 'closed';
  durationDays: number;
  markdown: string;
}

interface ChainGrid {
  spot: number;
  dtes: number[];
  cells: Array<{ strike: number; dte: number; moneyness: number; iv: number; callPrice: number; putPrice: number }>;
  minIv: number;
  maxIv: number;
  atmIv: number;
}

interface BrokerInfo {
  mode: 'stub' | 'live';
  session?: { sessionId: string; accountId: string; expiresAt: string };
  notice: string;
}

export default function ToolsPage() {
  const [tab, setTab] = useState<Tab>('backtest');
  return (
    <div className="space-y-3">
      <Panel
        title="~/tools"
        right={
          <div className="flex flex-wrap gap-1">
            {TABS.map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`text-[10px] px-2 py-1 rounded-full border ${
                  tab === t ? 'border-[var(--green-dim)] bg-[var(--green-faint)] text-[var(--green)]' : 'border-[var(--border)] text-[var(--fg-dim)] hover:border-[var(--border-bright)] hover:text-[var(--fg)]'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        }
      >
        <div className="text-xs text-[var(--fg-dim)] leading-snug">
          power-user pages for backtesting, strategy presets, trade journaling, options chain snapshots, and broker connection.
          fill in a ticker + parameters below, then run.
        </div>
      </Panel>

      {tab === 'backtest' && <BacktestPanel />}
      {tab === 'presets' && <PresetsPanel />}
      {tab === 'journal' && <JournalPanel />}
      {tab === 'chain' && <ChainPanel />}
      {tab === 'broker' && <BrokerPanel />}
    </div>
  );
}

// ────────────────────────────────────────────────────── backtest ──

function BacktestPanel() {
  const [symbol, setSymbol] = useState('AAPL');
  const [strategyId, setStrategyId] = useState<StrategyId>('iron_condor');
  const [holdingDays, setHoldingDays] = useState(30);
  const [entryEveryNDays, setEntryEveryNDays] = useState(14);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [closes, setCloses] = useState<number[] | null>(null);

  useEffect(() => {
    fetch(`/api/quote/${encodeURIComponent(symbol)}`)
      .then(r => r.json())
      .then(d => setCloses(d.history ?? null))
      .catch(() => setCloses(null));
  }, [symbol]);

  const runBacktest = async () => {
    if (!closes || closes.length < 50) {
      setErr('need 50+ prices — ticker fetch probably failed');
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch('/api/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ strategyId, closes, holdingDays, entryEveryNDays, numPaths: 200, seed: 42 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'failed');
      setResult(data.result);
    } catch (e: any) {
      setErr(e.message ?? 'failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Panel title="~backtest · replay strategy entries on historical closes">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 items-end">
          <label className="block">
            <div className="text-[10px] uppercase tracking-wider text-[var(--fg-faint)] mb-1 font-medium">ticker</div>
            <input value={symbol} onChange={e => setSymbol(e.target.value.toUpperCase())} className="w-full uppercase tracking-wider text-xs px-2 py-1" />
          </label>
          <label className="block">
            <div className="text-[10px] uppercase tracking-wider text-[var(--fg-faint)] mb-1 font-medium">strategy</div>
            <select value={strategyId} onChange={e => setStrategyId(e.target.value as StrategyId)} className="w-full text-xs px-2 py-1">
              {Object.keys(STRATEGIES).map(id => {
                const m = STRATEGIES[id as StrategyId].meta;
                return <option key={id} value={id}>{m.emoji} {m.name}</option>;
              })}
            </select>
          </label>
          <label className="block">
            <div className="text-[10px] uppercase tracking-wider text-[var(--fg-faint)] mb-1 font-medium">holding (d)</div>
            <input type="number" value={holdingDays} onChange={e => setHoldingDays(parseInt(e.target.value) || 30)} className="w-full text-xs px-2 py-1" />
          </label>
          <label className="block">
            <div className="text-[10px] uppercase tracking-wider text-[var(--fg-faint)] mb-1 font-medium">entry every N d</div>
            <input type="number" value={entryEveryNDays} onChange={e => setEntryEveryNDays(parseInt(e.target.value) || 14)} className="w-full text-xs px-2 py-1" />
          </label>
          <button onClick={runBacktest} disabled={loading || !closes} className="btn-primary py-1.5 px-3 text-xs font-bold disabled:opacity-50">
            {loading ? '⟳ running…' : `▶ run backtest`}
          </button>
        </div>
        {closes && (
          <div className="text-[10px] text-[var(--fg-faint)] mt-2">
            loaded {closes.length} historical closes for {symbol} → {Math.floor(closes.length / entryEveryNDays)} candidate trade entries
          </div>
        )}
        {err && <div className="text-[11px] text-[var(--red)] mt-2">! {err}</div>}
      </Panel>
      {result && (
        <>
          <Panel title="~summary · backtest">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <Stat label="trades" value={result.totalTrades} />
              <Stat label="win rate" value={`${(result.winRate * 100).toFixed(1)}%`} accent={result.winRate >= 0.5 ? 'green' : 'red'} />
              <Stat label="avg P/L" value={`${result.avgPnl >= 0 ? '+' : ''}$${result.avgPnl.toFixed(2)}`} accent={result.avgPnl >= 0 ? 'green' : 'red'} />
              <Stat label="Sharpe" value={result.sharpe.toFixed(2)} accent={result.sharpe >= 0 ? 'green' : 'red'} />
              <Stat label="max drawdown" value={`$${result.maxDrawdown.toFixed(0)}`} accent="red" />
            </div>
          </Panel>
          <Panel title={`~trade_log · ${result.totalTrades} entries`}>
            <div className="max-h-80 overflow-y-auto space-y-1">
              {result.trades.map((t, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 text-[10px] items-center px-2 py-1 rounded border border-[var(--border)] bg-[var(--bg-3)]/30">
                  <span className="col-span-2 tabular-nums text-[var(--fg-faint)]">{t.entryDate}→{t.exitDate}</span>
                  <span className="col-span-2 tabular-nums">entry ${t.entryPrice.toFixed(2)}</span>
                  <span className="col-span-1 tabular-nums text-[var(--fg-faint)]">σ {(t.sigma*100).toFixed(0)}%</span>
                  <span className="col-span-2 tabular-nums text-[var(--fg-dim)]">PoP {(t.probProfit*100).toFixed(0)}%</span>
                  <span className={`col-span-2 tabular-nums font-bold ${t.pnl >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}>{t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(2)}</span>
                  <span className={`col-span-1 text-right text-[9px] font-bold ${t.win ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}>{t.win ? 'WIN' : 'LOSS'}</span>
                  <span className="col-span-1 text-right text-[var(--fg-faint)] tabular-nums">{(t.pnl).toFixed(2)}/share</span>
                </div>
              ))}
            </div>
          </Panel>
        </>
      )}
    </>
  );
}

// ────────────────────────────────────────────────────── presets ──

function PresetsPanel() {
  const [ticker, setTicker] = useState('AAPL');
  const [presets, setPresets] = useState<Preset[]>([]);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState('');
  const [strategyId, setStrategyId] = useState<StrategyId>('iron_condor');
  const [delta, setDelta] = useState(0.16);
  const [wing, setWing] = useState(5);
  const [dte, setDte] = useState(30);

  const refresh = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/presets?ticker=${encodeURIComponent(ticker)}`);
      const data = await res.json();
      setPresets(data.presets ?? []);
    } finally { setLoading(false); }
  };

  useEffect(() => { refresh(); }, [ticker]);

  const save = async () => {
    if (!name.trim()) return;
    const id = `${ticker.toLowerCase()}-${strategyId}-${Date.now().toString(36)}`;
    await fetch('/api/presets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ticker, name, strategyId, params: { delta, wingWidth: wing, daysToExpiry: dte }, notes: '' }),
    });
    setName('');
    refresh();
  };

  const remove = async (id: string) => {
    await fetch(`/api/presets?id=${encodeURIComponent(id)}&ticker=${encodeURIComponent(ticker)}`, { method: 'DELETE' });
    refresh();
  };

  return (
    <>
      <Panel title="~save · strategy preset">
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3 items-end">
          <label className="block">
            <div className="text-[10px] uppercase tracking-wider text-[var(--fg-faint)] mb-1 font-medium">ticker</div>
            <input value={ticker} onChange={e => setTicker(e.target.value.toUpperCase())} className="w-full uppercase tracking-wider text-xs px-2 py-1" />
          </label>
          <label className="block">
            <div className="text-[10px] uppercase tracking-wider text-[var(--fg-faint)] mb-1 font-medium">strategy</div>
            <select value={strategyId} onChange={e => setStrategyId(e.target.value as StrategyId)} className="w-full text-xs px-2 py-1">
              {Object.keys(STRATEGIES).map(id => <option key={id} value={id}>{STRATEGIES[id as StrategyId].meta.name}</option>)}
            </select>
          </label>
          <label className="block">
            <div className="text-[10px] uppercase tracking-wider text-[var(--fg-faint)] mb-1 font-medium">Δ target</div>
            <input type="number" step={0.02} value={delta} onChange={e => setDelta(parseFloat(e.target.value) || 0)} className="w-full text-xs px-2 py-1" />
          </label>
          <label className="block">
            <div className="text-[10px] uppercase tracking-wider text-[var(--fg-faint)] mb-1 font-medium">wing $</div>
            <input type="number" step={1} value={wing} onChange={e => setWing(parseInt(e.target.value) || 5)} className="w-full text-xs px-2 py-1" />
          </label>
          <label className="block">
            <div className="text-[10px] uppercase tracking-wider text-[var(--fg-faint)] mb-1 font-medium">DTE</div>
            <input type="number" step={1} value={dte} onChange={e => setDte(parseInt(e.target.value) || 30)} className="w-full text-xs px-2 py-1" />
          </label>
          <button onClick={save} className="btn-primary py-1.5 px-3 text-xs font-bold">💾 save preset</button>
        </div>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="preset name (e.g. 'tight weekly IC')" className="w-full mt-3 text-xs px-2 py-1" />
      </Panel>

      <Panel title={`~presets · ${ticker} (${loading ? 'loading…' : presets.length})`}>
        {presets.length === 0 ? (
          <div className="text-center py-6 text-xs text-[var(--fg-faint)]">no presets for {ticker} yet. save one above.</div>
        ) : (
          <div className="space-y-2">
            {presets.map(p => (
              <div key={p.id} className="rounded border border-[var(--border)] bg-[var(--bg-3)]/30 p-2 flex items-center gap-3">
                <span className="text-2xl">{STRATEGIES[p.strategyId as StrategyId]?.meta.emoji ?? '?'}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-[var(--fg)]">{p.name}</div>
                  <div className="text-[10px] text-[var(--fg-faint)] truncate">
                    {p.strategyId} · Δ={p.params.delta?.toFixed(2) ?? '—'} · wing=${p.params.wingWidth ?? '—'} · {p.params.daysToExpiry ?? '—'}d · by {p.author}
                  </div>
                </div>
                <button onClick={() => remove(p.id)} className="text-[var(--fg-faint)] hover:text-[var(--red)] text-xs px-2">✕</button>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </>
  );
}

// ────────────────────────────────────────────────────── journal ──

function JournalPanel() {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [entries, setEntries] = useState<JournalEntry[]>([]);

  const generate = async () => {
    setLoading(true);
    setErr(null);
    try {
      const positions = loadPositions();
      if (!positions.length) {
        setErr('no positions in localStorage yet — open a paper position first');
        setEntries([]);
        return;
      }
      const res = await fetch('/api/journal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ positions }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'failed');
      setEntries(data.journal ?? []);
    } catch (e: any) {
      setErr(e.message ?? 'failed');
    } finally { setLoading(false); }
  };

  const downloadOne = (e: JournalEntry) => {
    const blob = new Blob([e.markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${e.ticker}-${e.strategyId}-${e.id}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <Panel title="~trade_journal · generate markdown for every paper position">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="text-xs text-[var(--fg-dim)]">
            pulls your localStorage paper positions, sends to <code>/api/journal</code>, renders markdown per trade.
            download any entry as <code>.md</code>.
          </div>
          <button onClick={generate} disabled={loading} className="btn-primary py-1.5 px-4 text-xs font-bold disabled:opacity-50">
            {loading ? '⟳ generating…' : '📓 generate journal'}
          </button>
        </div>
        {err && <div className="text-[11px] text-[var(--red)] mt-2">! {err}</div>}
      </Panel>

      {entries.length > 0 && (
        <Panel title={`~entries (${entries.length})`}>
          <div className="space-y-3">
            {entries.map(e => (
              <div key={e.id} className="rounded border border-[var(--border)] bg-[var(--bg-3)]/30 p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[11px] text-[var(--fg-faint)] uppercase tracking-wider">
                    {e.ticker} · {e.strategyId.replace(/_/g, ' ')} · {e.status} · {e.durationDays}d
                  </div>
                  <button onClick={() => downloadOne(e)} className="text-[10px] text-[var(--green)] hover:underline">↓ download .md</button>
                </div>
                <pre className="text-[11px] whitespace-pre-wrap font-mono text-[var(--fg)] leading-relaxed bg-[var(--bg-2)]/60 rounded p-3 overflow-x-auto">{e.markdown}</pre>
              </div>
            ))}
          </div>
        </Panel>
      )}
    </>
  );
}

// ────────────────────────────────────────────────────── chain ──

function ChainPanel() {
  const [symbol, setSymbol] = useState('AAPL');
  const [loading, setLoading] = useState(false);
  const [grid, setGrid] = useState<ChainGrid | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      const q = await fetch(`/api/quote/${encodeURIComponent(symbol)}`).then(r => r.json());
      if (!q.price) throw new Error('quote fetch failed');
      const res = await fetch('/api/chain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spot: q.price, realizedVol: q.realizedVol, dtes: [7, 14, 30, 60, 90] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'failed');
      setGrid(data.chain);
    } catch (e: any) {
      setErr(e.message ?? 'failed');
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [symbol]);

  const ividColor = (iv: number) => {
    if (!grid) return 'var(--fg-faint)';
    const range = grid.maxIv - grid.minIv || 1;
    const t = (iv - grid.minIv) / range;
    if (t > 0.7) return 'var(--red)';
    if (t > 0.3) return 'var(--yellow)';
    return 'var(--green)';
  };

  return (
    <Panel title={`~chain · synthetic strikes × DTE (live: '${symbol}')`}>
      <div className="flex items-center justify-between mb-3">
        <input value={symbol} onChange={e => setSymbol(e.target.value.toUpperCase())} className="uppercase tracking-wider text-xs px-2 py-1 w-32" />
        {grid && (
          <div className="text-[10px] text-[var(--fg-faint)]">
            spot ${grid.spot} · ATM IV {(grid.atmIv * 100).toFixed(1)}% · {grid.cells.length} cells · IV range [{grid.minIv.toFixed(0)}%–{grid.maxIv.toFixed(0)}%]
          </div>
        )}
      </div>
      {loading && <div className="text-xs text-[var(--fg-faint)]">building chain…</div>}
      {err && <div className="text-[11px] text-[var(--red)]">! {err}</div>}
      {grid && (
        <div className="overflow-x-auto">
          <table className="text-[10px] w-full border-collapse">
            <thead>
              <tr className="text-[var(--fg-faint)] text-[9px] uppercase tracking-wider">
                <th className="text-left px-2 py-1 border-b border-[var(--border)]">strike</th>
                {grid.dtes.map(d => <th key={d} colSpan={2} className="text-center px-2 py-1 border-b border-[var(--border)]">{d}d</th>)}
              </tr>
              <tr className="text-[var(--fg-faint)] text-[8px]">
                <th className="border-b border-[var(--border)]"></th>
                {grid.dtes.map(d => <Fragment key={d}><th className="px-1 py-0.5 border-b border-[var(--border)]">call</th><th className="px-1 py-0.5 border-b border-[var(--border)]">put</th></Fragment>)}
              </tr>
            </thead>
            <tbody>
              {Array.from(new Set(grid.cells.map(c => c.strike))).sort((a, b) => b - a).map(K => (
                <tr key={K}>
                  <td className="px-2 py-0.5 font-mono tabular-nums text-[var(--fg)] border-r border-[var(--border)]">${K.toFixed(2)}</td>
                  {grid.dtes.map(d => {
                    const c = grid.cells.find(c => c.strike === K && c.dte === d);
                    if (!c) return <Fragment key={d}><td colSpan={2}></td></Fragment>;
                    return (
                      <Fragment key={d}>
                        <td className="px-1 py-0.5 text-center tabular-nums" style={{ color: ividColor(c.iv) }}>${c.callPrice.toFixed(2)}</td>
                        <td className="px-1 py-0.5 text-center tabular-nums" style={{ color: ividColor(c.iv) }}>${c.putPrice.toFixed(2)}</td>
                      </Fragment>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

// ────────────────────────────────────────────────────── broker ──

function BrokerPanel() {
  const [info, setInfo] = useState<BrokerInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [ticker, setTicker] = useState('AAPL');
  const [chain, setChain] = useState<{ underlying: { price: number }; expirations: { dte: number; lastTrade: string }[]; chain: { strike: number; call: { mid: number }; put: { mid: number } }[] } | null>(null);

  const connect = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/broker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'connect' }),
      });
      const data = await res.json();
      setInfo({ mode: data.mode || 'stub', session: data.session, notice: data.notice });
    } finally { setLoading(false); }
  };

  const search = async () => {
    setChain(null);
    const res = await fetch(`/api/broker?ticker=${encodeURIComponent(ticker)}`);
    const data = await res.json();
    setChain(data);
  };

  return (
    <>
      <Panel title="~broker · IBKR-styled gateway (stub mode without BROKER_CLIENT_ID)">
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs text-[var(--fg-dim)]">
            this endpoint scaffolds IBKR's OAuth + chain flow. set <code className="text-[var(--green)]">BROKER_CLIENT_ID</code> + <code>REDIRECT_URI</code> env to switch to live mode.
          </div>
          <button onClick={connect} disabled={loading} className="btn-primary py-1.5 px-4 text-xs font-bold disabled:opacity-50">
            {loading ? '⟳ connecting…' : '🔌 connect'}
          </button>
        </div>
        {info && (
          <div className={`mt-3 rounded border p-3 text-xs ${
            info.mode === 'live' ? 'border-[var(--green-dim)] bg-[var(--green-faint)]/40' : 'border-[var(--yellow-dim)] bg-[var(--yellow-faint)]/40'
          }`}>
            <div className="font-bold uppercase tracking-wider mb-1">
              <Tag color={info.mode === 'live' ? 'green' : 'yellow'}>{info.mode}</Tag>
              {info.session && <span className="ml-2 text-[var(--fg)]">session {info.session.sessionId.slice(0, 14)}… · acct {info.session.accountId} · expires {info.session.expiresAt.slice(0, 16)}</span>}
            </div>
            <div className="text-[var(--fg-faint)]">{info.notice}</div>
          </div>
        )}
      </Panel>
      <Panel title="~chain.lookup · broker-style option search">
        <div className="flex items-center gap-2 mb-3">
          <input value={ticker} onChange={e => setTicker(e.target.value.toUpperCase())} placeholder="TICKER" className="uppercase tracking-wider text-xs px-2 py-1 w-32" />
          <button onClick={search} className="btn-primary px-3 py-1 text-xs">lookup</button>
        </div>
        {chain && (
          <>
            <div className="text-[10px] text-[var(--fg-faint)] mb-2">
              underlying ${chain.underlying.price.toFixed(2)} · {chain.expirations.length} expirations · {chain.chain.length} strikes
            </div>
            <div className="overflow-x-auto">
              <table className="text-[10px] w-full">
                <thead>
                  <tr className="text-[var(--fg-faint)] text-[9px] uppercase tracking-wider">
                    <th className="text-left px-2 py-1 border-b border-[var(--border)]">strike</th>
                    <th className="text-right px-2 py-1 border-b border-[var(--border)]">call mid</th>
                    <th className="text-right px-2 py-1 border-b border-[var(--border)]">put mid</th>
                  </tr>
                </thead>
                <tbody>
                  {chain.chain.map(c => (
                    <tr key={c.strike} className="hover:bg-[var(--bg-3)]/40">
                      <td className="px-2 py-0.5 font-mono tabular-nums">${c.strike}</td>
                      <td className="px-2 py-0.5 text-right tabular-nums text-[var(--green)]">${c.call.mid.toFixed(2)}</td>
                      <td className="px-2 py-0.5 text-right tabular-nums text-[var(--red)]">${c.put.mid.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Panel>
    </>
  );
}
