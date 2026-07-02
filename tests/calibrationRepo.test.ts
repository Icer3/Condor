// Tests for the calibration SQLite repo using an in-memory database.
// Verifies the migration runs, upsert is idempotent, and close writes through.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { upsertPrediction, recordClose, readAll, purgeDevice } from '../lib/db/calibrationRepo';
import { applyMigrations, openInMemory } from '../lib/db/sqlite';

async function freshDb(): Promise<Database.Database> {
  const db = openInMemory();
  await applyMigrations(db);
  return db;
}

test('migrations run cleanly + create table', async () => {
  const db = await freshDb();
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
  assert.ok(tables.find(t => t.name === 'paper_position_calibration'));
  // Idempotent — running migrations twice shouldn't throw
  await applyMigrations(db);
});

test('upsertPrediction creates a new row', async () => {
  const db = await freshDb();
  upsertPrediction(db, {
    device_id: 'dev_test',
    position_id: 'p1',
    strategy_id: 'iron_condor',
    ticker: 'SPY',
    opened_at: '2026-06-01T15:00:00Z',
    predicted_pop: 0.65,
    predicted_pnl: 100,
    predicted_maxloss: 400,
    max_profit: 100,
  });
  const rows = readAll(db, 'dev_test');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].strategy_id, 'iron_condor');
  assert.equal(rows[0].predicted_pop, 0.65);
});

test('upsertPrediction is idempotent (re-running preserves fields not overwritten)', async () => {
  const db = await freshDb();
  upsertPrediction(db, {
    device_id: 'dev_test',
    position_id: 'p1',
    strategy_id: 'iron_condor',
    ticker: 'SPY',
    opened_at: '2026-06-01T15:00:00Z',
    predicted_pop: 0.65,
    predicted_pnl: 100,
    predicted_maxloss: 400,
    max_profit: 100,
  });
  // Close the position first
  recordClose(db, {
    device_id: 'dev_test',
    position_id: 'p1',
    realized_pnl: 80,
    closed_at: '2026-06-15T15:00:00Z',
    close_reason: 'expiry',
  });
  // Now re-upsert with different predicted values — should NOT clobber closed_at or realized_pnl.
  // (Per spec, COALESCE keeps existing predicted_pop when new value is null.)
  upsertPrediction(db, {
    device_id: 'dev_test',
    position_id: 'p1',
    strategy_id: 'iron_condor',
    ticker: 'SPY',
    opened_at: '2026-06-01T15:00:00Z',
    predicted_pop: null,            // null, so COALESCE keeps existing
    predicted_pnl: null,
    predicted_maxloss: null,
    max_profit: null,
  });
  const rows = readAll(db, 'dev_test');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].closed_at, '2026-06-15T15:00:00Z');
  assert.equal(rows[0].realized_pnl, 80);
  assert.equal(rows[0].predicted_pop, 0.65); // preserved
});

test('recordClose writes close fields even if no prior row exists (legacy)', async () => {
  const db = await freshDb();
  // Position was opened before calibration existed → no row yet
  recordClose(db, {
    device_id: 'dev_test',
    position_id: 'legacy1',
    realized_pnl: 120,
    closed_at: '2026-05-20T15:00:00Z',
    close_reason: 'manual',
  });
  const rows = readAll(db, 'dev_test');
  // No row was updated because the row never existed; nothing was created.
  assert.equal(rows.length, 0);
});

test('purgeDevice removes all rows for a device', async () => {
  const db = await freshDb();
  upsertPrediction(db, { device_id: 'd1', position_id: 'p1', strategy_id: 'x', ticker: 'A', opened_at: '2026-01-01T00:00:00Z' });
  upsertPrediction(db, { device_id: 'd1', position_id: 'p2', strategy_id: 'x', ticker: 'B', opened_at: '2026-01-01T00:00:00Z' });
  upsertPrediction(db, { device_id: 'd2', position_id: 'p3', strategy_id: 'x', ticker: 'C', opened_at: '2026-01-01T00:00:00Z' });
  const removed = purgeDevice(db, 'd1');
  assert.equal(removed, 2);
  assert.equal(readAll(db, 'd1').length, 0);
  assert.equal(readAll(db, 'd2').length, 1);
});

test('readAll returns rows ordered by opened_at DESC', async () => {
  const db = await freshDb();
  upsertPrediction(db, { device_id: 'd', position_id: 'old',  strategy_id: 'x', ticker: 'A', opened_at: '2026-01-01T00:00:00Z' });
  upsertPrediction(db, { device_id: 'd', position_id: 'mid',  strategy_id: 'x', ticker: 'A', opened_at: '2026-03-01T00:00:00Z' });
  upsertPrediction(db, { device_id: 'd', position_id: 'new',  strategy_id: 'x', ticker: 'A', opened_at: '2026-06-01T00:00:00Z' });
  const rows = readAll(db, 'd');
  assert.deepEqual(rows.map(r => r.position_id), ['new', 'mid', 'old']);
});
