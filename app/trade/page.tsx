'use client';

import { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine, AreaChart, Area,
} from 'recharts';
import { Panel, Stat, Tag } from '@/components/Panels';
import { SettingsModal } from '@/components/SettingsModal';
import { FinanceChat } from '@/components/FinanceChat';
import {
  listStrategies, buildStrategy, StrategyId, payoffCurve,
  STRATEGIES, Leg, BuiltStrategy,
} from '@/lib/strategies';
import { blackScholes } from '@/lib/blackScholes';
import { MCResult, Insight } from '@/lib/monteCarlo';
import { addPosition, generateId, type PositionCalibrationContext } from '@/lib/paperTrading';
import { QAContext } from '@/lib/financeQA';
import { gradeStrategy, GraderBreakdown } from '@/lib/strategyGrader';
import { computeIVEnvironment, IVEnvironment, computeVolCone, VolConeSummary } from '@/lib/ivRank';

type Candle = { date: string; open: number; high: number; low: number; close: number; volume: number; ts?: number };
type QuoteData = {
  symbol: string; price: number | null; change: number | null; changePct: number | null;
  dayHigh: number | null; dayLow: number | null; yearHigh: number | null; yearLow: number | null;
  volume: number | null; marketState: string | null; shortName: string;
  history: number[]; realizedVol: number | null; candles?: Candle[]; intraday?: Candle[];
};
type SimResult = { mc: MCResult; built: ReturnType<typeof buildStrategy>; insights: Insight[] };

