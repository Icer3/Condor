// /auto-paper — founder-mode auto-paper dashboard. Read-only view of the
// picks the cron has opened, their live MTM (via the same /api/quote feed
// the rest of the app uses), and the calibration stats from closed picks.
//
// The page is intentionally server-rendered (Next.js default) and reads
// SQLite directly on the server. No auth gate — it's a public read of the
// founder-mode dataset. Once we move to multi-user, this page will key off
// the user id and become opt-in.

import { getDb } from '@/lib/db/sqlite';
import {
  listAllPicks,
  listRecentRuns,
  listMarksForPick,
  PickRow,
  MarkRow,
  RunRow,
} from '@/lib/db/autoPaperRepo';
import { markToMarket, remainingDte } from '@/lib/autoPaper/markToMarket';
import { Leg } from '@/lib/strategies';
import { summarize, CalibrationStats } from '@/lib/autoPaper/calibration';
import { Panel, Stat, Tag } from '@/components/Panels';
import { AutoPaperLive } from './AutoPaperLive';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface LiveRow {
  id: string;
  ticker: string;
  strategy: string;
  openedAt: string;
  dteRemaining: number;
  spot: number | null;
  mtmPerContract: number | null;
  unrealizedPnl: number | null;
  status: string;
  closeReason: string | null;
  predictedPop: number;
  predictedPnl: number;
  notes: string | null;
  spotAtOpen: number;
  closedAt: string | null;
  realizedPnl: number | null;
  closePerContract: number | null;
}

