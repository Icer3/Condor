'use client';

import Link from 'next/link';
import { useState } from 'react';
import { LineChart, Line, ResponsiveContainer, YAxis, Tooltip, Area, AreaChart, ReferenceLine } from 'recharts';
import { Panel, Tag } from '@/components/Panels';
import { listStrategies, StrategyDefinition, payoffCurve } from '@/lib/strategies';
import { COURSE } from '@/lib/curriculum';

const CATEGORY_COLOR: Record<string, string> = {
  bullish: 'border-[var(--green-dim)] text-[var(--green)] bg-[var(--green-faint)]',
  bearish: 'border-[var(--yellow-dim)] text-[var(--yellow)] bg-[var(--yellow-faint)]',
  neutral: 'border-[#1e40af] text-[#93c5fd] bg-[#0c1e3a]',
  income: 'border-[#7c3aed] text-[#c4b5fd] bg-[#1e1b4b]',
  volatility: 'border-[#be185d] text-[#f9a8d4] bg-[#3b0a23]',
};

export default function LearnPage() {
  const strategies = listStrategies();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [demoSpot] = useState(185);

  return (
    <div className="space-y-4">
      <Panel title="~/learn">
        <h1 className="text-2xl font-bold text-[var(--green)] glow mb-2">Learn Options</h1>
        <p className="text-[var(--fg-dim)] leading-relaxed mb-4">
          Two ways in: the <span className="text-[var(--fg)] font-semibold">10 most common strategies</span> below,
          or the <span className="text-[var(--fg)] font-semibold">full 10-lesson course</span> that builds the math from first principles.
        </p>
        <div className="grid sm:grid-cols-2 gap-3">
          <Link
            href="/learn/course"
            className="rounded-[var(--radius)] border border-[var(--green-dim)] bg-gradient-to-br from-[var(--green-faint)] to-transparent p-4 hover:shadow-[0_8px_24px_rgba(0,0,0,0.35)] hover:-translate-y-0.5 transition-all duration-200"
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] uppercase tracking-wider text-[var(--green-2)] font-bold">course</span>
              <span className="text-[10px] text-[var(--fg-faint)]">~80 min · 10 lessons</span>
            </div>
            <div className="text-base font-bold text-[var(--green)]">Options · The Full Course</div>
            <div className="text-xs text-[var(--fg-dim)] mt-1">From "what is an option" to "where Black-Scholes breaks." BSM, GBM, Greeks, vol surfaces.</div>
          </Link>
          <Link
            href="/trade"
            className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-3)]/30 p-4 hover:border-[var(--green-dim)] hover:-translate-y-0.5 transition-all duration-200"
          >
            <div className="text-[10px] uppercase tracking-wider text-[var(--fg-faint)] font-bold mb-1">jump in</div>
            <div className="text-base font-bold text-[var(--fg)]">Analyze or paper-trade</div>
            <div className="text-xs text-[var(--fg-dim)] mt-1">Build a strategy, run Monte Carlo, open a paper position.</div>
          </Link>
        </div>
      </Panel>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {strategies.map(s => (
          <StrategyCard
            key={s.meta.id}
            strategy={s}
            expanded={expanded === s.meta.id}
            onToggle={() => setExpanded(expanded === s.meta.id ? null : s.meta.id)}
            demoSpot={demoSpot}
          />
        ))}
      </div>
    </div>
  );
}

