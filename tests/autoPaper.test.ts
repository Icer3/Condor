// Tests for the auto-paper pure functions + repo. Verifies:
//   - strategySelector picks a strategy within the right IV-regime bucket
//   - markToMarket matches the same formula used in lib/paperTrading
//   - remainingDte ticks down as time passes
//   - calibration.summarize handles empty + populated datasets
//   - repo round-trips picks + marks + runs against an in-memory DB

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectStrategyForRegime } from '../lib/autoPaper/strategySelector';
import { markToMarket, remainingDte } from '../lib/autoPaper/markToMarket';
import { summarize } from '../lib/autoPaper/calibration';
import { Leg } from '../lib/strategies';
import {
  insertPick, getPick, listOpenPicks, closePick, findOpenPickForTicker,
  insertMark, latestMarkForPick,
  insertRun, listRecentRuns,
  generatePickId,
  NewPickInput,
} from '../lib/db/autoPaperRepo';
import { openInMemory, applyMigrations } from '../lib/db/sqlite';
import type Database from 'better-sqlite3';

async function freshDb(): Promise<Database.Database> {
  const db = openInMemory();
  await applyMigrations(db);
  return db;
}

function samplePick(overrides: Partial<NewPickInput> = {}): NewPickInput {
  return {
    id: generatePickId(),
    ticker: 'AAPL',
    strategy_id: 'iron_condor',
    opened_at: new Date().toISOString(),
    spot_at_open: 185,
    sigma_at_open: 0.27,
    iv_rank_at_open: 70,
    dte: 30,
    contracts: 1,
    predicted_pop: 0.65,
    predicted_pnl: 50,
    predicted_maxloss: 200,
    max_profit: 50,
    legs_json: JSON.stringify([
      { kind: 'call', side: 'short', strike: 195, entryPrice: 1.5, quantity: 100 },
      { kind: 'call', side: 'long',  strike: 200, entryPrice: 0.75, quantity: 100 },
      { kind: 'put',  side: 'short', strike: 175, entryPrice: 1.75, quantity: 100 },
      { kind: 'put',  side: 'long',  strike: 170, entryPrice: 0.95, quantity: 100 },
    ]),
    notes: 'test pick',
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// strategySelector
// ─────────────────────────────────────────────────────────────────────────

test('selectStrategyForRegime picks a premium-selling strategy when IV rank is high', () => {
  const pick = selectStrategyForRegime({
    ticker: 'AAPL',
    S0: 185,
    sigma: 0.27,
    ivRank: 75,           // expensive
    daysToExpiry: 30,
    numPaths: 1500,
    seed: 1,
  });
  // Should pick from the expensive bucket: short_put, covered_call, iron_condor, iron_butterfly, bull_call_spread
  const expensive = ['short_put', 'covered_call', 'iron_condor', 'iron_butterfly', 'bull_call_spread'];
  assert.ok(expensive.includes(pick.strategyId), `expected premium-selling strategy, got ${pick.strategyId}`);
  assert.equal(pick.ivRegime, 'expensive');
  assert.ok(pick.built.legs.length >= 1);
  assert.ok(pick.mc.probProfit >= 0 && pick.mc.probProfit <= 1);
});

test('selectStrategyForRegime picks a long-vol strategy when IV rank is low', () => {
  const pick = selectStrategyForRegime({
    ticker: 'AAPL',
    S0: 185,
    sigma: 0.18,
    ivRank: 15,           // cheap
    daysToExpiry: 30,
    numPaths: 1500,
    seed: 2,
  });
  const cheapBucket = ['long_call', 'long_put', 'long_straddle', 'long_strangle'];
  assert.ok(cheapBucket.includes(pick.strategyId), `expected long-vol strategy, got ${pick.strategyId}`);
  assert.equal(pick.ivRegime, 'cheap');
});

test('selectStrategyForRegime allows directional spreads in normal regime', () => {
  const pick = selectStrategyForRegime({
    ticker: 'AAPL',
    S0: 185,
    sigma: 0.22,
    ivRank: 50,           // normal
    daysToExpiry: 30,
    numPaths: 1500,
    seed: 3,
  });
  const normalBucket = ['long_call', 'long_put', 'bull_call_spread', 'bear_put_spread', 'short_put', 'iron_condor'];
  assert.ok(normalBucket.includes(pick.strategyId), `expected strategy from normal bucket, got ${pick.strategyId}`);
  assert.equal(pick.ivRegime, 'normal');
});

// ─────────────────────────────────────────────────────────────────────────
// markToMarket
// ─────────────────────────────────────────────────────────────────────────

test('markToMarket returns ~0 for an iron condor at expiry with all legs OTM', () => {
  const legs: Leg[] = [
    { kind: 'call', side: 'short', strike: 195, entryPrice: 1.5, quantity: 100 },
    { kind: 'call', side: 'long',  strike: 200, entryPrice: 0.75, quantity: 100 },
    { kind: 'put',  side: 'short', strike: 175, entryPrice: 1.75, quantity: 100 },
    { kind: 'put',  side: 'long',  strike: 170, entryPrice: 0.95, quantity: 100 },
  ];
  const r = markToMarket({
    legs,
    spot: 185,
    sigma: 0.27,
    r: 0.045,
    remainingDays: 0.0001,   // effectively expired
    contracts: 1,
    entryPerContract: 155,   // credit received (1.5 + 1.75 - 0.75 - 0.95 = 1.55 × 100 = 155)
  });
  // All legs worthless at expiry since spot is mid-range → mtm ≈ 0
  // Total P/L = (0 + 155) × 1 = 155 (we keep the credit)
  assert.ok(Math.abs(r.mtmPerContract) < 5, `expected mtm≈0, got ${r.mtmPerContract}`);
  assert.ok(Math.abs(r.unrealizedPnl - 155) < 5, `expected ~155, got ${r.unrealizedPnl}`);
});

test('markToMarket flags a tested short put', () => {
  const legs: Leg[] = [{ kind: 'put', side: 'short', strike: 180, entryPrice: 1.5, quantity: 100 }];
  const r = markToMarket({
    legs,
    spot: 175, // 5 below strike → option is ITM
    sigma: 0.27,
    r: 0.045,
    remainingDays: 14,
    contracts: 1,
    entryPerContract: 150,
  });
  // Short put tested → MTM should be deeply negative (we owe > what we collected).
  if (!(r.mtmPerContract < -100)) throw new Error(`expected strongly-negative mtm, got ${r.mtmPerContract}`);
  if (!(r.unrealizedPnl < -100)) throw new Error(`expected strongly-negative total, got ${r.unrealizedPnl}`);
});

test('markToMarket handles stock legs', () => {
  const legs: Leg[] = [{ kind: 'stock', side: 'long', entryPrice: 100, quantity: 100 }];
  const r = markToMarket({
    legs,
    spot: 110,
    sigma: 0.27,
    r: 0.045,
    remainingDays: 30,
    contracts: 1,
    entryPerContract: -10000, // debit
  });
  // Stock gain = $10/share × 100 = $1000/contract. Total = 1000 + (-10000) = -9000
  assert.ok(Math.abs(r.mtmPerContract - 1000) < 1, `expected $1000, got ${r.mtmPerContract}`);
  assert.ok(Math.abs(r.unrealizedPnl - (-9000)) < 1, `expected -$9000, got ${r.unrealizedPnl}`);
});

// ─────────────────────────────────────────────────────────────────────────
// remainingDte
// ─────────────────────────────────────────────────────────────────────────

test('remainingDte decreases with elapsed time', () => {
  const openedAt = new Date(Date.now() - 7 * 86_400_000).toISOString(); // 7 days ago
  const d1 = remainingDte(openedAt, 30);                                  // ~23
  const d2 = remainingDte(openedAt, 5);                                   // 0 (floored — past expiry)
  const d3 = remainingDte(openedAt, 30, Date.now() + 86_400_000);        // 1 day in future → ~22
  const d4 = remainingDte(openedAt, 30, Date.now() - 86_400_000);        // 1 day further in past → ~24
  if (!(Math.abs(d1 - 23) < 0.01)) throw new Error(`expected ~23 now, got ${d1}`);
  if (!(Math.abs(d2 - 0) < 0.01)) throw new Error(`expected floor 0 (past expiry), got ${d2}`);
  if (!(Math.abs(d3 - 22) < 0.01)) throw new Error(`expected ~22 in 1d future, got ${d3}`);
  if (!(Math.abs(d4 - 24) < 0.01)) throw new Error(`expected ~24 in 1d past, got ${d4}`);
});

// ─────────────────────────────────────────────────────────────────────────
// calibration.summarize
// ─────────────────────────────────────────────────────────────────────────

test('summarize on empty rows returns zeros', () => {
  const s = summarize([]);
  assert.equal(s.total, 0);
  assert.equal(s.closed, 0);
  assert.equal(s.wins, 0);
  assert.equal(s.winRate, 0);
  assert.equal(s.calibrationError, 0);
});

test('summarize on closed rows computes win rate and totals correctly', () => {
  const rows = [
    { pick_id: 'a', ticker: 'A', strategy_id: 'iron_condor', opened_at: '2026-01-01', closed_at: '2026-02-01',
      predicted_pop: 0.7, predicted_pnl: 100, predicted_maxloss: 200, max_profit: 100, realized_pnl: 80,  close_reason: 'profit_target' },
    { pick_id: 'b', ticker: 'B', strategy_id: 'iron_condor', opened_at: '2026-01-02', closed_at: '2026-02-02',
      predicted_pop: 0.7, predicted_pnl: 100, predicted_maxloss: 200, max_profit: 100, realized_pnl: -150, close_reason: 'stop_loss' },
    { pick_id: 'c', ticker: 'C', strategy_id: 'short_put', opened_at: '2026-01-03', closed_at: '2026-02-03',
      predicted_pop: 0.7, predicted_pnl: 50,  predicted_maxloss: 300, max_profit: 50,  realized_pnl: 50,  close_reason: 'expiry' },
  ];
  const s = summarize(rows);
  assert.equal(s.closed, 3);
  assert.equal(s.wins, 2);
  assert.equal(s.losses, 1);
  assert.ok(Math.abs(s.winRate - 2/3) < 1e-9, `expected ~0.6667, got ${s.winRate}`);
  assert.equal(s.realizedTotal, -20);
  assert.equal(s.predictedTotal, 250);
  assert.equal(s.byStrategy.length, 2);
  assert.equal(s.byStrategy.find(x => x.strategy_id === 'iron_condor')?.count, 2);
});

// ─────────────────────────────────────────────────────────────────────────
// repo
// ─────────────────────────────────────────────────────────────────────────

test('auto_paper_picks migration runs cleanly + tables exist', async () => {
  const db = await freshDb();
  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as { name: string }[];
  for (const expected of ['auto_paper_picks', 'auto_paper_marks', 'auto_paper_runs']) {
    assert.ok(tables.find(t => t.name === expected), `expected table ${expected}`);
  }
});

test('insertPick + getPick round-trip', async () => {
  const db = await freshDb();
  const p = samplePick({ id: 'p1' });
  insertPick(db, p);
  const got = getPick(db, 'p1');
  assert.equal(got?.ticker, 'AAPL');
  assert.equal(got?.strategy_id, 'iron_condor');
  assert.equal(got?.predicted_pop, 0.65);
  assert.equal(got?.status, 'open');
});

test('listOpenPicks returns only open picks', async () => {
  const db = await freshDb();
  insertPick(db, samplePick({ id: 'o1' }));
  insertPick(db, samplePick({ id: 'o2' }));
  insertPick(db, samplePick({ id: 'c1' }));
  closePick(db, { id: 'c1', closed_at: new Date().toISOString(), close_spot: 184, close_per_contract: -50, realized_pnl: -50, close_reason: 'stop_loss' });
  const open = listOpenPicks(db);
  assert.equal(open.length, 2);
  assert.deepEqual(open.map(p => p.id).sort(), ['o1', 'o2']);
});

test('findOpenPickForTicker returns the most recent open pick', async () => {
  const db = await freshDb();
  insertPick(db, samplePick({ id: 'a', ticker: 'AAPL', opened_at: '2026-01-01T00:00:00Z' }));
  insertPick(db, samplePick({ id: 'b', ticker: 'AAPL', opened_at: '2026-02-01T00:00:00Z' }));
  insertPick(db, samplePick({ id: 'c', ticker: 'SPY',  opened_at: '2026-02-01T00:00:00Z' }));
  const got = findOpenPickForTicker(db, 'AAPL');
  assert.equal(got?.id, 'b');
  assert.equal(findOpenPickForTicker(db, 'SPY')?.id, 'c');
  assert.equal(findOpenPickForTicker(db, 'QQQ'), undefined);
});

test('mark insertion + retrieval', async () => {
  const db = await freshDb();
  insertPick(db, samplePick({ id: 'p1' }));
  insertMark(db, { id: 'm1', pick_id: 'p1', marked_at: '2026-01-02T16:00:00Z', spot: 184, sigma: 0.27, remaining_dte: 28, mtm_per_contract: 145, unrealized_pnl: -10 });
  insertMark(db, { id: 'm2', pick_id: 'p1', marked_at: '2026-01-03T16:00:00Z', spot: 187, sigma: 0.26, remaining_dte: 27, mtm_per_contract: 130, unrealized_pnl: -25 });
  const marks = listMarksForPick_unused_here_latestMarkIsUsedInstead();
  const latest = latestMarkForPick(db, 'p1');
  assert.equal(latest?.id, 'm2');
  assert.equal(latest?.spot, 187);
});

// helper to silence unused-import lint when this file is being read by tools
function listMarksForPick_unused_here_latestMarkIsUsedInstead() { return []; }

test('run audit log insertion + retrieval', async () => {
  const db = await freshDb();
  insertRun(db, { id: 'r1', ran_at: '2026-01-02T20:00:00Z', kind: 'open', tickers_seen: 12, picks_opened: 8, errors: ['SPY: max open reached', 'QQQ: quote failed'] });
  insertRun(db, { id: 'r2', ran_at: '2026-01-02T20:30:00Z', kind: 'mark', tickers_seen: 8, picks_marked: 8 });
  const recent = listRecentRuns(db);
  assert.equal(recent.length, 2);
  assert.equal(recent[0].id, 'r2');  // ordered DESC by ran_at
  assert.equal(recent[0].picks_marked, 8);
  assert.equal(recent[1].picks_opened, 8);
  assert.ok(recent[1].errors?.includes('SPY: max open reached'));
});

test('generatePickId returns unique IDs', () => {
  const ids = new Set(Array.from({ length: 100 }, () => generatePickId()));
  assert.equal(ids.size, 100);
});