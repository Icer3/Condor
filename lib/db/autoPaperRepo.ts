// Typed read/write for auto_paper_picks / auto_paper_marks / auto_paper_runs.
// Pure functions over a passed-in better-sqlite3 Database.

import type Database from 'better-sqlite3';

// ─────────────────────────────────────────────────────────────────────────
// Picks
// ─────────────────────────────────────────────────────────────────────────

export type PickStatus = 'open' | 'closed' | 'expired';

export interface PickRow {
  id: string;
  ticker: string;
  strategy_id: string;
  opened_at: string;
  spot_at_open: number;
  sigma_at_open: number;
  iv_rank_at_open: number;
  dte: number;
  contracts: number;
  predicted_pop: number;
  predicted_pnl: number;
  predicted_maxloss: number;
  max_profit: number;
  status: PickStatus;
  closed_at: string | null;
  close_spot: number | null;
  close_per_contract: number | null;
  realized_pnl: number | null;
  close_reason: string | null;
  legs_json: string;
  notes: string | null;
}

export interface NewPickInput {
  id: string;
  ticker: string;
  strategy_id: string;
  opened_at: string;
  spot_at_open: number;
  sigma_at_open: number;
  iv_rank_at_open: number;
  dte: number;
  contracts: number;
  predicted_pop: number;
  predicted_pnl: number;
  predicted_maxloss: number;
  max_profit: number;
  legs_json: string;
  notes?: string | null;
}

export function insertPick(db: Database.Database, p: NewPickInput): void {
  db.prepare(`
    INSERT INTO auto_paper_picks (
      id, ticker, strategy_id, opened_at,
      spot_at_open, sigma_at_open, iv_rank_at_open, dte, contracts,
      predicted_pop, predicted_pnl, predicted_maxloss, max_profit,
      status, legs_json, notes
    ) VALUES (
      @id, @ticker, @strategy_id, @opened_at,
      @spot_at_open, @sigma_at_open, @iv_rank_at_open, @dte, @contracts,
      @predicted_pop, @predicted_pnl, @predicted_maxloss, @max_profit,
      'open', @legs_json, @notes
    )
  `).run({
    ...p,
    notes: p.notes ?? null,
  });
}

export function getPick(db: Database.Database, id: string): PickRow | undefined {
  return db.prepare(`SELECT * FROM auto_paper_picks WHERE id = ?`).get(id) as PickRow | undefined;
}

export function listOpenPicks(db: Database.Database): PickRow[] {
  return db.prepare(`SELECT * FROM auto_paper_picks WHERE status = 'open' ORDER BY opened_at ASC`).all() as PickRow[];
}

export function listPicksByTicker(db: Database.Database, ticker: string, limit = 50): PickRow[] {
  return db.prepare(`
    SELECT * FROM auto_paper_picks
    WHERE ticker = ?
    ORDER BY opened_at DESC
    LIMIT ?
  `).all(ticker, limit) as PickRow[];
}

export function listAllPicks(db: Database.Database, limit = 200): PickRow[] {
  return db.prepare(`SELECT * FROM auto_paper_picks ORDER BY opened_at DESC LIMIT ?`).all(limit) as PickRow[];
}

export function listClosedPicks(db: Database.Database, limit = 200): PickRow[] {
  return db.prepare(`
    SELECT * FROM auto_paper_picks
    WHERE status IN ('closed', 'expired')
    ORDER BY closed_at DESC
    LIMIT ?
  `).all(limit) as PickRow[];
}

export function closePick(db: Database.Database, input: {
  id: string;
  closed_at: string;
  close_spot: number;
  close_per_contract: number;
  realized_pnl: number;
  close_reason: string;
}): void {
  db.prepare(`
    UPDATE auto_paper_picks
       SET status            = CASE WHEN @close_reason = 'expiry' THEN 'expired' ELSE 'closed' END,
           closed_at         = @closed_at,
           close_spot        = @close_spot,
           close_per_contract= @close_per_contract,
           realized_pnl      = @realized_pnl,
           close_reason      = @close_reason
     WHERE id = @id
  `).run(input);
}