function StrategyCard({ strategy: s, expanded, onToggle, demoSpot }: {
  strategy: StrategyDefinition; expanded: boolean; onToggle: () => void; demoSpot: number;
}) {
  const built = s.build({ S: demoSpot, sigma: 0.28, r: 0.045, daysToExpiry: 30, ...s.defaultParams });
  const curve = payoffCurve(built.legs, demoSpot, 0.30, 121);

  return (
    <div className={`panel transition-all ${expanded ? 'md:col-span-2' : ''}`}>
      <button
        onClick={onToggle}
        className="w-full text-left panel-header hover:bg-[var(--bg-3)]/40 transition"
      >
        <div className="flex items-center gap-3">
          <div className="text-2xl">{s.meta.emoji}</div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-base font-bold text-[var(--fg)] tracking-wide">{s.meta.name}</span>
              <span className={`tag-badge text-[9px] uppercase tracking-widest font-bold px-2 py-0.5 rounded-full border ${CATEGORY_COLOR[s.meta.category]}`}>
                {s.meta.category}
              </span>
            </div>
            <div className="text-xs text-[var(--fg-dim)] mt-0.5">{s.meta.shortDescription}</div>
          </div>
        </div>
        <span className="text-[var(--green)] text-lg">{expanded ? '−' : '+'}</span>
      </button>

      {expanded && (
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="space-y-3 text-sm">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-[var(--fg-faint)] font-semibold mb-1">what it is</div>
                <p className="text-[var(--fg-dim)] leading-relaxed">{s.meta.longDescription}</p>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-[var(--fg-faint)] font-semibold mb-1">when to use it</div>
                <p className="text-[var(--fg-dim)] leading-relaxed">{s.meta.whenToUse}</p>
              </div>
            </div>
            <div className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-3)]/40 p-3">
              <div className="text-[10px] uppercase tracking-wider text-[var(--fg-faint)] font-semibold mb-2">
                payoff diagram · spot ${demoSpot} · 30 DTE · σ 28%
              </div>
              <div className="h-44">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={curve}>
                    <defs>
                      <linearGradient id={`g-${s.meta.id}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--green)" stopOpacity={0.5} />
                        <stop offset="50%" stopColor="var(--green)" stopOpacity={0.05} />
                        <stop offset="50%" stopColor="var(--red)" stopOpacity={0.05} />
                        <stop offset="100%" stopColor="var(--red)" stopOpacity={0.4} />
                      </linearGradient>
                    </defs>
                    <YAxis tickFormatter={v => `$${v.toFixed(0)}`} tick={{ fontSize: 10, fill: 'var(--fg-dim)' }} width={50} />
                    <Tooltip
                      contentStyle={{ background: 'rgba(17,24,26,0.95)', border: '1px solid var(--border-bright)', borderRadius: 10, fontSize: 11 }}
                      formatter={(v: any) => `$${Number(v).toFixed(2)}`}
                      labelFormatter={v => `S = $${Number(v).toFixed(2)}`}
                    />
                    <ReferenceLine y={0} stroke="var(--fg-faint)" strokeDasharray="3 3" />
                    <ReferenceLine x={demoSpot} stroke="var(--green)" strokeOpacity={0.4} />
                    <Area type="monotone" dataKey="pnl" stroke="var(--green)" strokeWidth={1.8} fill={`url(#g-${s.meta.id})`} isAnimationActive={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <MiniStat label="max profit" value={built.maxProfit == null ? 'unlimited' : `$${built.maxProfit.toFixed(0)}`} accent={built.maxProfit == null ? 'green' : built.maxProfit >= 0 ? 'green' : 'red'} />
            <MiniStat label="max loss" value={built.maxLoss == null ? 'unlimited' : `$${Math.abs(built.maxLoss).toFixed(0)}`} accent={built.maxLoss == null ? 'red' : 'red'} />
            <MiniStat label="risk profile" value={s.meta.riskProfile} accent={s.meta.riskProfile === 'defined' ? 'green' : 'red'} />
            <MiniStat label="breakevens" value={built.breakEvens.map(b => `$${b.toFixed(0)}`).join(' / ')} />
          </div>

          <div className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-3)]/30 p-4">
            <div className="text-[10px] uppercase tracking-wider text-[var(--fg-faint)] font-semibold mb-1">example trade</div>
            <p className="text-sm text-[var(--fg)] leading-relaxed italic">"{s.meta.example}"</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <FormulaBox title="max profit" formula={s.meta.maxProfitFormula} accent="green" />
            <FormulaBox title="max loss"   formula={s.meta.maxLossFormula}   accent="red" />
          </div>

          <div className="flex justify-end pt-2">
            <Link
              href={`/trade?strategy=${s.meta.id}`}
              className="btn-primary px-5 py-2 rounded-[var(--radius-sm)] text-sm"
            >
              analyze in trade tab →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

function MiniStat({ label, value, accent = 'fg' }: { label: string; value: string; accent?: 'fg' | 'green' | 'red' }) {
  const c = { fg: 'text-[var(--fg)]', green: 'text-[var(--green)]', red: 'text-[var(--red)]' }[accent];
  return (
    <div className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-3)]/40 px-3 py-2">
      <div className="text-[9px] uppercase tracking-wider text-[var(--fg-faint)]">{label}</div>
      <div className={`text-sm font-bold tabular-nums mt-0.5 ${c}`}>{value}</div>
    </div>
  );
}

function FormulaBox({ title, formula, accent }: { title: string; formula: string; accent: 'green' | 'red' }) {
  const ring = accent === 'green' ? 'border-[var(--green-dim)]' : 'border-[var(--red-dim)]';
  const txt  = accent === 'green' ? 'text-[var(--green)]' : 'text-[var(--red)]';
  return (
    <div className={`rounded-[var(--radius-sm)] border ${ring} bg-[var(--bg-3)]/30 px-3 py-2`}>
      <div className={`text-[10px] uppercase tracking-wider font-semibold ${txt}`}>{title}</div>
      <div className="text-xs text-[var(--fg)] mt-0.5 font-mono">{formula}</div>
    </div>
  );
}