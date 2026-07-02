import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectEarnings, EARNINGS_THRESHOLD } from '../lib/earnings';

function d(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10);
}

test('threshold is reasonable for equity moves', () => {
  assert.ok(EARNINGS_THRESHOLD >= 0.03 && EARNINGS_THRESHOLD <= 0.10);
});

test('detects earnings-like 4% single-day moves', () => {
  const candles = [
    { date: d(80), close: 100 }, { date: d(79), close: 92 },   // 8% drop (earnings)
    { date: d(78), close: 93 }, { date: d(77), close: 94 },
    { date: d(40), close: 95 }, { date: d(39), close: 100 },  // 5% pop (earnings)
    { date: d(38), close: 99 }, { date: d(37), close: 100 },
    { date: d(0), close: 102 },
  ];
  const e = detectEarnings(candles);
  assert.ok(e.signals.length >= 2, `expected ≥2 events, got ${e.signals.length}`);
});

test('returns safe-anywhere for short history', () => {
  const candles = [{ date: d(2), close: 100 }, { date: d(1), close: 101 }, { date: d(0), close: 102 }];
  const e = detectEarnings(candles);
  assert.equal(e.signals.length, 0);
  assert.equal(e.recommendation, 'safe-anywhere');
});

test('computes some average interval between detected earnings', () => {
  // Build a sparse series with clear earnings gaps, well outside the cluster window.
  // Total span = 200 days, with 4 earnings days evenly placed.
  const earningsDays = [200, 150, 100, 50];  // distance from today in days
  const candles = Array.from({ length: 200 }, (_, i) => ({
    date: d(200 - i),
    close: earningsDays.includes(200 - i) ? 92 : 100 + (i * 0.01),
  }));
  const e = detectEarnings(candles);
  assert.ok(e.averageIntervalDays != null, 'interval computed');
  assert.ok(e.averageIntervalDays! > 0, `interval positive: ${e.averageIntervalDays}`);
});

test('projects next earnings forward', () => {
  const candles = Array.from({ length: 200 }, (_, i) => ({
    date: d(200 - i),
    close: 100 + (i % 90 === 30 ? -8 : 0),
  }));
  const e = detectEarnings(candles);
  assert.ok(e.nextProjected != null, 'nextProjected should be defined');
});
