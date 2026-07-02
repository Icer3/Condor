// Tests for the calibration dashboard pure aggregations.
// No DB access — just feeding rows into summarize() and checking outputs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize, emptySummary } from '../lib/calibration/summary';
import type { CalibrationRow } from '../lib/db/supabase/calibrationRepo';

function row(partial: Partial<CalibrationRow>): CalibrationRow {
  return {
    user_id: 'usr_test',
    position_id: 'pos_' + Math.random().toString(36).slice(2, 8),
    strategy_id: 'iron_condor',
    ticker: 'SPY',
    opened_at: '2026-06-01T15:00:00Z',
    closed_at: null,
    predicted_pop: 0.6,
    predicted_pnl: 100,
    predicted_maxloss: 400,
    max_profit: 100,
    realized_pnl: null,
    close_reason: null,
    sigma_at_entry: null,
    ...partial,
  };
}

test('emptySummary returns safe defaults', () => {
  const s = emptySummary();
  assert.equal(s.totalClosed, 0);
  assert.equal(s.totalOpens, 0);
  assert.equal(s.winRate, 0);
  assert.equal(s.calibrationError, 0);
  assert.deepEqual(s.byPopBucket, []);
  assert.deepEqual(s.byStrategy, []);
});

test('summarize counts opens vs closed correctly', () => {
  const s = summarize([
    row({ position_id: 'a', closed_at: null, realized_pnl: null }),
    row({ position_id: 'b', closed_at: '2026-06-02T15:00:00Z', realized_pnl: 50 }),
    row({ position_id: 'c', closed_at: '2026-06-03T15:00:00Z', realized_pnl: -100 }),
  ]);
  assert.equal(s.totalOpens, 3);
  assert.equal(s.totalClosed, 2);
  assert.equal(s.totalOpen, 1);
});

test('summarize win rate', () => {
  const s = summarize([
    row({ closed_at: '2026-06-02T15:00:00Z', realized_pnl: 50, position_id: 'a' }),
    row({ closed_at: '2026-06-03T15:00:00Z', realized_pnl: -10, position_id: 'b' }),
    row({ closed_at: '2026-06-04T15:00:00Z', realized_pnl: 200, position_id: 'c' }),
    row({ closed_at: '2026-06-05T15:00:00Z', realized_pnl: -10, position_id: 'd' }),
  ]);
  assert.equal(s.winRate, 0.5); // 2 of 4
});

test('summarize calibration error = |realized - predicted| / |predicted|', () => {
  const s = summarize([
    row({ closed_at: '2026-06-02T15:00:00Z', realized_pnl: 80,  predicted_pnl: 100, position_id: 'a' }),
    row({ closed_at: '2026-06-03T15:00:00Z', realized_pnl: 120, predicted_pnl: 100, position_id: 'b' }),
  ]);
  // total realized = 200, total predicted = 200 → 0% error
  assert.equal(s.realizedTotal, 200);
  assert.equal(s.predictedTotal, 200);
  assert.equal(s.calibrationError, 0);

  const s2 = summarize([
    row({ closed_at: '2026-06-02T15:00:00Z', realized_pnl: 60,  predicted_pnl: 100, position_id: 'a' }),
    row({ closed_at: '2026-06-03T15:00:00Z', realized_pnl: 140, predicted_pnl: 100, position_id: 'b' }),
  ]);
  // still 200 vs 200 → 0
  assert.equal(s2.calibrationError, 0);

  const s3 = summarize([
    row({ closed_at: '2026-06-02T15:00:00Z', realized_pnl: 100, predicted_pnl: 100, position_id: 'a' }),
    row({ closed_at: '2026-06-03T15:00:00Z', realized_pnl: 100, predicted_pnl: 200, position_id: 'b' }),
  ]);
  // realized=200, predicted=300 → |200-300|/300 = 0.333
  assert.equal(s3.calibrationError.toFixed(3), '0.333');
});

test('summarize bins predicted_pop into buckets', () => {
  const s = summarize([
    row({ predicted_pop: 0.05, realized_pnl: 100, closed_at: '2026-06-02T15:00:00Z', position_id: 'a' }), // bucket 0
    row({ predicted_pop: 0.08, realized_pnl: -50, closed_at: '2026-06-03T15:00:00Z', position_id: 'b' }), // bucket 0
    row({ predicted_pop: 0.55, realized_pnl: 50, closed_at: '2026-06-04T15:00:00Z', position_id: 'c' }), // bucket 5
    row({ predicted_pop: 0.62, realized_pnl: 200, closed_at: '2026-06-05T15:00:00Z', position_id: 'd' }), // bucket 6
  ]);
  // Bucket 0 (0-10%): 2 trades, 1 win → 50% realized win rate
  const b0 = s.byPopBucket.find(b => b.bucketLabel === '0-10%')!;
  assert.equal(b0.count, 2);
  assert.equal(b0.realizedWinRate, 0.5);
  // Mid-range bins exist
  assert.ok(s.byBucketDatum.length >= 2);
});

test('summarize groups by strategy', () => {
  const s = summarize([
    row({ strategy_id: 'iron_condor', closed_at: '2026-06-02T15:00:00Z', realized_pnl: 80, predicted_pnl: 100, predicted_pop: 0.6, position_id: 'a' }),
    row({ strategy_id: 'iron_condor', closed_at: '2026-06-03T15:00:00Z', realized_pnl: 120, predicted_pnl: 100, predicted_pop: 0.65, position_id: 'b' }),
    row({ strategy_id: 'bull_call_spread', closed_at: '2026-06-04T15:00:00Z', realized_pnl: -50, predicted_pnl: 80, predicted_pop: 0.55, position_id: 'c' }),
  ]);
  const ic = s.byStrategy.find(x => x.strategy_id === 'iron_condor')!;
  assert.equal(ic.count, 2);
  assert.equal(ic.realizedWinRate, 1.0);
  assert.equal(ic.predictedTotal, 200);
  assert.equal(ic.realizedTotal, 200);

  const bc = s.byStrategy.find(x => x.strategy_id === 'bull_call_spread')!;
  assert.equal(bc.count, 1);
  assert.equal(bc.realizedWinRate, 0);
  assert.equal(bc.realizedTotal, -50);
});

test('summarize handles rows without predicted data (legacy positions)', () => {
  const s = summarize([
    row({ closed_at: '2026-06-02T15:00:00Z', realized_pnl: 100, predicted_pop: null, predicted_pnl: null, position_id: 'a' }),
  ]);
  assert.equal(s.totalClosed, 1);
  assert.equal(s.totalOpens, 1);
  // No buckets because no predicted_pop
  assert.equal(s.byPopBucket.length, 0);
  // Strategy breakdown still produced from realized_pnl alone (legacy positions count toward strategy stats).
  assert.equal(s.byStrategy.length, 1);
  assert.equal(s.winRate, 1);
});

test('summarize MAE calculation', () => {
  const s = summarize([
    row({ closed_at: '2026-06-02T15:00:00Z', realized_pnl: 90,  predicted_pnl: 100, position_id: 'a' }),
    row({ closed_at: '2026-06-03T15:00:00Z', realized_pnl: 110, predicted_pnl: 100, position_id: 'b' }),
  ]);
  // MAE = mean(|90-100|, |110-100|) = mean(10, 10) = 10
  const ic = s.byStrategy[0];
  assert.equal(ic.mae, 10);
});