/** Find the most recent open pick for a ticker, if any. Used to skip re-opening
 *  when a position is still on. */
export function findOpenPickForTicker(db: Database.Database, ticker: string): PickRow | undefined {
  return db.prepare(`
    SELECT * FROM auto_paper_picks
    WHERE ticker = ? AND status = 'open'
    ORDER BY opened_at DESC
    LIMIT 1
  `).get(ticker) as PickRow | undefined;
}

// ─────────────────────────────────────────────────────────────────────────
// Marks
// ─────────────────────────────────────────────────────────────────────────

export interface MarkRow {
  id: string;
  pick_id: string;
  marked_at: string;
  spot: number;
  sigma: number;
  remaining_dte: number;
  mtm_per_contract: number;
  unrealized_pnl: number;
}

export interface NewMarkInput {
  id: string;
  pick_id: string;
  marked_at: string;
  spot: number;
  sigma: number;
  remaining_dte: number;
  mtm_per_contract: number;
  unrealized_pnl: number;
}

export function insertMark(db: Database.Database, m: NewMarkInput): void {
  db.prepare(`
    INSERT INTO auto_paper_marks
      (id, pick_id, marked_at, spot, sigma, remaining_dte, mtm_per_contract, unrealized_pnl)
    VALUES
      (@id, @pick_id, @marked_at, @spot, @sigma, @remaining_dte, @mtm_per_contract, @unrealized_pnl)
  `).run(m);
}

export function listMarksForPick(db: Database.Database, pickId: string): MarkRow[] {
  return db.prepare(`SELECT * FROM auto_paper_marks WHERE pick_id = ? ORDER BY marked_at ASC`).all(pickId) as MarkRow[];
}

export function latestMarkForPick(db: Database.Database, pickId: string): MarkRow | undefined {
  return db.prepare(`SELECT * FROM auto_paper_marks WHERE pick_id = ? ORDER BY marked_at DESC LIMIT 1`).get(pickId) as MarkRow | undefined;
}

// ─────────────────────────────────────────────────────────────────────────
// Runs (audit log)
// ─────────────────────────────────────────────────────────────────────────

export interface RunRow {
  id: string;
  ran_at: string;
  kind: 'open' | 'mark' | 'close_expired';
  tickers_seen: number;
  picks_opened: number;
  picks_marked: number;
  picks_closed: number;
  errors: string | null;
  duration_ms: number | null;
}

export interface NewRunInput {
  id: string;
  ran_at: string;
  kind: 'open' | 'mark' | 'close_expired';
  tickers_seen: number;
  picks_opened?: number;
  picks_marked?: number;
  picks_closed?: number;
  errors?: string[];
  duration_ms?: number;
}

export function insertRun(db: Database.Database, r: NewRunInput): void {
  db.prepare(`
    INSERT INTO auto_paper_runs
      (id, ran_at, kind, tickers_seen, picks_opened, picks_marked, picks_closed, errors, duration_ms)
    VALUES
      (@id, @ran_at, @kind, @tickers_seen, @picks_opened, @picks_marked, @picks_closed, @errors, @duration_ms)
  `).run({
    ...r,
    picks_opened: r.picks_opened ?? 0,
    picks_marked: r.picks_marked ?? 0,
    picks_closed: r.picks_closed ?? 0,
    errors: r.errors && r.errors.length ? JSON.stringify(r.errors) : null,
    duration_ms: r.duration_ms ?? null,
  });
}

export function listRecentRuns(db: Database.Database, limit = 30): RunRow[] {
  return db.prepare(`SELECT * FROM auto_paper_runs ORDER BY ran_at DESC LIMIT ?`).all(limit) as RunRow[];
}

/** Small ULID-ish id generator: 16 chars of timestamp + 8 of randomness.
 *  Good enough for cron-generated ids; not cryptographically random. */
export function generatePickId(): string {
  const ts = Date.now().toString(36).padStart(10, '0');
  const rand = Math.random().toString(36).slice(2, 10);
  return `ap_${ts}${rand}`;
}