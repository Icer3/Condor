'use client';

import { useEffect, useState } from 'react';
import {
  ResponsiveContainer, ScatterChart, Scatter,
  XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
  LineChart, Line, BarChart, Bar, Cell,
} from 'recharts';
import { Panel, Stat, Tag } from '@/components/Panels';
import { getDeviceId } from '@/lib/paperTrading';
import type { CalibrationRow } from '@/lib/db/supabase/calibrationRepo';
import type { CalibrationSummary } from '@/lib/calibration/summary';

export default function CalibrationPage() {
  const [rows, setRows] = useState<CalibrationRow[]>([]);
  const [summary, setSummary] = useState<CalibrationSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/calibration', { headers: { 'X-Device-Id': getDeviceId() } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setRows(data.rows);
        setSummary(data.summary);
      } catch (e: any) {
        setErr(e?.message ?? 'fetch failed');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <div className="max-w-[1100px] mx-auto space-y-2">
        <Panel title="~calibration">
          <div className="text-[var(--fg-dim)] text-xs italic p-4">loading calibration rows…</div>
        </Panel>
      </div>
    );
  }
  if (err) {
    return (
      <div className="max-w-[1100px] mx-auto space-y-2">
        <Panel title="~calibration">
          <div className="text-[var(--red)] text-xs p-4">! {err}</div>
        </Panel>
      </div>
    );
  }

  const s = summary!;
  const hasData = s.totalClosed > 0;

  return (
    <div className="max-w-[1100px] mx-auto space-y-2">
      <Panel title="~calibration"
        right={
          <div className="flex items-center gap-1.5">
            <Tag color={hasData ? 'green' : 'dim'}>{s.totalClosed} closed · {s.totalOpen} open</Tag>
            {hasData && (
              <Tag color={s.calibrationError < 0.2 ? 'green' : s.calibrationError < 0.5 ? 'yellow' : 'red'}>
                err {(s.calibrationError * 100).toFixed(0)}%
              </Tag>
            )}
          </div>
        }
      >
        <div className="text-[11px] italic text-[var(--fg-dim)] leading-relaxed mb-3 border-l-2 border-[var(--green-dim)] pl-2">
          <span className="font-bold text-[var(--green)] not-italic mr-1">predicted vs reality.</span>
          every paper position captures the model&rsquo;s predicted P(profit) and expected P/L at open.
          at close we record realized P/L. the scatter shows whether the simulator is calibrated — if the
          line tracks the diagonal, you can trust the model. if it bends above the diagonal, the model is
          optimistic; below, pessimistic.
        </div>

        {hasData ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Stat label="closed" value={s.totalClosed.toString()} />
            <Stat label="win rate" value={`${(s.winRate * 100).toFixed(0)}%`} accent={s.winRate >= 0.5 ? 'green' : 'red'} />
            <Stat label="realized P/L" value={`$${s.realizedTotal.toFixed(0)}`} accent={s.realizedTotal >= 0 ? 'green' : 'red'} />
            <Stat label="predicted P/L" value={`$${s.predictedTotal.toFixed(0)}`} accent={s.predictedTotal >= 0 ? 'green' : 'red'} />
          </div>
        ) : (
          <div className="rounded-[var(--radius-sm)] border border-dashed border-[var(--border)] p-6 text-center">
            <div className="text-[var(--fg-dim)] text-xs mb-2">no closed paper positions yet</div>
            <div className="text-[10px] text-[var(--fg-faint)] leading-relaxed">
              open a position on <a href="/trade" className="text-[var(--green)] underline">/trade</a> and close it — the
              calibration dashboard fills in automatically. you need at least 10-20 closes to draw any meaningful conclusions.
            </div>
          </div>
        )}
      </Panel>

      {hasData && (
        <>
          {/* CALIBRATION SCATTER */}
          <Panel title="~calibration-chart">
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 8, right: 16, left: 8, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="2 6" stroke="var(--border)" strokeOpacity={0.4} />
                  <XAxis
                    type="number"
                    dataKey="predicted"
                    domain={[0, 1]}
                    tickFormatter={v => `${Math.round(v * 100)}%`}
                    label={{ value: 'predicted P(profit)', position: 'insideBottom', offset: -8, style: { fill: 'var(--fg-faint)', fontSize: 10 } }}
                    tick={{ fontSize: 10, fill: 'var(--fg-dim)' }}
                    stroke="var(--border-bright)"
                  />
                  <YAxis
                    type="number"
                    dataKey="realized"
                    domain={[0, 1]}
                    tickFormatter={v => `${Math.round(v * 100)}%`}
                    label={{ value: 'realized win rate', angle: -90, position: 'insideLeft', offset: 10, style: { fill: 'var(--fg-faint)', fontSize: 10 } }}
                    tick={{ fontSize: 10, fill: 'var(--fg-dim)' }}
                    stroke="var(--border-bright)"
                  />
                  <Tooltip
                    contentStyle={{ background: 'rgba(17,24,26,0.95)', border: '1px solid var(--border-bright)', borderRadius: 8, fontSize: 11 }}
                    formatter={(v: any, k: any) => k === 'predicted' ? `${(Number(v)*100).toFixed(0)}% predicted` : `${(Number(v)*100).toFixed(0)}% realized`}
                    labelFormatter={() => ''}
                  />
                  <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 1, y: 1 }]} stroke="var(--green)" strokeDasharray="3 3" strokeOpacity={0.6} label={{ value: 'perfect calibration', position: 'insideTopRight', fill: 'var(--green)', fontSize: 9, opacity: 0.6 }} />
                  <Scatter data={s.byBucketDatum} fill="var(--green-2)" />
                </ScatterChart>
              </ResponsiveContainer>
            </div>
            <div className="text-[10px] text-[var(--fg-faint)] mt-1 italic">
              each dot is a 10%-wide predicted-POP bucket (averaged across all positions in that bucket).
              point size = number of positions. dotted diagonal = perfect calibration.
            </div>
          </Panel>

          {/* CUMULATIVE P/L */}
          <Panel title="~cumulative-PnL">
            <CumulativePnL rows={rows} />
          </Panel>

          {/* BY STRATEGY */}
          <Panel title="~by-strategy">
            <div className="overflow-x-auto">
              <table className="text-xs w-full border-collapse">
                <thead>
                  <tr className="text-[var(--fg-faint)] uppercase tracking-wider text-[10px] border-b border-[var(--border)]">
                    <th className="text-left py-2 pr-2 font-medium">strategy</th>
                    <th className="text-right py-2 px-2 font-medium">n</th>
                    <th className="text-right py-2 px-2 font-medium">predicted POP</th>
                    <th className="text-right py-2 px-2 font-medium">realized WR</th>
                    <th className="text-right py-2 px-2 font-medium">predicted P/L</th>
                    <th className="text-right py-2 px-2 font-medium">realized P/L</th>
                    <th className="text-right py-2 pl-2 font-medium">MAE</th>
                  </tr>
                </thead>
                <tbody>
                  {s.byStrategy.map(row => (
                    <tr key={row.strategy_id} className="border-b border-[var(--border)]/40 hover:bg-[var(--bg-3)]/30">
                      <td className="py-1.5 pr-2 text-[var(--fg)] font-bold">{row.strategy_id}</td>
                      <td className="text-right py-1.5 px-2 tabular-nums text-[var(--fg-dim)]">{row.count}</td>
                      <td className="text-right py-1.5 px-2 tabular-nums text-[var(--fg-dim)]">{(row.avgPredictedPop * 100).toFixed(0)}%</td>
                      <td className={`text-right py-1.5 px-2 tabular-nums ${row.realizedWinRate >= 0.5 ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}>
                        {(row.realizedWinRate * 100).toFixed(0)}%
                      </td>
                      <td className={`text-right py-1.5 px-2 tabular-nums ${row.predictedTotal >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}>
                        ${row.predictedTotal.toFixed(0)}
                      </td>
                      <td className={`text-right py-1.5 px-2 tabular-nums ${row.realizedTotal >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}>
                        ${row.realizedTotal.toFixed(0)}
                      </td>
                      <td className="text-right py-1.5 pl-2 tabular-nums text-[var(--fg-dim)]">${row.mae.toFixed(0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="text-[10px] text-[var(--fg-faint)] mt-2 italic">
              MAE = mean absolute error of per-contract P/L across all closed positions of that strategy.
              smaller MAE relative to predicted size = better calibration.
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}

function CumulativePnL({ rows }: { rows: CalibrationRow[] }) {
  const closed = rows
    .filter(r => r.closed_at != null && r.realized_pnl != null)
    .slice()
    .sort((a, b) => (a.closed_at! < b.closed_at! ? -1 : 1));

  if (closed.length === 0) {
    return <div className="text-[var(--fg-dim)] text-xs italic p-3">no closed positions yet</div>;
  }

  let cumReal = 0;
  let cumPred = 0;
  const data = closed.map(r => {
    cumReal += r.realized_pnl ?? 0;
    cumPred += r.predicted_pnl ?? 0;
    return {
      date: (r.closed_at ?? '').slice(0, 10),
      realized: Math.round(cumReal),
      predicted: Math.round(cumPred),
    };
  });

  return (
    <div className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
          <CartesianGrid strokeDasharray="2 6" stroke="var(--border)" strokeOpacity={0.4} />
          <XAxis dataKey="date" tick={{ fontSize: 9, fill: 'var(--fg-faint)' }} stroke="var(--border-bright)" />
          <YAxis tick={{ fontSize: 9, fill: 'var(--fg-faint)' }} stroke="var(--border-bright)" tickFormatter={v => `$${v}`} width={48} />
          <Tooltip
            contentStyle={{ background: 'rgba(17,24,26,0.95)', border: '1px solid var(--border-bright)', borderRadius: 8, fontSize: 11 }}
            formatter={(v: any, k: any) => `${k === 'realized' ? 'realized' : 'predicted'}: $${v}`}
          />
          <Line type="monotone" dataKey="predicted" stroke="var(--green-2)" strokeWidth={1.5} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
          <Line type="monotone" dataKey="realized" stroke="var(--green)" strokeWidth={2.5} dot={{ r: 3, fill: 'var(--green)' }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