export default async function AutoPaperPage() {
  let rows: PickRow[] = [];
  let runs: RunRow[] = [];
  let dbErr: string | null = null;
  try {
    const db = await getDb();
    rows = listAllPicks(db, 100);
    runs = listRecentRuns(db, 20);
  } catch (e: any) {
    dbErr = e?.message ?? 'DB unavailable';
  }

  // Build summary stats from closed picks only.
  const closedRows = rows.filter(r => r.closed_at != null && r.realized_pnl != null).map(r => ({
    pick_id: r.id,
    ticker: r.ticker,
    strategy_id: r.strategy_id,
    opened_at: r.opened_at,
    closed_at: r.closed_at,
    predicted_pop: r.predicted_pop,
    predicted_pnl: r.predicted_pnl,
    predicted_maxloss: r.predicted_maxloss,
    max_profit: r.max_profit,
    realized_pnl: r.realized_pnl,
    close_reason: r.close_reason,
  }));
  const stats: CalibrationStats = summarize(closedRows);

  return (
    <div className="space-y-3">
      <Panel
        title="~auto_paper"
        right={
          <div className="flex items-center gap-2">
            <Tag color="green">founder mode</Tag>
            <Tag color="dim">{rows.filter(r => r.status === 'open').length} open · {rows.length} total</Tag>
          </div>
        }
      >
        <div className="text-[11px] italic text-[var(--fg-dim)] leading-relaxed border-l-2 border-[var(--green-dim)] pl-2">
          <span className="font-bold text-[var(--green)] not-italic mr-1">predicted vs reality, on autopilot.</span>{' '}
          a founder-mode cron opens one paper trade per ticker in{' '}
          <code className="text-[var(--fg)]">AUTO_PAPER_WATCHLIST</code> after the close, marks them daily,
          and closes at profit target / stop / expiry. the dataset feeds the calibration dashboard
          and is the dataset no competitor can replicate in &lt;12 months.
        </div>
        {dbErr && (
          <div className="mt-2 text-xs text-[var(--red)] border border-[var(--red-border)] rounded p-2">
            ! {dbErr}
          </div>
        )}
      </Panel>

      {stats.closed > 0 && (
        <Panel title="~calibration">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Stat label="closed" value={stats.closed.toString()} />
            <Stat label="win rate" value={`${(stats.winRate * 100).toFixed(0)}%`} accent={stats.winRate >= 0.5 ? 'green' : 'red'} />
            <Stat label="realized P/L" value={`$${stats.realizedTotal.toFixed(0)}`} accent={stats.realizedTotal >= 0 ? 'green' : 'red'} />
            <Stat label="predicted P/L" value={`$${stats.predictedTotal.toFixed(0)}`} accent={stats.predictedTotal >= 0 ? 'green' : 'red'} />
            <Stat label="calibration error" value={`${(stats.calibrationError * 100).toFixed(0)}%`} accent={stats.calibrationError < 0.2 ? 'green' : stats.calibrationError < 0.5 ? 'yellow' : 'red'} />
            <Stat label="MAE / pick" value={`$${stats.meanAbsoluteError.toFixed(0)}`} />
            <Stat label="wins" value={stats.wins.toString()} accent="green" />
            <Stat label="losses" value={stats.losses.toString()} accent="red" />
          </div>
          {stats.byStrategy.length > 0 && (
            <div className="mt-3 overflow-x-auto">
              <table className="text-xs w-full border-collapse">
                <thead>
                  <tr className="text-[var(--fg-faint)] uppercase tracking-wider text-[10px] border-b border-[var(--border)]">
                    <th className="text-left py-2 pr-2 font-medium">strategy</th>
                    <th className="text-right py-2 px-2 font-medium">n</th>
                    <th className="text-right py-2 px-2 font-medium">predicted POP</th>
                    <th className="text-right py-2 px-2 font-medium">realized WR</th>
                    <th className="text-right py-2 px-2 font-medium">predicted P/L</th>
                    <th className="text-right py-2 pl-2 font-medium">realized P/L</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.byStrategy.map(row => (
                    <tr key={row.strategy_id} className="border-b border-[var(--border)]/40">
                      <td className="py-1.5 pr-2 text-[var(--fg)] font-bold">{row.strategy_id}</td>
                      <td className="text-right py-1.5 px-2 tabular-nums text-[var(--fg-dim)]">{row.count}</td>
                      <td className="text-right py-1.5 px-2 tabular-nums text-[var(--fg-dim)]">{(row.avgPredictedPop * 100).toFixed(0)}%</td>
                      <td className={`text-right py-1.5 px-2 tabular-nums ${row.realizedPop >= 0.5 ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}>
                        {(row.realizedPop * 100).toFixed(0)}%
                      </td>
                      <td className={`text-right py-1.5 px-2 tabular-nums ${row.predictedTotal >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}>
                        ${row.predictedTotal.toFixed(0)}
                      </td>
                      <td className={`text-right py-1.5 pl-2 tabular-nums ${row.realizedTotal >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}>
                        ${row.realizedTotal.toFixed(0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}

      <Panel title="~picks" right={<Tag color="dim">most recent 100</Tag>}>
        {rows.length === 0 ? (
          <div className="rounded-[var(--radius-sm)] border border-dashed border-[var(--border)] p-6 text-center">
            <div className="text-[var(--fg-dim)] text-xs mb-2">no picks yet</div>
            <div className="text-[10px] text-[var(--fg-faint)] leading-relaxed max-w-[460px] mx-auto">
              the auto-paper cron runs at 16:00 ET (weekdays) and opens trades against your watchlist.
              rows will appear here automatically after the first run. you can also poke the cron
              manually with <code className="text-[var(--fg)]">curl http://localhost:3000/api/cron/auto-paper-open</code> for a local dry-run.
            </div>
          </div>
        ) : (
          <AutoPaperLive initialRows={rows} />
        )}
      </Panel>

      {runs.length > 0 && (
        <Panel title="~runs" right={<Tag color="dim">last 20</Tag>}>
          <div className="space-y-1">
            {runs.map(r => (
              <div key={r.id} className="flex items-center gap-2 text-[10px] tabular-nums border-b border-[var(--border)]/30 pb-1">
                <span className="text-[var(--fg-dim)] font-mono w-44 flex-shrink-0">{r.ran_at.replace('T', ' ').slice(0, 19)}Z</span>
                <Tag color={r.kind === 'open' ? 'green' : r.kind === 'mark' ? 'yellow' : 'dim'}>{r.kind}</Tag>
                <span className="text-[var(--fg-dim)]">seen {r.tickers_seen}</span>
                {r.picks_opened > 0 && <span className="text-[var(--green)]">opened {r.picks_opened}</span>}
                {r.picks_marked > 0 && <span className="text-[var(--yellow)]">marked {r.picks_marked}</span>}
                {r.picks_closed > 0 && <span className="text-[var(--red)]">closed {r.picks_closed}</span>}
                {r.duration_ms != null && <span className="text-[var(--fg-faint)] ml-auto">{r.duration_ms}ms</span>}
              </div>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}