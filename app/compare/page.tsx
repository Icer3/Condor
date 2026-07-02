'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine, AreaChart, Area,
} from 'recharts';
import { Panel, Stat, Tag } from '@/components/Panels';
import {
  listStrategies, buildStrategy, StrategyId, payoffCurve, STRATEGIES,
} from '@/lib/strategies';
import { gradeStrategy } from '@/lib/strategyGrader';
import { computeIVEnvironment } from '@/lib/ivRank';

type QuoteData = {
  symbol: string; price: number | null; realizedVol: number | null;
  history: number[];
};

const PRESET_PAIRS: Array<[StrategyId, StrategyId]> = [
  ['iron_condor', 'iron_butterfly'],
  ['bull_call_spread', 'long_call'],
  ['iron_condor', 'bull_call_spread'],
  ['long_straddle', 'long_strangle'],
  ['short_put', 'covered_call'],
];

export default function ComparePage() {
  const strategies = listStrategies();
  const [symbol, setSymbol] = useState('AAPL');
  const [quote, setQuote] = useState<QuoteData | null>(null);
  const [loading, setLoading] = useState(false);
  const [dte, setDte] = useState(30);
  const [a, setA] = useState<StrategyId>('iron_condor');
  const [b, setB] = useState<StrategyId>('bull_call_spread');

  const fetchQuote = async (sym: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/quote/${encodeURIComponent(sym)}`);
      const data = await res.json();
      if (res.ok) setQuote(data);
    } catch {} finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchQuote('AAPL'); }, []);

  const ivEnv = useMemo(() => {
    if (!quote?.realizedVol || !quote.history?.length) return null;
    return computeIVEnvironment(quote.realizedVol, quote.history);
  }, [quote]);

  const T = dte / 365;
  const sigma = quote?.realizedVol ?? 0.30;
  const builtA = useMemo(() => {
    if (!quote?.price) return null;
    return buildStrategy(a, { S: quote.price, sigma, r: 0.045, daysToExpiry: dte });
  }, [a, quote, dte, sigma]);
  const builtB = useMemo(() => {
    if (!quote?.price) return null;
    return buildStrategy(b, { S: quote.price, sigma, r: 0.045, daysToExpiry: dte });
  }, [b, quote, dte, sigma]);

  // Tight payoff x-axis for A vs B. Span the strike envelope plus ~2 strikes of room.
  // Defined-risk strategies clamp to their strike range; unbounded ones get a ±15% tail.
  // Cap the total span so the X-axis never gets so wide that 3-digit labels overlap.
  const payoffDomain = (built: typeof builtA): [number, number] | null => {
    if (!built || !quote?.price) return null;
    const strikes = built.legs
      .map(l => (typeof l.strike === 'number' && l.strike > 0 ? l.strike : quote.price!))
      .filter(s => s > 0);
    if (!strikes.length) return [quote.price * 0.90, quote.price * 1.10];
    const lo = Math.min(...strikes);
    const hi = Math.max(...strikes);
    const pad = Math.max((hi - lo) * 0.25, quote.price * 0.03, 2);
    let dLo = lo - pad;
    let dHi = hi + pad;
    if (built.maxProfit == null && built.maxLoss == null) {
      // Unbounded strategies: clamp to ±15% of spot so labels stay legible.
      dLo = Math.max(dLo, quote.price * 0.85);
      dHi = Math.min(dHi, quote.price * 1.15);
    }
    return [dLo, dHi];
  };
  const domA = payoffDomain(builtA);
  const domB = payoffDomain(builtB);
  // Use the union of the two domains so both charts share the same x-axis range.
  const sharedDomain: [number, number] | null =
    domA && domB
      ? [Math.min(domA[0], domB[0]), Math.max(domA[1], domB[1])]
      : domA ?? domB;
  const curveA = useMemo(() => {
    if (!builtA || !quote?.price) return [];
    const span = sharedDomain
      ? Math.max(((sharedDomain[1] - sharedDomain[0]) / quote.price) * 0.5 + 0.02, 0.05)
      : 0.10;
    return payoffCurve(builtA.legs, quote.price, span, 41);
  }, [builtA, quote, sharedDomain]);
  const curveB = useMemo(() => {
    if (!builtB || !quote?.price) return [];
    const span = sharedDomain
      ? Math.max(((sharedDomain[1] - sharedDomain[0]) / quote.price) * 0.5 + 0.02, 0.05)
      : 0.10;
    return payoffCurve(builtB.legs, quote.price, span, 41);
  }, [builtB, quote, sharedDomain]);

  // Use pseudo-PoP based on breakeven buffer / wings (no full MC here for speed)
  const pseudoMC = (built: typeof builtA) => {
    if (!built || !quote?.price) return null;
    const spot = quote.price;
    const beLo = Math.min(...built.breakEvens);
    const beHi = Math.max(...built.breakEvens);
    const buffer = (beHi - beLo) / spot;
    // Rough PoP estimate: higher buffer = higher PoP
    const pop = Math.min(0.95, Math.max(0.20, 0.5 + buffer * 2.5));
    // Rough EV: assume flat EV within buffer, linear decline outside
    const evPerShare = built.entryPerContract > 0
      ? built.entryPerContract * pop + (-(built.maxLoss ?? 0)) * (1 - pop) * 0.3
      : built.entryPerContract;
    // Synthesize tail-risk field for compare-only grader call (no real MC run on this page).
    // 0.85× max loss is a reasonable VaR approximation for a defined-risk strategy.
    const var95 = (built.maxLoss ?? 0) * 0.85;
    return { probProfit: pop, expectedPnl: evPerShare, var95 };
  };
  const mcA = builtA ? pseudoMC(builtA) : null;
  const mcB = builtB ? pseudoMC(builtB) : null;

  const graderA = (builtA && mcA && ivEnv) ? gradeStrategy(
    mcA, builtA, ivEnv.rank, dte, sigma,
  ) : null;
  const graderB = (builtB && mcB && ivEnv) ? gradeStrategy(
    mcB, builtB, ivEnv.rank, dte, sigma,
  ) : null;

  const winner = (gA: typeof graderA, gB: typeof graderB) => {
    if (!gA || !gB) return null;
    if (Math.abs(gA.total - gB.total) < 5) return 'tie';
    return gA.total > gB.total ? 'A' : 'B';
  };
  const overall = winner(graderA, graderB);

  return (
    <div className="space-y-2">
      <Panel title="~compare"
        right={
          <div className="flex items-center gap-2">
            <Tag color="dim">{strategies.length} strategies</Tag>
            <LinkSimple />
          </div>
        }
      >
        <div className="text-[11px] italic text-[var(--fg-dim)] leading-relaxed mb-2 border-l-2 border-[var(--green-dim)] pl-2">
          <span className="font-bold text-[var(--green)] not-italic mr-1">why this verdict?</span>
          {renderWhy(builtA, builtB, mcA, mcB, graderA, graderB, ivEnv, overall, a, b)}
        </div>
        <div className="grid grid-cols-12 gap-3 items-end">
          <div className="col-span-12 md:col-span-3">
            <label className="block">
              <div className="text-[9px] uppercase tracking-wider text-[var(--fg-faint)] mb-1 font-medium">ticker</div>
              <div className="flex gap-1.5">
                <input value={symbol} onChange={e => setSymbol(e.target.value.toUpperCase())} onKeyDown={e => e.key === 'Enter' && fetchQuote(symbol)} className="flex-1 uppercase tracking-wider text-xs px-2 py-1" />
                <button onClick={() => fetchQuote(symbol)} className="btn-primary px-3 text-[10px]">{loading ? '…' : 'fetch'}</button>
              </div>
              {quote && quote.price != null && <div className="text-[10px] text-[var(--fg-faint)] mt-1">${quote.price.toFixed(2)} · σ {(sigma*100).toFixed(0)}%</div>}
            </label>
          </div>
          <div className="col-span-6 md:col-span-2">
            <label className="block">
              <div className="text-[9px] uppercase tracking-wider text-[var(--fg-faint)] mb-1 font-medium">DTE</div>
              <input type="number" value={dte} onChange={e => setDte(parseInt(e.target.value) || 30)} className="w-full text-xs px-2 py-1" />
            </label>
          </div>
          <div className="col-span-6 md:col-span-3">
            <label className="block">
              <div className="text-[9px] uppercase tracking-wider text-[var(--fg-faint)] mb-1 font-medium">strategy A</div>
              <select value={a} onChange={e => setA(e.target.value as StrategyId)} className="w-full text-xs px-2 py-1">
                {strategies.map(s => <option key={s.meta.id} value={s.meta.id}>{s.meta.emoji} {s.meta.name}</option>)}
              </select>
            </label>
          </div>
          <div className="col-span-6 md:col-span-3">
            <label className="block">
              <div className="text-[9px] uppercase tracking-wider text-[var(--fg-faint)] mb-1 font-medium">strategy B</div>
              <select value={b} onChange={e => setB(e.target.value as StrategyId)} className="w-full text-xs px-2 py-1">
                {strategies.map(s => <option key={s.meta.id} value={s.meta.id}>{s.meta.emoji} {s.meta.name}</option>)}
              </select>
            </label>
          </div>
          <div className="col-span-6 md:col-span-1">
            <button onClick={() => { const p = PRESET_PAIRS[Math.floor(Math.random() * PRESET_PAIRS.length)]; setA(p[0]); setB(p[1]); }} className="btn-ghost w-full py-1 text-[10px]" title="random pair">
              🎲
            </button>
          </div>
        </div>
      </Panel>

      {/* Verdict banner */}
      {overall && graderA && graderB && (
        <div className={`rounded-[var(--radius)] p-4 border ${overall === 'tie' ? 'border-[var(--yellow)] bg-[#1c1408]' : 'border-[var(--green-dim)] bg-[var(--green-faint)]/30'}`}>
          <div className="flex items-center gap-3">
            <span className="text-2xl">{overall === 'tie' ? '🤝' : '🏆'}</span>
            <div>
              <div className="text-xs text-[var(--fg-dim)]">verdict</div>
              <div className="text-base font-bold text-[var(--fg)]">
                {overall === 'tie'
                  ? 'too close to call — both score within 5 points'
                  : `${overall === 'A' ? STRATEGIES[a].meta.name : STRATEGIES[b].meta.name} wins by ${Math.abs(graderA.total - graderB.total)} points`}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <StrategyColumn
          side="A"
          strategyId={a}
          built={builtA}
          curve={curveA}
          mc={mcA}
          grader={graderA}
          isWinner={overall === 'A'}
        />
        <StrategyColumn
          side="B"
          strategyId={b}
          built={builtB}
          curve={curveB}
          mc={mcB}
          grader={graderB}
          isWinner={overall === 'B'}
        />
      </div>
    </div>
  );
}

function LinkSimple() {
  return <a href="/trade" className="text-[10px] text-[var(--green)] hover:underline">/trade →</a>;
}

function StrategyColumn({ side, strategyId, built, curve, mc, grader, isWinner }: {
  side: string; strategyId: StrategyId; built: any; curve: any[]; mc: any; grader: any; isWinner: boolean;
}) {
  const def = STRATEGIES[strategyId];
  return (
    <Panel
      title={`~${def.meta.id}`}
      right={
        <div className="flex items-center gap-1">
          {isWinner && <Tag color="green">winner</Tag>}
          <Tag color="dim">{def.meta.category}</Tag>
        </div>
      }
    >
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-xl">{def.meta.emoji}</span>
          <div>
            <div className="text-sm font-bold text-[var(--fg)]">{def.meta.name}</div>
            <div className="text-[10px] text-[var(--fg-dim)] italic">{def.meta.shortDescription}</div>
          </div>
        </div>

        {/* Score */}
        {grader && (
          <div className={`rounded-[var(--radius-sm)] border p-2 ${isWinner ? 'border-[var(--green-dim)] bg-[var(--green-faint)]/40' : 'border-[var(--border)] bg-[var(--bg-3)]/40'}`}>
            <div className="flex items-baseline gap-2">
              <div className={`text-3xl font-bold tabular-nums ${isWinner ? 'text-[var(--green)] glow' : 'text-[var(--fg)]'}`}>{grader.total}</div>
              <div className="text-[10px] text-[var(--fg-faint)]">/ 100 · {grader.label}</div>
            </div>
            <div className="grid grid-cols-4 gap-1 mt-2 text-[9px]">
              <Bar label="PoP" v={grader.popScore} max={40} />
              <Bar label="R/R" v={grader.rrScore} max={25} />
              <Bar label="IV"  v={grader.ivScore} max={20} />
              <Bar label="Time" v={grader.timingScore} max={15} />
            </div>
          </div>
        )}

        {/* Metrics */}
        {built && (
          <div className="grid grid-cols-2 gap-1">
            <Stat label="max profit" value={built.maxProfit == null ? '∞' : `$${built.maxProfit.toFixed(0)}`} accent="green" size="sm" />
            <Stat label="max loss" value={built.maxLoss == null ? '∞' : `$${Math.abs(built.maxLoss).toFixed(0)}`} accent="red" size="sm" />
            <Stat label="credit/debit" value={`${built.entryPerContract > 0 ? '+' : ''}$${Math.abs(built.entryPerContract).toFixed(2)}`} accent={built.entryPerContract > 0 ? 'green' : 'red'} size="sm" />
            <Stat label="BE" value={built.breakEvens.map((b: number) => `$${b.toFixed(0)}`).join(' / ') || '—'} size="sm" />
            {mc && <Stat label="PoP (est)" value={`${(mc.probProfit * 100).toFixed(0)}%`} size="sm" />}
            {mc && <Stat label="E[P/L]" value={`$${mc.expectedPnl.toFixed(2)}`} accent={mc.expectedPnl >= 0 ? 'green' : 'red'} size="sm" />}
          </div>
        )}

        {/* Payoff curve */}
        {curve.length > 0 && (
          <div className="h-[160px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={curve} margin={{ top: 5, right: 5, left: 0, bottom: 4 }}>
                <defs>
                  <linearGradient id={`cG-${side}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--green)" stopOpacity={0.4} />
                    <stop offset="50%" stopColor="var(--green)" stopOpacity={0.05} />
                    <stop offset="50%" stopColor="var(--red)" stopOpacity={0.05} />
                    <stop offset="100%" stopColor="var(--red)" stopOpacity={0.3} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="2 6" stroke="var(--border)" strokeOpacity={0.4} />
                <XAxis
                  dataKey="S"
                  type="number"
                  domain={['dataMin', 'dataMax']}
                  tickFormatter={v => `$${Number(v).toFixed(0)}`}
                  tick={{ fontSize: 9, fill: 'var(--fg-faint)' }}
                  stroke="var(--border-bright)"
                  interval={Math.max(0, Math.floor(curve.length / 4))}
                  minTickGap={20}
                />
                <YAxis tickFormatter={v => `$${Number(v).toFixed(0)}`} tick={{ fontSize: 9, fill: 'var(--fg-faint)' }} stroke="var(--border-bright)" width={42} />
                <ReferenceLine y={0} stroke="var(--fg-faint)" strokeDasharray="3 3" />
                <Area type="monotone" dataKey="pnl" stroke="var(--green)" strokeWidth={1.5} fill={`url(#cG-${side})`} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}

        {grader?.warnings && grader.warnings.length > 0 && (
          <div className="text-[10px] text-[var(--yellow)] space-y-0.5">
            {grader.warnings.slice(0, 2).map((w: string, i: number) => <div key={i}>⚠ {w}</div>)}
          </div>
        )}
      </div>
    </Panel>
  );
}

