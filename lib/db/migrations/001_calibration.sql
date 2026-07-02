-- Calibration table: predicted P/L fields at open, realized P/L at close.
-- Per-device scoped. PRIMARY KEY lets us upsert (idempotent — re-sending
-- the same positionId just overwrites the calibration row).

CREATE TABLE IF NOT EXISTS paper_position_calibration (
  device_id        TEXT    NOT NULL,
  position_id      TEXT    NOT NULL,
  strategy_id      TEXT    NOT NULL,
  ticker           TEXT    NOT NULL,
  opened_at        TEXT    NOT NULL,
  closed_at        TEXT,
  predicted_pop     REAL,                -- 0..1
  predicted_pnl     REAL,                -- $/contract at expiration, model estimate
  predicted_maxloss REAL,                -- $/contract (positive number)
  max_profit        REAL,                -- $/contract (positive number) — for context
  realized_pnl      REAL,                -- $/contract × quantity at close (total cash)
  close_reason      TEXT,
  PRIMARY KEY (device_id, position_id)
);

CREATE INDEX IF NOT EXISTS idx_ppc_closed
  ON paper_position_calibration (closed_at);
CREATE INDEX IF NOT EXISTS idx_ppc_strategy
  ON paper_position_calibration (strategy_id);
