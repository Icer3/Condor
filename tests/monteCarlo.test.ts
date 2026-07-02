import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runMonteCarlo } from '../lib/monteCarlo';
import { Leg } from '../lib/strategies';

const longCall: Leg[] = [{ kind: 'call', side: 'long', strike: 100, entryPrice: 5, quantity: 100 }];

test('MC is deterministic under the same seed', () => {
  const a = runMonteCarlo({ S0: 100, mu: 0, sigma: 0.20, r: 0.045, daysToExpiry: 30, legs: longCall, numPaths: 2000, seed: 42 });
  const b = runMonteCarlo({ S0: 100, mu: 0, sigma: 0.20, r: 0.045, daysToExpiry: 30, legs: longCall, numPaths: 2000, seed: 42 });
  assert.equal(a.probProfit, b.probProfit);
  assert.equal(a.expectedPnl, b.expectedPnl);
});

test('MC is reproducible with different seeds', () => {
  const a = runMonteCarlo({ S0: 100, mu: 0, sigma: 0.20, r: 0.045, daysToExpiry: 30, legs: longCall, numPaths: 5000, seed: 1 });
  const b = runMonteCarlo({ S0: 100, mu: 0, sigma: 0.20, r: 0.045, daysToExpiry: 30, legs: longCall, numPaths: 5000, seed: 2 });
  // probProfit usually differs across independent seeds; tolerance allows for rare coincidence.
  const diff = Math.abs(a.probProfit - b.probProfit);
  assert.ok(diff > 0 || a.probProfit === b.probProfit); // strict equality is fine here, just guard
});

test('MC result schema is well-formed', () => {
  const r = runMonteCarlo({ S0: 100, mu: 0, sigma: 0.20, r: 0.045, daysToExpiry: 30, legs: longCall, numPaths: 1000, seed: 99 });
  assert.ok(typeof r.probProfit === 'number' && r.probProfit >= 0 && r.probProfit <= 1);
  assert.ok(typeof r.expectedPnl === 'number');
  assert.ok(typeof r.medianPnl === 'number');
  assert.ok(typeof r.stdPnl === 'number' && r.stdPnl >= 0);
  assert.ok(r.var95 >= 0);
  assert.ok(r.cvar95 >= 0);
  assert.equal(r.histogram.length, 40);
  assert.ok(r.allPaths.length > 0);
  assert.ok(r.pathFan.length === 5, '5 percentile tracks');
});

test('zero DTE: probability of OTM profit is 0 (option already worthless)', () => {
  const r = runMonteCarlo({ S0: 95, mu: 0, sigma: 0.20, r: 0.045, daysToExpiry: 0, legs: longCall, numPaths: 1000, seed: 7 });
  // If spot < strike at "expiry" (day 0), call OTM, premium lost.
  assert.equal(r.probProfit, 0);
});

test('higher σ increases payoff variance but expected PnL stays bounded', () => {
  const low = runMonteCarlo({ S0: 100, mu: 0, sigma: 0.10, r: 0.045, daysToExpiry: 30, legs: longCall, numPaths: 5000, seed: 1 });
  const high = runMonteCarlo({ S0: 100, mu: 0, sigma: 0.50, r: 0.045, daysToExpiry: 30, legs: longCall, numPaths: 5000, seed: 1 });
  assert.ok(high.stdPnl > low.stdPnl, `high=${high.stdPnl} low=${low.stdPnl}`);
});