function Bar({ label, v, max }: { label: string; v: number; max: number }) {
  const pct = (v / max) * 100;
  return (
    <div>
      <div className="flex justify-between text-[8px] text-[var(--fg-faint)] mb-0.5">
        <span>{label}</span>
        <span className="text-[var(--fg)]">{v.toFixed(0)}/{max}</span>
      </div>
      <div className="h-1 bg-[var(--bg-3)] rounded-full overflow-hidden">
        <div className="h-full bg-gradient-to-r from-[var(--green-3)] to-[var(--green-2)]" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// renderWhy — generate a short, dynamic explanation of *why* the winner
// won. Compares PoP, EV, IV fit, DTE fit, and category alignment.
// Renders plain text (no JSX here so we can keep the .not-italic block
// in the parent simple). Caller wraps it in an italic span.
// ─────────────────────────────────────────────────────────────────────────
function renderWhy(
  builtA: any, builtB: any,
  mcA: any, mcB: any,
  gA: any, gB: any,
  ivEnv: any,
  overall: 'A' | 'B' | 'tie' | null,
  a: StrategyId, b: StrategyId,
): string {
  if (!overall || !builtA || !builtB || !mcA || !mcB || !gA || !gB) {
    return 'run a fetch + simulate on both strategies to see a verdict explanation.';
  }
  if (overall === 'tie') {
    return `${STRATEGIES[a].meta.name} and ${STRATEGIES[b].meta.name} score within 5 points — pick whichever feels more comfortable. Both are viable under current vol.`;
  }
  const winnerSide = overall;
  const w = winnerSide === 'A' ? builtA : builtB;
  const l = winnerSide === 'A' ? builtB : builtA;
  const mcW = winnerSide === 'A' ? mcA : mcB;
  const mcL = winnerSide === 'A' ? mcB : mcA;
  const gW = winnerSide === 'A' ? gA : gB;
  const gL = winnerSide === 'A' ? gB : gA;
  const wMeta = STRATEGIES[winnerSide === 'A' ? a : b].meta;
  const lMeta = STRATEGIES[winnerSide === 'A' ? b : a].meta;

  const reasons: string[] = [];

  // PoP edge
  if (mcW.probProfit - mcL.probProfit > 0.08) {
    reasons.push(`higher probability of profit (${(mcW.probProfit*100).toFixed(0)}% vs ${(mcL.probProfit*100).toFixed(0)}%)`);
  }
  // EV edge
  if (mcW.expectedPnl - mcL.expectedPnl > 1) {
    reasons.push(`better expected P/L (+$${mcW.expectedPnl.toFixed(0)}/sh vs $${mcL.expectedPnl.toFixed(0)}/sh)`);
  }
  // IV fit: expensive vol favors premium-sellers, cheap vol favors buyers
  if (ivEnv) {
    if (ivEnv.tier === 'expensive' && (wMeta.category === 'income' || wMeta.category === 'neutral' || wMeta.category === 'bullish') && lMeta.category === 'volatility') {
      reasons.push(`fits expensive vol (rank ${ivEnv.rank.toFixed(0)}) — ${wMeta.name.toLowerCase()} collects premium where ${lMeta.name.toLowerCase()} pays it`);
    } else if (ivEnv.tier === 'cheap' && (wMeta.category === 'volatility' || wMeta.category === 'bullish' || wMeta.category === 'bearish') && (lMeta.category === 'income' || lMeta.category === 'neutral')) {
      reasons.push(`fits cheap vol (rank ${ivEnv.rank.toFixed(0)}) — ${wMeta.name.toLowerCase()} is cheap to buy where ${lMeta.name.toLowerCase()} would give back theta`);
    }
  }
  // Category alignment: directional plays beat neutral ones when the recent move has been lopsided
  // (uses IV env's currentVol as a "regime" proxy — high vol = trending)
  if (ivEnv && ivEnv.currentVol > 0.35 && (wMeta.category === 'bullish' || wMeta.category === 'bearish') && (lMeta.category === 'neutral' || lMeta.category === 'income')) {
    reasons.push(`elevated realized vol (${(ivEnv.currentVol*100).toFixed(0)}%) favors ${wMeta.category} plays over neutral premium selling`);
  }
  // R/R edge: if both are defined risk and winner has higher reward-to-risk
  if (w.maxProfit != null && w.maxLoss != null && l.maxProfit != null && l.maxLoss != null) {
    const rrW = w.maxProfit / Math.max(1, Math.abs(w.maxLoss));
    const rrL = l.maxProfit / Math.max(1, Math.abs(l.maxLoss));
    if (rrW > rrL * 1.3 && rrW > 0.3) {
      reasons.push(`better reward-to-risk ratio (${rrW.toFixed(2)}× vs ${rrL.toFixed(2)}×)`);
    }
  }
  // Grader sub-scores — call out the biggest component gap
  const gaps = [
    { name: 'PoP',     gap: gW.popScore     - gL.popScore },
    { name: 'R/R',     gap: gW.rrScore      - gL.rrScore },
    { name: 'IV fit',  gap: gW.ivScore      - gL.ivScore },
    { name: 'Timing',  gap: gW.timingScore  - gL.timingScore },
  ].sort((x, y) => y.gap - x.gap);
  const topGap = gaps[0];
  if (topGap.gap >= 4) {
    reasons.push(`dominates on ${topGap.name.toLowerCase()} (+${topGap.gap} pts in the grader)`);
  }

  if (reasons.length === 0) {
    return `${wMeta.name} edges ${lMeta.name} by ${Math.abs(gW.total - gL.total)} grader points — neither dominates any single dimension, but the cumulative score tips its way.`;
  }
  const intro = `${wMeta.name} wins by ${Math.abs(gW.total - gL.total)} points over ${lMeta.name}. `;
  return intro + reasons.slice(0, 3).join(' · ') + '.';
}