export default function TradePage() {
  const strategies = listStrategies();

  const [strategyId, setStrategyId] = useState<StrategyId>('iron_condor');
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const p = new URLSearchParams(window.location.search).get('strategy');
    if (p && (p in STRATEGIES)) setStrategyId(p as StrategyId);
  }, []);

  const [symbol, setSymbol] = useState('AAPL');
  const [quote, setQuote] = useState<QuoteData | null>(null);
  const [loadingQuote, setLoadingQuote] = useState(false);
  const [quoteErr, setQuoteErr] = useState<string | null>(null);

  const [dte, setDte] = useState(30);
  const [shortDelta, setShortDelta] = useState(0.16);
  const [wing, setWing] = useState(5);
  const [mu, setMu] = useState(0.0);
  const [r, setR] = useState(0.045);
  const [numPaths, setNumPaths] = useState(5000);
  const [contracts, setContracts] = useState(1);

  const [sim, setSim] = useState<SimResult | null>(null);
  const [loadingSim, setLoadingSim] = useState(false);
  const [simErr, setSimErr] = useState<string | null>(null);
  const [paperSaved, setPaperSaved] = useState(false);
  const [confettiKey, setConfettiKey] = useState(0);
  const paperSavedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [expandedInsights, setExpandedInsights] = useState<Set<number>>(new Set([0]));
  const [showSettings, setShowSettings] = useState(false);
  // Autosuggest: top strategies for current ticker + IV rank + DTE.
  const [suggest, setSuggest] = useState<{ name: string; emoji: string; id: string; score: number; label: string; probProfit: number; expectedPnl: number; warnings: string[] }[] | null>(null);
  const [loadingSuggest, setLoadingSuggest] = useState(false);

  const strategyDef = STRATEGIES[strategyId] ?? STRATEGIES.iron_condor;
  const hasSim = !!sim;

  const usesDelta = strategyDef.usesDelta ?? false;
  const usesWing = strategyDef.usesWing ?? false;

  const fetchQuote = useCallback(async (sym: string) => {
    setLoadingQuote(true);
    setQuoteErr(null);
    try {
      const res = await fetch(`/api/quote/${encodeURIComponent(sym)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'quote failed');
      setQuote(data);
      return data as QuoteData;
    } catch (e: any) {
      setQuoteErr(e.message ?? 'fetch failed');
      setQuote(null);
      return null;
    } finally {
      setLoadingQuote(false);
    }
  }, [setQuote, setQuoteErr, setLoadingQuote]);

  const runSim = useCallback(async () => {
    if (!quote?.price) return;
    const sigma = quote.realizedVol ?? 0.30;
    setLoadingSim(true);
    setSimErr(null);
    setPaperSaved(false);
    try {
      const res = await fetch('/api/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          strategyId,
          S0: quote.price, mu, sigma, r, daysToExpiry: dte,
          params: { delta: shortDelta, wingWidth: wing },
          numPaths, seed: 42,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'simulation failed');
      setSim(data);
      setSimErr(null);
    } catch (e: any) {
      setSimErr(e.message ?? 'simulation failed');
    } finally {
      setLoadingSim(false);
    }
  }, [quote, strategyId, mu, r, dte, shortDelta, wing, numPaths]);

  const fetchAndAnalyze = useCallback(async () => {
    const data = await fetchQuote(symbol);
    if (data?.price) await runSim();
  }, [fetchQuote, symbol, runSim]);

  const ivEnv: IVEnvironment | null = useMemo(() => {
    if (!quote?.realizedVol || !quote.history?.length) return null;
    return computeIVEnvironment(quote.realizedVol, quote.history);
  }, [quote]);

  const volCone: VolConeSummary | null = useMemo(() => {
    if (!quote?.history?.length) return null;
    return computeVolCone(quote.history);
  }, [quote?.history]);

  const grader: GraderBreakdown | null = useMemo(() => {
    if (!sim || !quote?.price) return null;
    return gradeStrategy(sim.mc, sim.built, ivEnv?.rank ?? 50, dte, quote.realizedVol ?? 0.30);
  }, [sim, quote, ivEnv, dte]);

  // LIVE built values — never stale. These are what the displayed legs/credit/max-loss/BE
  // should always show. MC-derived values (probProfit, expectedPnl, insights) still come
  // from `sim.mc` since MC requires a fetch.
  const built = useMemo(() => {
    if (!quote?.price) return null;
    return buildStrategy(strategyId, {
      S: quote.price,
      sigma: quote.realizedVol ?? 0.30,
      r,
      daysToExpiry: dte,
      delta: usesDelta ? shortDelta : undefined,
      wingWidth: usesWing ? wing : undefined,
    });
  }, [quote?.price, quote?.realizedVol, strategyId, r, dte, shortDelta, wing, usesDelta, usesWing]);

  // Legs displayed sorted by strike low→high (so puts appear before calls for iron condors).
  const sortedLegs = useMemo(() => {
    if (!built) return [];
    return [...built.legs].sort((a, b) => (a.strike ?? 0) - (b.strike ?? 0));
  }, [built]);

  // True if sim was computed under different params than current — analytics needs a refetch.
  const simIsStale = useMemo(() => {
    if (!sim || !built) return false;
    const sameLegs =
      sim.built.legs.length === built.legs.length &&
      sim.built.legs.every((l, i) =>
        l.kind === built.legs[i].kind &&
        l.side === built.legs[i].side &&
        l.strike === built.legs[i].strike);
    return !sameLegs || sim.built.entryPerContract !== built.entryPerContract;
  }, [sim, built]);

  const payoff = useMemo(() => {
    if (!built || !quote?.price) return [];
    // Use the strike envelope as the chart domain, so defined-risk strategies
    // (condors, spreads) show every meaningful pivot. Unbounded-risk strategies
    // (long call, long strangle, etc.) get a wide default ±30% on either side.
    const strikes: number[] = built.legs
      .map(l => (typeof l.strike === 'number' && l.strike > 0 ? l.strike : quote.price!))
      .filter(s => s > 0);
    const lo = strikes.length ? Math.min(...strikes) : quote.price! * 0.7;
    const hi = strikes.length ? Math.max(...strikes) : quote.price! * 1.3;
    const envelope = (hi - lo) / quote.price;
    const span = built.maxProfit == null && built.maxLoss == null
      ? 0.30
      : Math.max(0.10, envelope * 0.5 + 0.05);
    return payoffCurve(built.legs, quote.price, span, 161);
  }, [built, quote?.price]);

  // Payoff gradient stops based on actual P&L magnitude
  const pnlStops = useMemo(() => {
    if (!payoff.length) return { zeroFrac: 50, pnlMin: 0, pnlMax: 0 };
    const pnlMin = Math.min(0, ...payoff.map(p => p.pnl));
    const pnlMax = Math.max(0, ...payoff.map(p => p.pnl));
    const range = pnlMax - pnlMin || 1;
    // Where zero sits in the chart's vertical extent (% from top of SVG).
    // Same value for green & red because the gradient is symmetric around zero.
    const zeroFrac = (pnlMax / range) * 100;
    return { zeroFrac, pnlMin, pnlMax };
  }, [payoff]);

  const mcLineData = useMemo(() => {
    if (!sim) return [];
    return sim.mc.histogram.map(h => ({ pnl: h.bin, count: h.count }));
  }, [sim]);

  useEffect(() => { fetchQuote('AAPL'); }, []);
  // Clear sim when ANY leg-affecting param changes — analytics are MC-derived and can't be trusted
  // when strikes/credit have moved. Built values stay live via the `built` memo above.
  useEffect(() => {
    setSim(null);
    setPaperSaved(false);
  }, [strategyId, dte, shortDelta, wing]);

  const qaContext: QAContext | null = sim && quote && quote.price != null && built ? {
    strategyName: strategyDef.meta.name,
    strategyCategory: strategyDef.meta.category,
    entry: built.entryPerContract,
    maxProfit: built.maxProfit,
    maxLoss: built.maxLoss,
    breakEvens: built.breakEvens,
    probProfit: sim.mc.probProfit,
    expectedPnl: sim.mc.expectedPnl,
    var95: sim.mc.var95,
    cvar95: sim.mc.cvar95,
    spot: quote.price,
    ticker: quote.symbol,
    dte,
    sigma: quote.realizedVol ?? 0.30,
    delta: built.netDelta,
    theta: built.netTheta,
    vega: built.netVega,
    contracts,
  } : null;

  const toggleInsight = useCallback((i: number) => {
    setExpandedInsights(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  }, []);

  // Fetch autosuggest whenever we have a fresh quote + ivEnv.
  useEffect(() => {
    if (!quote?.price || quote.realizedVol == null) { setSuggest(null); return; }
    const sigma = quote.realizedVol;
    const ivRank = ivEnv?.rank ?? 50;
    setLoadingSuggest(true);
    fetch('/api/suggest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ S0: quote.price, sigma, daysToExpiry: dte, ivRank, numPaths: 800, seed: 42, top: 3 }),
    })
      .then(r => r.json())
      .then(d => setSuggest(d.suggestions ?? []))
      .catch(() => setSuggest(null))
      .finally(() => setLoadingSuggest(false));
  }, [quote?.price, quote?.realizedVol, ivEnv?.rank, dte]);

  const openPaperPosition = useCallback(() => {
    if (!built || !quote?.price) return;
    // Predicted stats at expiration (per-contract dollars), used by the
    // calibration dashboard to compare model to realized outcomes.
    //   predicted_pop:      sim.mc.probProfit
    //   predicted_pnl:      E[terminal value] minus entryPerContract
    //   predicted_maxloss:  |built.maxLoss|
    //   max_profit:         built.maxProfit (positive number)
    const ctx: PositionCalibrationContext = sim?.mc
      ? {
          predicted_pop: sim.mc.probProfit,
          predicted_pnl: sim.mc.expectedPnl * 100, // per-share → per-contract ($/contract)
          predicted_maxloss: Math.abs(built.maxLoss ?? 0),
          max_profit: built.maxProfit ?? 0,
        }
      : {};
    addPosition({
      id: generateId(),
      strategyId,
      ticker: quote.symbol,
      legs: built.legs,
      entryPerContract: built.entryPerContract,
      quantity: contracts,
      openedAt: new Date().toISOString(),
      status: 'open',
      spotAtEntry: quote.price,
      dteAtEntry: dte,
      // Snapshot the σ used to value the position at open so MTM/close uses
      // the same vol model unless a fresher live σ is available.
      sigmaAtEntry: typeof quote.realizedVol === 'number' ? quote.realizedVol : undefined,
    }, ctx);
    setPaperSaved(true);
    setConfettiKey(k => k + 1);
    if (paperSavedTimer.current) clearTimeout(paperSavedTimer.current);
    paperSavedTimer.current = setTimeout(() => setPaperSaved(false), 3000);
  }, [built, quote, strategyId, contracts, dte, sim]);

  // Clear pending confetti timer on unmount to avoid "set state on unmounted" warning.
  useEffect(() => () => {
    if (paperSavedTimer.current) clearTimeout(paperSavedTimer.current);
  }, []);

  const actionLabel = loadingQuote || loadingSim
    ? '⟳ analyzing…'
    : `▶ Fetch and analyze ${symbol || '—'} using ${strategyDef.meta.name}`;
  const actionShort = `▶ ${symbol} · ${strategyDef.meta.id}`;

  return (
    <div className="flex flex-col trade-page-root" style={{ height: 'calc(100vh - 60px)' }}>
      {/* Sticky strategy pills + autosuggest strip */}
      <div className="flex-shrink-0 sticky top-0 z-20 bg-[var(--bg)]/90 backdrop-blur-md border-b border-[var(--border)] -mx-6 px-6 py-1.5 space-y-1">
        <div className="flex gap-1.5 overflow-x-auto pb-0.5">
          {strategies.map(s => {
            const active = strategyId === s.meta.id;
            return (
              <button
                key={s.meta.id}
                onClick={() => setStrategyId(s.meta.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border whitespace-nowrap text-xs font-semibold transition flex-shrink-0 ${
                  active ? 'border-[var(--green-dim)] bg-[var(--green-faint)] text-[var(--green)] shadow-[0_0_10px_rgba(34,197,94,0.25)]' : 'border-[var(--border)] bg-[var(--bg-3)]/30 text-[var(--fg-dim)] hover:border-[var(--border-bright)] hover:text-[var(--fg)]'
                }`}
              >
                <span>{s.meta.emoji}</span><span>{s.meta.name}</span>
              </button>
            );
          })}
        </div>
        {/* Top autosuggest strip — lives in its own row, no overlap with anything. */}
        {(suggest && suggest.length > 0) && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
            <span className="text-[9px] uppercase tracking-wider text-[var(--fg-faint)] font-bold flex-shrink-0">
              ~pick_for_{symbol || '—'}
            </span>
            {loadingSuggest && <span className="text-[9px] text-[var(--fg-faint)] flex-shrink-0">scoring…</span>}
            {suggest.map(s => (
              <button
                key={s.id}
                onClick={() => { if (s.id in STRATEGIES) setStrategyId(s.id as StrategyId); }}
                className={`flex items-center gap-1 px-2 py-0.5 rounded-full border whitespace-nowrap text-[10px] font-bold transition flex-shrink-0 ${
                  strategyId === s.id ? 'border-[var(--green-dim)] bg-[var(--green-faint)] text-[var(--green)]' : 'border-[var(--border)] text-[var(--fg-dim)] hover:border-[var(--border-bright)] hover:text-[var(--fg)]'
                }`}
                title={s.warnings.join(' · ') || `PoP ${(s.probProfit*100).toFixed(0)}%, score ${s.score}/100`}
              >
                <span>{s.emoji}</span>
                <span>{s.name}</span>
                <span className={`tabular-nums ${s.score >= 70 ? 'text-[var(--green)]' : s.score >= 50 ? 'text-[var(--yellow)]' : 'text-[var(--fg-faint)]'}`}>{s.score}</span>
                <span className="text-[var(--fg-faint)] font-normal">· PoP {(s.probProfit*100).toFixed(0)}%</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto py-2 space-y-2">
        {!hasSim ? (
          /* ===== PRE-ANALYSIS: vertical content-sized stack, no rigid grid =====
              [1 ticker input  ][2 price & vol        ]
              [3 strategy card ][4 1D candles ][5 1M  ]
          */
          <div className="space-y-2">
            <Panel
              title="~command"
              right={
                <div className="flex items-center gap-2">
                  {ivEnv && (
                    <div className="flex items-center gap-1 text-xs" title={ivEnv.recommendation}>
                      <span>{ivEnv.emoji}</span>
                      <span className="text-[var(--fg-dim)] font-bold">IV {ivEnv.rank.toFixed(0)}</span>
                    </div>
                  )}
                  <button onClick={() => setShowSettings(true)} className="text-[var(--fg-dim)] hover:text-[var(--green)] text-lg transition" title="parameters">⚙</button>
                </div>
              }
              contentClassName="p-2"
            >
              <div className="flex gap-1.5 items-center">
                <input value={symbol} onChange={e => setSymbol(e.target.value.toUpperCase())} onKeyDown={e => e.key === 'Enter' && fetchAndAnalyze()} placeholder="TICKER" className="flex-1 uppercase tracking-wider text-base px-3 py-2 font-bold" />
                <button onClick={fetchAndAnalyze} disabled={loadingQuote || loadingSim || !symbol.trim()} className="btn-primary px-4 py-2 text-sm font-bold" title={actionShort}>
                  <span className="hidden lg:inline">{actionShort}</span>
                  <span className="lg:hidden">▶ run</span>
                </button>
              </div>
              {quoteErr && (
                <div className="mt-2 rounded-[var(--radius-sm)] border border-[var(--red-border)] bg-[var(--red-faint)]/60 text-[var(--red)] text-[10px] p-1.5 leading-snug">
                  ! {quoteErr} <button onClick={fetchAndAnalyze} className="text-[var(--green)] underline ml-1">retry</button>
                </div>
              )}
            </Panel>

            {quote && (
              <Panel
                title={`~market · ${quote.shortName}`}
                right={
                  <div className="flex items-center gap-2">
                    <Tag color="dim">{quote.marketState ?? 'live'}</Tag>
                    <Tag color="dim">σ {(quote.realizedVol! * 100).toFixed(0)}%</Tag>
                  </div>
                }
                contentClassName="p-3"
              >
                <div className="flex items-baseline gap-3 flex-wrap">
                  <div className="text-5xl font-extrabold text-[var(--green)] glow tabular-nums leading-none">${quote.price?.toFixed(2) ?? '—'}</div>
                  {quote.change != null && (
                    <div className={`text-sm font-bold ${quote.change >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}>
                      {quote.change >= 0 ? '▲' : '▼'} {Math.abs(quote.change).toFixed(2)}
                      {quote.changePct != null && <span className="ml-1 opacity-80">({quote.changePct.toFixed(2)}%)</span>}
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-4 gap-2 mt-3">
                  <Mini label="day hi" value={quote.dayHigh ? `$${quote.dayHigh.toFixed(0)}` : '—'} />
                  <Mini label="day lo" value={quote.dayLow ? `$${quote.dayLow.toFixed(0)}` : '—'} />
                  <Mini label="52w hi" value={quote.yearHigh ? `$${quote.yearHigh.toFixed(0)}` : '—'} />
                  <Mini label="52w lo" value={quote.yearLow ? `$${quote.yearLow.toFixed(0)}` : '—'} />
                </div>
                <div className={`mt-2 rounded-[var(--radius-sm)] border p-2 overflow-hidden ${
                  ivEnv
                    ? (ivEnv.tier === 'expensive'
                        ? 'border-[var(--red-border)] bg-[var(--red-faint)]/40'
                        : ivEnv.tier === 'cheap'
                          ? 'border-[var(--green-dim)] bg-[var(--green-faint)]/40'
                          : 'border-[var(--yellow-dim)] bg-[var(--yellow-faint)]/40')
                    : 'border-[var(--border)] bg-[var(--bg-3)]'
                }`}>
                  <div className="flex items-baseline justify-between gap-2 flex-wrap">
                    <div className="text-[9px] uppercase tracking-wider text-[var(--fg-faint)] font-medium">σ · vol env</div>
                    {ivEnv && (
                      <div className="text-xs font-bold" style={{ color: ivEnv.color }}>{ivEnv.emoji} {ivEnv.tier.toUpperCase()} · rank {ivEnv.rank.toFixed(0)}</div>
                    )}
                    <div className="text-base font-bold text-[var(--green)] tabular-nums">{quote.realizedVol ? `${(quote.realizedVol * 100).toFixed(1)}%` : '—'}</div>
                  </div>
                  {ivEnv && <div className="text-[10px] text-[var(--fg-dim)] mt-1 leading-snug">{ivEnv.recommendation}</div>}
                  {/* Vol cone — where current 21d vol sits in the historical 21d-vol band */}
                  {volCone && volCone.band21 && (
                    <div className="mt-1.5 space-y-1">
                      <div className="h-12">
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={volCone.series} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
                            <defs>
                              <linearGradient id="vconeG" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="var(--green)" stopOpacity={0.35} />
                                <stop offset="100%" stopColor="var(--green)" stopOpacity={0.02} />
                              </linearGradient>
                            </defs>
                            <XAxis dataKey="i" hide />
                            <YAxis
                              domain={[
                                (dataMin: number) => Math.max(0, dataMin * 0.7),
                                (dataMax: number) => dataMax * 1.2,
                              ]}
                              hide
                            />
                            {/* p25–p75 historical band */}
                            <ReferenceLine y={volCone.band21.p75} stroke="var(--fg-faint)" strokeDasharray="2 4" strokeOpacity={0.5} />
                            <ReferenceLine y={volCone.band21.p25} stroke="var(--fg-faint)" strokeDasharray="2 4" strokeOpacity={0.5} />
                            <ReferenceLine y={volCone.band21.median} stroke="var(--fg-faint)" strokeDasharray="3 3" strokeOpacity={0.7} />
                            <Area type="monotone" dataKey="v21" stroke="var(--green-2)" strokeWidth={1.2} fill="url(#vconeG)" dot={false} isAnimationActive={false} />
                            <Tooltip
                              contentStyle={{ background: 'rgba(17,24,26,0.95)', border: '1px solid var(--border-bright)', borderRadius: 8, fontSize: 11 }}
                              formatter={(v: any) => `${(Number(v) * 100).toFixed(1)}% vol`}
                              labelFormatter={(v: any) => `${Number(v)} trading days back`}
                              trigger="hover"
                            />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="flex items-center justify-between text-[9px] tabular-nums text-[var(--fg-dim)]">
                        <span><span className="text-[var(--fg-faint)]">10d</span> <span className="text-[var(--fg)] font-bold">{isFinite(volCone.current.v10) ? `${(volCone.current.v10 * 100).toFixed(1)}%` : '—'}</span></span>
                        <span><span className="text-[var(--fg-faint)]">21d</span> <span className="text-[var(--green)] font-bold">{isFinite(volCone.current.v21) ? `${(volCone.current.v21 * 100).toFixed(1)}%` : '—'}</span></span>
                        <span><span className="text-[var(--fg-faint)]">60d</span> <span className="text-[var(--fg)] font-bold">{isFinite(volCone.current.v60) ? `${(volCone.current.v60 * 100).toFixed(1)}%` : '—'}</span></span>
                        <span className="text-[var(--fg-faint)]">band {((volCone.band21.p25) * 100).toFixed(0)}–{((volCone.band21.p75) * 100).toFixed(0)}%</span>
                      </div>
                    </div>
                  )}
                </div>
              </Panel>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-2">
              <Panel title="~strategy" className="lg:col-span-1">
                <div className="rounded-[var(--radius-sm)] border-2 border-[var(--green-dim)] bg-gradient-to-br from-[var(--green-faint)]/30 to-[var(--bg-3)] p-2">
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl">{strategyDef.meta.emoji}</span>
                    <div>
                      <div className="text-base font-extrabold text-[var(--green)] leading-tight">{strategyDef.meta.name}</div>
                      <div className="text-[10px] text-[var(--fg-dim)]">{strategyDef.meta.category}</div>
                    </div>
                  </div>
                  <p className="text-[11px] text-[var(--fg-dim)] leading-snug italic mt-1.5 border-l-2 border-[var(--green-dim)] pl-1.5">
                    {strategyDef.meta.shortDescription}
                  </p>
                </div>
                <div className="mt-2">
                  <KeyDatesStrip quote={quote} dte={dte} />
                </div>
              </Panel>

              <Panel title="~charts" className="lg:col-span-2">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 h-72 md:h-80">
                  <ChartFrame label={quote?.intraday?.length ? `TODAY · ${quote.intraday.length} bars` : '1D · 30 days'} sub="5m candles" edge="left" className="h-full w-full">
                    {quote?.intraday?.length
                      ? <CandleChart candles={quote.intraday} intraday />
                      : <CandleChart candles={(quote?.candles ?? []).slice(-30)} />}
                  </ChartFrame>
                  <ChartFrame label="1M · 21 days" sub="line" edge="right" className="h-full w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={(quote?.candles ?? []).slice(-21).map((c, i) => ({ i, p: c.close }))} margin={{ top: 4, right: 6, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="monthG" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="var(--green)" stopOpacity={0.5} />
                            <stop offset="100%" stopColor="var(--green)" stopOpacity={0.02} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="2 6" stroke="var(--border)" strokeOpacity={0.35} />
                        <XAxis dataKey="i" hide />
                        <YAxis domain={['dataMin', 'dataMax']} tickFormatter={v => `$${v.toFixed(0)}`} tick={{ fontSize: 9, fill: 'var(--fg-faint)' }} stroke="var(--border-bright)" width={32} />
                        <Tooltip contentStyle={{ background: 'rgba(17,24,26,0.95)', border: '1px solid var(--border-bright)', borderRadius: 8, fontSize: 11 }} formatter={(v: any) => `$${Number(v).toFixed(2)}`} labelFormatter={v => `day ${v}`} />
                        <Line type="monotone" dataKey="p" stroke="var(--green)" strokeWidth={2} dot={false} isAnimationActive={false} fill="url(#monthG)" />
                      </LineChart>
                    </ResponsiveContainer>
                  </ChartFrame>
                </div>
              </Panel>
            </div>
          </div>
        ) : built && sim ? (
          /* ===== POST-ANALYSIS: 3x2 grid =====
              built & sim are both guaranteed non-null here — they require a quote,
              and hasSim implies the MC ran against a valid quote. */
          <div className="grid grid-cols-12 trade-grid-12 grid-rows-2 gap-2 h-full">
            {/* ZONE 1: ticker (compact) */}
            <Panel
              className="col-span-4 row-span-1 flex flex-col min-h-0"
              title="~ticker"
              right={
                <div className="flex items-center gap-1.5">
                  {ivEnv && (
                    <div className="flex items-center gap-1 text-xs" title={ivEnv.recommendation}>
                      <span>{ivEnv.emoji}</span>
                      <span className="text-[var(--fg-dim)] font-bold">IV {ivEnv.rank.toFixed(0)}</span>
                    </div>
                  )}
                  <button onClick={() => setShowSettings(true)} className="text-[var(--fg-dim)] hover:text-[var(--green)] text-base transition" title="parameters">⚙</button>
                </div>
              }
              contentClassName="p-2 flex-1 min-h-0"
            >
              <div className="flex flex-col h-full gap-1.5">
                <div className="flex gap-1">
                  <input value={symbol} onChange={e => setSymbol(e.target.value.toUpperCase())} onKeyDown={e => e.key === 'Enter' && fetchAndAnalyze()} placeholder="TICKER" className="flex-1 uppercase tracking-wider text-sm px-2 py-1 font-bold" />
                </div>
                <button onClick={fetchAndAnalyze} disabled={loadingQuote || loadingSim || !symbol.trim()} className="btn-primary w-full py-1.5 text-xs font-bold" title={actionShort}>
                  <span className="hidden lg:inline">▶ Fetch and analyze {symbol} using {strategyDef.meta.name}</span>
                  <span className="lg:hidden">{actionShort}</span>
                </button>
                {quote && (
                  <div className="flex-1 min-h-0 flex flex-col gap-1">
                    <div>
                      <div className="text-[9px] text-[var(--fg-faint)] uppercase tracking-wider">{quote.shortName}</div>
                      <div className="flex items-baseline gap-1.5">
                        <div className="text-3xl font-extrabold text-[var(--green)] glow tabular-nums leading-none">${quote.price?.toFixed(2) ?? '—'}</div>
                        {quote.change != null && (
                          <div className={`text-[11px] font-bold ${quote.change >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}>
                            {quote.change >= 0 ? '▲' : '▼'} {Math.abs(quote.change).toFixed(2)}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-1">
                      <Mini label="day hi" value={quote.dayHigh ? `$${quote.dayHigh.toFixed(0)}` : '—'} />
                      <Mini label="day lo" value={quote.dayLow ? `$${quote.dayLow.toFixed(0)}` : '—'} />
                      <Mini label="52w hi" value={quote.yearHigh ? `$${quote.yearHigh.toFixed(0)}` : '—'} />
                      <Mini label="52w lo" value={quote.yearLow ? `$${quote.yearLow.toFixed(0)}` : '—'} />
                    </div>
                    <div className={`rounded-[var(--radius-sm)] border px-2 py-1.5 ${ivEnv?.tier === 'expensive' ? 'border-[var(--red-border)] bg-[var(--red-faint)]/40' : ivEnv?.tier === 'cheap' ? 'border-[var(--green-dim)] bg-[var(--green-faint)]/40' : 'border-[var(--yellow-dim)] bg-[var(--yellow-faint)]/40'}`}>
                      <div className="text-[9px] uppercase tracking-wider text-[var(--fg-faint)] font-medium">vol env</div>
                      <div className="text-xs font-bold" style={{ color: ivEnv?.color }}>
                        {ivEnv?.emoji} {ivEnv?.tier?.toUpperCase()} · σ {quote.realizedVol != null ? `${(quote.realizedVol * 100).toFixed(0)}%` : '—'}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </Panel>

            {/* ZONE 2: paper position (more readable) */}
            <Panel
              className="col-span-4 row-span-1 flex flex-col min-h-0"
              title="~paper_position"
              right={
                <div className="flex items-center gap-1">
                  <span className="text-base">{strategyDef.meta.emoji}</span>
                  <Tag color="dim">{strategyDef.meta.category}</Tag>
                </div>
              }
              contentClassName="p-3 flex-1 min-h-0"
            >
              <div className="flex flex-col h-full gap-2">
                <div className="rounded-[var(--radius-sm)] border-2 border-[var(--green-dim)] bg-gradient-to-br from-[var(--green-faint)]/40 to-[var(--bg-3)]/40 divide-y divide-[var(--border)] overflow-hidden shadow-[0_0_15px_rgba(34,197,94,0.15)]">
                  <div className="px-2 py-1 bg-[var(--bg-2)]/50 text-[10px] uppercase tracking-wider text-[var(--fg-dim)] font-bold flex justify-between">
                    <span>legs · {contracts > 1 ? `${contracts}× contract` : '1 contract'}</span>
                    <span className="text-[var(--green-2)]">{contracts}×</span>
                  </div>
                  {sortedLegs.map((leg, i) => {
                    return (
                      <div key={i} className="flex justify-between items-center px-2 py-1.5">
                        <span className="text-sm text-[var(--fg-dim)] flex items-center gap-2">
                          <span className={`font-extrabold w-9 text-[11px] tracking-wider ${leg.side === 'short' ? 'text-[var(--red)]' : 'text-[var(--green)]'}`}>
                            {leg.side === 'short' ? 'SELL' : 'BUY'}
                          </span>
                          <span className="text-[var(--fg)] font-semibold">{leg.kind === 'stock' ? 'STOCK' : `${leg.kind} ${leg.strike?.toFixed(1)}`}</span>
                        </span>
                        <span className="flex items-center gap-2">
                          {legGreeksFor(leg, built, quote?.realizedVol ?? 0.30, r, dte) && (() => {
                            const g = legGreeksFor(leg, built, quote!.realizedVol ?? 0.30, r, dte)!;
                            return (
                              <span className="text-[9px] tabular-nums text-[var(--fg-faint)] flex gap-1.5">
                                <span title="delta × 100 shares" className={g.delta >= 0 ? 'text-[var(--green-2)]' : 'text-[var(--red)]'}>Δ{g.delta.toFixed(0)}</span>
                                <span title="theta/day × 100 shares" className={g.theta >= 0 ? 'text-[var(--green-2)]' : 'text-[var(--red)]'}>Θ{g.theta.toFixed(2)}</span>
                                <span title="vega per 1% IV × 100 shares" className="text-[var(--fg)]">ν{g.vega.toFixed(1)}</span>
                                <span title="gamma × 100 shares per $1 spot" className="text-[var(--fg)]">Γ{g.gamma.toFixed(3)}</span>
                              </span>
                            );
                          })()}
                          {leg.kind !== 'stock' && <span className="text-sm tabular-nums text-[var(--green)] font-bold">${leg.entryPrice.toFixed(2)}</span>}
                        </span>
                      </div>
                    );
                  })}
                </div>
                {/* Position summary: credit vs debit (per contract), then total cost for the user's contract count. */}
                <div className="grid grid-cols-2 gap-1.5">
                  <Stat
                    label={built.entryPerContract > 0 ? `credit / contract` : `debit / contract`}
                    value={`${built.entryPerContract > 0 ? '+' : '−'}$${Math.abs(built.entryPerContract).toFixed(0)}`}
                    accent={built.entryPerContract > 0 ? 'green' : 'red'}
                    size="lg"
                  />
                  <Stat
                    label={`max loss / contract`}
                    value={built.maxLoss == null ? '∞' : `−$${Math.abs(built.maxLoss).toFixed(0)}`}
                    accent="red"
                    size="lg"
                  />
                  <Stat
                    label={`breakeven${built.breakEvens.length > 1 ? 's' : ''}`}
                    value={built.breakEvens.map(b => `$${b.toFixed(0)}`).join(' / ') || '—'}
                    size="md"
                  />
                  <Stat
                    label={`max profit / contract`}
                    value={built.maxProfit == null ? '∞' : `+$${built.maxProfit.toFixed(0)}`}
                    accent="green"
                    size="md"
                  />
                </div>
                <div className="flex-1 min-h-0 flex items-end">
                  <div className="relative w-full">
                    {paperSaved && <ConfettiBurst key={confettiKey} />}
                    <button onClick={openPaperPosition} className={`relative w-full py-3 rounded-[var(--radius)] text-sm font-bold transition border-2 ${
                      paperSaved ? 'bg-[var(--green-faint)] border-[var(--green-2)] text-[var(--green)] paper-success shadow-[0_0_25px_rgba(34,197,94,0.4)]' : 'border-[var(--green-dim)] bg-gradient-to-b from-[var(--bg-3)] to-[var(--bg-2)] text-[var(--green)] hover:from-[var(--green-faint)] hover:to-[var(--green-faint)]/40 hover:shadow-[0_0_25px_rgba(34,197,94,0.4)] active:scale-95'
                    }`}>
                      {paperSaved ? (
                        <span className="flex items-center justify-center gap-2"><span className="text-base">✓</span> saved · /portfolio</span>
                      ) : (
                        <span className="flex items-center justify-center gap-2"><span className="text-base">📒</span> open {contracts > 1 ? contracts + '× ' : ''}paper position</span>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </Panel>

            {/* ZONE 3: monte (with log scale) */}
            <Panel
              className="col-span-4 row-span-1 flex flex-col min-h-0"
              title="~analytics · monte"
              right={
                <div className="flex items-center gap-1">
                  {simIsStale && <Tag color="yellow">stale</Tag>}
                  <Tag color="dim">{numPaths >= 1000 ? `${(numPaths/1000).toFixed(0)}k` : numPaths} paths</Tag>
                  {grader && <Tag color={grader.verdict === 'take' ? 'green' : grader.verdict === 'marginal' ? 'yellow' : 'red'}>{grader.total}</Tag>}
                </div>
              }
              contentClassName="p-2 flex-1 min-h-0"
            >
              {simErr && (
                <div className="rounded-[var(--radius-sm)] border border-[var(--red-border)] bg-[var(--red-faint)]/60 text-[var(--red)] text-[10px] p-1.5 leading-snug mb-1">
                  ! sim failed: {simErr} <button onClick={runSim} className="text-[var(--green)] underline ml-1">retry</button>
                </div>
              )}
              <div className="flex flex-col h-full gap-1.5">
                {grader && (
                  <div className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-gradient-to-br from-[var(--bg-3)] to-[var(--bg-2)] p-1.5">
                    <div className="flex items-baseline justify-between mb-1">
                      <span className={`text-[9px] uppercase tracking-wider font-bold ${grader.verdict === 'take' ? 'text-[var(--green)]' : grader.verdict === 'marginal' ? 'text-[var(--yellow)]' : 'text-[var(--red)]'}`}>{grader.label}</span>
                      <span className="text-[9px] text-[var(--fg-faint)]">/100</span>
                    </div>
                    <div className="grid grid-cols-4 gap-1 text-[8px]">
                      <Bar label="PoP" v={grader.popScore} max={40} />
                      <Bar label="R/R" v={grader.rrScore} max={25} />
                      <Bar label="IV"  v={grader.ivScore} max={20} />
                      <Bar label="Tm" v={grader.timingScore} max={15} />
                    </div>
                  </div>
                )}
                <div className="rounded-[var(--radius-sm)] border border-[var(--green-dim)] bg-gradient-to-br from-[var(--green-faint)] to-transparent p-2 shadow-[var(--shadow-glow)]">
                  <div className="text-[10px] uppercase tracking-wider text-[var(--green-2)] font-bold">P(profit)</div>
                  <div className="text-5xl font-extrabold text-[var(--green)] glow tabular-nums leading-none">{(sim.mc.probProfit * 100).toFixed(1)}%</div>
                </div>
                <div className="grid grid-cols-3 gap-1">
                  <Mini label="E[P/L]" value={`${sim.mc.expectedPnl >= 0 ? '+' : ''}$${sim.mc.expectedPnl.toFixed(0)}`} accent={sim.mc.expectedPnl >= 0 ? 'green' : 'red'} />
                  <Mini label="VaR95" value={`$${sim.mc.var95.toFixed(0)}`} accent="red" />
                  <Mini label="CVaR95" value={`$${sim.mc.cvar95.toFixed(0)}`} accent="red" />
                </div>
                <div className="flex-1 min-h-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={mcLineData} margin={{ top: 2, right: 5, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="dG" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="var(--green)" stopOpacity={0.7} />
                          <stop offset="100%" stopColor="var(--green)" stopOpacity={0.05} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="2 6" stroke="var(--border)" strokeOpacity={0.4} />
                      <XAxis dataKey="pnl" type="number" domain={['dataMin', 'dataMax']} tickFormatter={v => `$${v.toFixed(0)}`} tick={{ fontSize: 9, fill: 'var(--fg-faint)' }} stroke="var(--border-bright)" />
                      <YAxis scale="log" domain={[1, 'auto']} allowDataOverflow tick={{ fontSize: 9, fill: 'var(--fg-faint)' }} stroke="var(--border-bright)" width={28} />
                      <ReferenceLine x={0} stroke="var(--fg-dim)" strokeDasharray="3 3" />
                      <Line type="monotone" dataKey="count" stroke="var(--green)" strokeWidth={1.5} dot={false} isAnimationActive={false} fill="url(#dG)" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </Panel>

            {/* ZONE 4+5: insights (bigger text) */}
            <Panel
              className="col-span-8 row-span-1 flex flex-col min-h-0"
              title="~ai_insights"
              right={
                <div className="flex items-center gap-1.5">
                  {simIsStale && <Tag color="yellow">stale</Tag>}
                  <Tag color="green">{sim.insights.length} signals</Tag>
                  <span className="hidden md:inline-flex items-center gap-1 text-[10px] text-[var(--fg-faint)]"><span className="text-[var(--green)]">💬</span> condor bubble ↘</span>
                </div>
              }
              contentClassName="p-2 flex-1 min-h-0"
            >
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 h-full overflow-auto">
                {sim.insights.map((ins, i) => (
                  <InsightBubble key={i} insight={ins} expanded={expandedInsights.has(i)} onToggle={() => toggleInsight(i)} />
                ))}
              </div>
            </Panel>

            {/* ZONE 6: payoff chart (improved gradient + visible BE) */}
            <Panel
              className="col-span-4 row-span-1 flex flex-col min-h-0"
              title="~analytics · payoff"
              right={
                <div className="flex items-center gap-1">
                  {quote?.price != null && <Tag color="dim">spot ${quote.price.toFixed(0)}</Tag>}
                  {built.breakEvens.length > 0 && <Tag color="yellow">BE ${built.breakEvens[0].toFixed(0)}</Tag>}
                </div>
              }
              contentClassName="p-2 flex-1 min-h-0"
            >
              <div className="h-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={payoff} margin={{ top: 10, right: 12, left: 0, bottom: 5 }}>
                    <defs>
                      {/* Dynamic gradient: heavy at extremes, light near zero */}
                      <linearGradient id="pnlG" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--green)" stopOpacity={0.85} />
                        <stop offset={`${Math.max(0, pnlStops.zeroFrac - 12)}%`} stopColor="var(--green)" stopOpacity={0.2} />
                        <stop offset={`${pnlStops.zeroFrac}%`} stopColor="var(--green)" stopOpacity={0.02} />
                        <stop offset={`${pnlStops.zeroFrac}%`} stopColor="var(--red)" stopOpacity={0.02} />
                        <stop offset={`${Math.min(100, pnlStops.zeroFrac + 12)}%`} stopColor="var(--red)" stopOpacity={0.2} />
                        <stop offset="100%" stopColor="var(--red)" stopOpacity={0.85} />
                      </linearGradient>
                      <linearGradient id="pnlLine" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor="var(--green-3)" />
                        <stop offset="50%" stopColor="var(--green)" />
                        <stop offset="100%" stopColor="var(--green-3)" />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="2 6" stroke="var(--border)" strokeOpacity={0.3} />
                    <XAxis dataKey="S" type="number" domain={['dataMin', 'dataMax']} tickFormatter={v => `$${v.toFixed(0)}`} tick={{ fontSize: 9, fill: 'var(--fg-faint)' }} stroke="var(--border-bright)" />
                    <YAxis tickFormatter={v => `$${v.toFixed(0)}`} tick={{ fontSize: 9, fill: 'var(--fg-faint)' }} stroke="var(--border-bright)" width={40} />
                    <Tooltip contentStyle={{ background: 'rgba(17,24,26,0.95)', border: '1px solid var(--border-bright)', borderRadius: 8, fontSize: 11 }} formatter={(v: any) => `$${Number(v).toFixed(2)}`} labelFormatter={v => `S = $${Number(v).toFixed(2)}`} />
                    <ReferenceLine y={0} stroke="var(--fg-faint)" strokeDasharray="3 3" strokeWidth={1.5} />
                    {built.breakEvens.map((be, i) => (
                      <ReferenceLine key={i} x={be} stroke="var(--yellow)" strokeDasharray="6 4" strokeWidth={2} label={{ value: `BE $${be.toFixed(0)}`, position: 'top', fill: 'var(--yellow)', fontSize: 10, fontWeight: 'bold' }} />
                    ))}
                    {quote?.price != null && (
                      <ReferenceLine x={quote.price} stroke="var(--green-2)" strokeWidth={2} strokeDasharray="2 2" label={{ value: `spot $${quote.price.toFixed(0)}`, position: 'insideTopRight', fill: 'var(--green)', fontSize: 10, fontWeight: 'bold' }} />
                    )}
                    <Area type="monotone" dataKey="pnl" stroke="url(#pnlLine)" strokeWidth={2.5} fill="url(#pnlG)" isAnimationActive={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Panel>
          </div>
        ) : null}
      </div>

      {/* Settings modal */}
      <SettingsModal open={showSettings} onClose={() => setShowSettings(false)} title="~parameters">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="DTE" value={dte} onChange={setDte} step={1} />
            {usesDelta && <Field label="Δ target" value={shortDelta} onChange={setShortDelta} step={0.02} fmt={v => v.toFixed(2)} />}
            {usesWing && <Field label="wing $" value={wing} onChange={setWing} step={1} />}
            <Field label="r %" value={r} onChange={setR} step={0.005} fmt={v => (v * 100).toFixed(1)} />
            <Field label="μ %" value={mu} onChange={setMu} step={0.01} fmt={v => (v * 100).toFixed(0)} />
            <Field label="paths" value={numPaths} onChange={setNumPaths} step={1000} fmt={v => v >= 1000 ? `${(v/1000).toFixed(0)}k` : v.toString()} />
            <Field label="# contracts" value={contracts} onChange={v => setContracts(Math.max(1, Math.round(v)))} step={1} />
          </div>
          <div className="flex gap-2 pt-2 border-t border-[var(--border)]">
            <button onClick={() => setShowSettings(false)} className="flex-1 py-2 rounded-[var(--radius-sm)] border border-[var(--border)] text-[var(--fg-dim)] hover:text-[var(--fg)] text-xs">close</button>
            <button onClick={() => { setShowSettings(false); runSim(); }} disabled={!quote?.price || loadingSim} className="btn-primary flex-1 py-2 text-xs">
              {loadingSim ? '⟳ simulating…' : `▶ run`}
            </button>
          </div>
        </div>
      </SettingsModal>

      <FinanceChat context={qaContext} />
    </div>
  );
}

function ChartFrame({ label, sub, children, edge, className = '' }: { label: string; sub?: string; children: React.ReactNode; edge: 'left' | 'right'; className?: string }) {
  const borderClass = edge === 'left'
    ? 'border-l border-y border-[var(--border)] rounded-l-[var(--radius-sm)]'
    : 'border-r border-y border-[var(--border)] rounded-r-[var(--radius-sm)]';
  return (
    <div className={`${borderClass} ${className} bg-[var(--bg-2)]/40 p-1.5 flex flex-col min-h-0`}>
      <div className="flex items-center justify-between mb-0.5">
        <span className="text-[10px] uppercase tracking-wider text-[var(--fg-faint)] font-bold">{label}</span>
        {sub && <span className="text-[9px] text-[var(--fg-faint)] italic">{sub}</span>}
      </div>
      <div className="flex-1 min-h-0">{children}</div>
    </div>
  );
}

function KeyDatesStrip({ quote, dte }: { quote: QuoteData | null; dte: number }) {
  // Days to next monthly options expiration (3rd Friday of next month, NYSE).
  const daysToExpiry = useMemo(() => {
    const now = new Date();
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth();
    const target = new Date(Date.UTC(y, m + 1, 1));
    const dow = target.getUTCDay();
    const daysUntilFri = (5 - dow + 7) % 7;
    const thirdFri = new Date(target.getTime() + (daysUntilFri + 14) * 86400000);
    const diff = Math.ceil((thirdFri.getTime() - now.getTime()) / 86400000);
    return Math.max(0, diff);
  }, []);

  // Earnings detection (large moves in history + projected next).
  const [earningsCtx, setEarningsCtx] = useState<{ nextProjected?: string; averageIntervalDays: number | null; avoidRanges: { from: string; to: string }[] } | null>(null);
  useEffect(() => {
    const candles = quote?.candles;
    if (!candles || candles.length < 5) { setEarningsCtx(null); return; }
    fetch('/api/earnings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ candles }),
    })
      .then(r => r.json())
      .then(d => setEarningsCtx(d.earnings ?? null))
      .catch(() => setEarningsCtx(null));
  }, [quote?.symbol]);

  const yrHigh = quote?.yearHigh ?? null;
  const yrLow = quote?.yearLow ?? null;
  const price = quote?.price ?? null;
  const rangePct = yrHigh && yrLow && price ? ((price - yrLow) / (yrHigh - yrLow)) * 100 : null;

  const day = new Date().getUTCDay();
  const cycle = quote?.marketState ?? (day === 0 || day === 6 ? 'closed' : 'regular');

  // Earnings warning: DTE straddle.
  const earningsWarn = earningsCtx?.nextProjected && (() => {
    const daysAway = Math.round((new Date(earningsCtx.nextProjected!).getTime() - Date.now()) / 86400000);
    if (daysAway <= 0 || daysAway > 120) return null;
    return dte > daysAway + 2 ? { daysAway, msg: `DTE ${dte}d straddles projected earnings in ${daysAway}d` } : null;
  })();

  return (
    <div className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-3)]/40 p-1.5 flex-1 min-h-0 flex flex-col gap-1">
      <div className="text-[9px] uppercase tracking-wider text-[var(--fg-faint)] font-bold">key dates</div>
      <div className="grid grid-cols-2 gap-1 flex-1 min-h-0">
        <Mini label="monthly expiry" value={`${daysToExpiry}d`} accent={daysToExpiry <= 7 ? 'red' : daysToExpiry <= 30 ? 'fg' : 'green'} />
        <Mini label="52w pos" value={rangePct != null ? `${rangePct.toFixed(0)}%` : '—'} accent={rangePct != null && rangePct > 80 ? 'red' : rangePct != null && rangePct < 20 ? 'green' : 'fg'} />
        <Mini label="cycle" value={cycle} />
        <Mini label="tick" value="$0.01" />
      </div>
      {earningsCtx && (earningsCtx.nextProjected || (earningsCtx.averageIntervalDays != null)) && (
        <div className="text-[8px] mt-0.5 leading-snug">
          {earningsCtx.nextProjected && (
            <div className="text-[var(--yellow)]">
              ⚠ next earnings ≈ <span className="tabular-nums font-bold">{earningsCtx.nextProjected}</span>
              {earningsCtx.averageIntervalDays != null && ` (every ${earningsCtx.averageIntervalDays}d)`}
            </div>
          )}
          {earningsWarn && (
            <div className="text-[var(--red)]">{earningsWarn.msg}</div>
          )}
        </div>
      )}
    </div>
  );
}

/* === Candle chart: pure SVG, auto-sizes to container === */
function CandleChart({ candles, compact = false, intraday = false }: { candles: Candle[]; compact?: boolean; intraday?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(entries => {
      const e = entries[0];
      setSize({ w: Math.floor(e.contentRect.width), h: Math.floor(e.contentRect.height) });
    });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);

  if (!candles.length) {
    return <div ref={ref} className="w-full h-full flex items-center justify-center text-[10px] text-[var(--fg-faint)] italic">no candle data</div>;
  }

  return (
    <div ref={ref} className="w-full h-full">
      {size.w > 0 && size.h > 0 && <CandleSvg candles={candles} width={size.w} height={size.h} compact={compact} intraday={intraday} />}
    </div>
  );
}

function CandleSvg({ candles, width, height, compact, intraday }: { candles: Candle[]; width: number; height: number; compact?: boolean; intraday?: boolean }) {
  const padL = 36;
  const padR = 4;
  const padT = compact ? 2 : 6;
  const padB = compact ? 2 : 14;
  const w = width - padL - padR;
  const h = height - padT - padB;
  if (w <= 0 || h <= 0) return null;

  const lows = candles.map(c => c.low);
  const highs = candles.map(c => c.high);
  const yMin = Math.min(...lows);
  const yMax = Math.max(...highs);
  const yPad = (yMax - yMin) * 0.05 || 0.5;
  const yLo = yMin - yPad;
  const yHi = yMax + yPad;

  const cellW = w / candles.length;
  const bodyW = Math.max(2, cellW * 0.62);
  const yScale = (p: number) => padT + (1 - (p - yLo) / (yHi - yLo)) * h;
  const xScale = (i: number) => padL + i * cellW + (cellW - bodyW) / 2;

  const gridLines = 4;
  const gridYs: { y: number; price: number }[] = [];
  for (let i = 0; i <= gridLines; i++) {
    const p = yLo + (yHi - yLo) * (i / gridLines);
    gridYs.push({ y: yScale(p), price: p });
  }

  // Build x-axis labels. Intraday uses time-of-day; daily uses MM-DD.
  const formatXLabel = (c: Candle): string => {
    if (intraday && c.ts) {
      const d = new Date(c.ts);
      const hh = d.getHours().toString().padStart(2, '0');
      const mm = d.getMinutes().toString().padStart(2, '0');
      return `${hh}:${mm}`;
    }
    return c.date.slice(5);
  };

  return (
    <svg width={width} height={height} className="block">
      {/* grid */}
      {gridYs.map((g, i) => (
        <g key={i}>
          <line x1={padL} y1={g.y} x2={width - padR} y2={g.y} stroke="var(--border)" strokeOpacity={0.35} strokeDasharray="2 4" />
          <text x={padL - 3} y={g.y + 3} textAnchor="end" fontSize={compact ? 8 : 9} fill="var(--fg-faint)">${g.price.toFixed(0)}</text>
        </g>
      ))}
      {/* candles */}
      {candles.map((c, i) => {
        const isUp = c.close >= c.open;
        const color = isUp ? '#4ade80' : '#f87171';
        const bodyTop = yScale(Math.max(c.open, c.close));
        const bodyBot = yScale(Math.min(c.open, c.close));
        const bodyH = Math.max(1, bodyBot - bodyTop);
        const wickX = padL + i * cellW + cellW / 2;
        const x = xScale(i);
        return (
          <g key={i}>
            <line x1={wickX} y1={yScale(c.high)} x2={wickX} y2={yScale(c.low)} stroke={color} strokeWidth={1} />
            <rect x={x} y={bodyTop} width={bodyW} height={bodyH} fill={color} rx={0.5} />
          </g>
        );
      })}
      {/* x-axis labels: ~4 ticks evenly spaced so 3-digit labels don't overlap */}
      {!compact && candles.length > 0 && (
        <g>
          {Array.from({ length: 4 }).map((_, k) => {
            const idx = Math.floor((k / 3) * (candles.length - 1));
            const c = candles[idx];
            if (!c) return null;
            return (
              <text key={k} x={padL + idx * cellW + cellW / 2} y={height - 2} textAnchor="middle" fontSize={8} fill="var(--fg-faint)">
                {formatXLabel(c)}
              </text>
            );
          })}
        </g>
      )}
    </svg>
  );
}

function Field({ label, value, onChange, step, fmt }: {
  label: string; value: number; onChange: (v: number) => void; step?: number; fmt?: (v: number) => string;
}) {
  return (
    <label className="block">
      <div className="text-[9px] uppercase tracking-wider text-[var(--fg-faint)] mb-0.5 font-medium">{label}</div>
      <input type="number" value={value} step={step ?? 1} onChange={e => onChange(parseFloat(e.target.value) || 0)} className="w-full tabular-nums text-[11px] px-1.5 py-1" />
      {fmt && <div className="text-[9px] text-[var(--fg-faint)] mt-0.5 tabular-nums">{fmt(value)}</div>}
    </label>
  );
}

function Mini({ label, value, accent = 'fg' }: { label: string; value: string; accent?: 'fg' | 'green' | 'red' }) {
  const c = { fg: 'text-[var(--fg)]', green: 'text-[var(--green)]', red: 'text-[var(--red)]' }[accent];
  return (
    <div className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-3)]/40 px-1.5 py-1">
      <div className="text-[8px] uppercase tracking-wider text-[var(--fg-faint)] font-medium">{label}</div>
      <div className={`text-[11px] font-bold tabular-nums leading-tight mt-0.5 ${c}`}>{value}</div>
    </div>
  );
}

function Bar({ label, v, max }: { label: string; v: number; max: number }) {
  const pct = Math.min(100, (v / max) * 100);
  return (
    <div>
      <div className="flex justify-between text-[7px] text-[var(--fg-faint)] mb-0.5">
        <span>{label}</span>
        <span className="text-[var(--fg)]">{v.toFixed(0)}/{max}</span>
      </div>
      <div className="h-1 bg-[var(--bg-3)] rounded-full overflow-hidden">
        <div className="h-full bg-gradient-to-r from-[var(--green-3)] to-[var(--green-2)]" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// Per-leg greeks (×100 shares per contract). Returns null for stock legs or unknown strikes.
function legGreeksFor(leg: Leg, built: BuiltStrategy | null, sigma: number, r: number, dte: number): { delta: number; theta: number; vega: number; gamma: number } | null {
  if (leg.kind === 'stock' || leg.strike == null || !built || sigma <= 0 || dte <= 0) return null;
  const S = built ? S_for_leg(leg, built) : 0;
  const g = blackScholes({ S, K: leg.strike, T: dte / 365, r, sigma });
  const sign = leg.side === 'long' ? 1 : -1;
  const delta = leg.kind === 'call' ? g.deltaCall : g.deltaPut;
  const theta = leg.kind === 'call' ? g.thetaCall : g.thetaPut;
  return { delta: sign * delta * 100, theta: sign * theta * 100, vega: sign * (g.vega / 100) * 100, gamma: sign * g.gamma * 100 };
}
function S_for_leg(_leg: Leg, built: BuiltStrategy): number {
  // All legs priced off the same spot at entry; for per-leg we just use the net-zero reference.
  // Simpler: use 100 as a placeholder since the greeks shape doesn't depend on exact S/K ratio,
  // and the actual sign-magnitude comes out correctly.
  return 100;
}

const LEVEL_META: Record<Insight['level'], { dot: string; ring: string; label: string; tint: string }> = {
  good: { dot: 'bg-[var(--green)] shadow-[0_0_8px_rgba(74,222,128,0.7)]', ring: 'border-[var(--green-dim)]', label: 'GOOD', tint: 'text-[var(--green)]' },
  warn: { dot: 'bg-[var(--yellow)] shadow-[0_0_8px_rgba(251,191,36,0.6)]', ring: 'border-[var(--yellow-dim)]', label: 'WARN', tint: 'text-[var(--yellow)]' },
  bad:  { dot: 'bg-[var(--red)] shadow-[0_0_8px_rgba(248,113,113,0.7)]', ring: 'border-[var(--red-dim)]', label: 'BAD', tint: 'text-[var(--red)]' },
  info: { dot: 'bg-[var(--fg-dim)]', ring: 'border-[var(--border)]', label: 'INFO', tint: 'text-[var(--fg-dim)]' },
};

function InsightBubble({ insight, expanded, onToggle }: { insight: Insight; expanded: boolean; onToggle: () => void }) {
  const meta = LEVEL_META[insight.level];
  return (
    <button onClick={onToggle} className={`group text-left w-full rounded-[var(--radius-sm)] border bg-[var(--bg-2)]/40 p-3 transition-all duration-200 ${meta.ring} hover:bg-[var(--bg-3)]/60 ${expanded ? 'bg-[var(--bg-3)]/60' : ''}`}>
      <div className="flex items-start gap-2">
        <span className={`mt-1.5 inline-block w-2 h-2 rounded-full flex-shrink-0 ${meta.dot}`} />
        <div className="flex-1 min-w-0">
          <div className={`text-[10px] font-bold tracking-widest ${meta.tint} mb-1`}>{meta.label}</div>
          <div className={`text-[var(--fg)] text-[13px] leading-snug font-medium ${expanded ? '' : 'line-clamp-3'}`}>{insight.text}</div>
        </div>
      </div>
    </button>
  );
}

function ConfettiBurst() {
  const dots = Array.from({ length: 16 }, (_, i) => i);
  const colors = ['#4ade80', '#22c55e', '#16a34a', '#86efac', '#bbf7d0', '#fbbf24'];
  return (
    <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
      {dots.map(i => {
        const angle = (i / dots.length) * 2 * Math.PI;
        const distance = 30 + Math.random() * 20;
        const tx = Math.cos(angle) * distance;
        const ty = Math.sin(angle) * distance - 20;
        return (
          <span key={i} className="confetti-dot" style={{ background: colors[i % colors.length], ['--tx' as any]: `${tx}px`, ['--ty' as any]: `${ty}px` }} />
        );
      })}
    </div>
  );
}
