// Typed read/write to the calibration table. Pure functions over a passed-in
// better-sqlite3 Database. No global state — caller is responsible for
// passing getDb() or an in-memory test instance.

import type Database from 'better-sqlite3';

export interface CalibrationRow {
  device_id: string;
  position_id: string;
  strategy_id: string;
  ticker: string;
  opened_at: string;
  closed_at: string | null;
  predicted_pop: number | null;
  predicted_pnl: number | null;
  predicted_maxloss: number | null;
  max_profit: number | null;
  realized_pnl: number | null;
  close_reason: string | null;
}

export interface CalUpsertInput {
  device_id: string;
  position_id: string;
  strategy_id: string;
  ticker: string;
  opened_at: string;
  predicted_pop?: number | null;
  predicted_pnl?: number | null;
  predicted_maxloss?: number | null;
  max_profit?: number | null;
}

export interface CalCloseInput {
  device_id: string;
  position_id: string;
  realized_pnl: number;
  closed_at: string;
  close_reason?: string | null;
}

/** Insert or update the predicted fields at open time. Idempotent. */
export function upsertPrediction(db: Database.Database, input: CalUpsertInput): void {
  db.prepare(`
    INSERT INTO paper_position_calibration
      (device_id, position_id, strategy_id, ticker, opened_at,
       predicted_pop, predicted_pnl, predicted_maxloss, max_profit,
       closed_at, realized_pnl, close_reason)
    VALUES
      (@device_id, @position_id, @strategy_id, @ticker, @opened_at,
       @predicted_pop, @predicted_pnl, @predicted_maxloss, @max_profit,
       NULL, NULL, NULL)
    ON CONFLICT (device_id, position_id) DO UPDATE SET
      predicted_pop     = COALESCE(excluded.predicted_pop,     paper_position_calibration.predicted_pop),
      predicted_pnl     = COALESCE(excluded.predicted_pnl,     paper_position_calibration.predicted_pnl),
      predicted_maxloss = COALESCE(excluded.predicted_maxloss, paper_position_calibration.predicted_maxloss),
      max_profit        = COALESCE(excluded.max_profit,        paper_position_calibration.max_profit)
  `).run({
    device_id: input.device_id,
    position_id: input.position_id,
    strategy_id: input.strategy_id,
    ticker: input.ticker,
    opened_at: input.opened_at,
    predicted_pop: input.predicted_pop ?? null,
    predicted_pnl: input.predicted_pnl ?? null,
    predicted_maxloss: input.predicted_maxloss ?? null,
    max_profit: input.max_profit ?? null,
  });
}

/** Record the realized P/L and close time. Idempotent — the row must already exist
 *  (was upserted at open). If the row isn't there yet, we still record the close
 *  so legacy positions without predicted fields can still get their realized outcome logged. */
export function recordClose(db: Database.Database, input: CalCloseInput): void {
  db.prepare(`
    UPDATE paper_position_calibration
       SET closed_at     = @closed_at,
           realized_pnl  = @realized_pnl,
           close_reason  = COALESCE(@close_reason, close_reason)
     WHERE device_id    = @device_id
       AND position_id  = @position_id
  `).run({
    device_id: input.device_id,
    position_id: input.position_id,
    realized_pnl: input.realized_pnl,
    closed_at: input.closed_at,
    close_reason: input.close_reason ?? null,
  });
}

/** Read all calibration rows for a device. Used by the dashboard. */
export function readAll(db: Database.Database, device_id: string): CalibrationRow[] {
  return db.prepare(`
    SELECT device_id, position_id, strategy_id, ticker, opened_at, closed_at,
           predicted_pop, predicted_pnl, predicted_maxloss, max_profit,
           realized_pnl, close_reason
      FROM paper_position_calibration
     WHERE device_id = ?
     ORDER BY opened_at DESC
  `).all(device_id) as CalibrationRow[];
}

/** Delete a device's calibration rows (used by settings "clear data"). */
export function purgeDevice(db: Database.Database, device_id: string): number {
  const res = db.prepare(`DELETE FROM paper_position_calibration WHERE device_id = ?`).run(device_id);
  return res.changes;
}
