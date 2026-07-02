import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildStrategy, STRATEGIES, payoffAtExpiry, payoffCurve, Leg } from '../lib/strategies';

const S = 185, sigma = 0.30, r = 0.045, daysToExpiry = 30;
const T = daysToExpiry / 365;

function legNames(legs: { kind: string; side: string; strike?: number }[]) {
  return legs.map(l => `${l.side[0].toUpperCase()}${l.kind[0].toUpperCase()}${l.strike ?? ''}`).sort().join(',');
}

test('all 10 strategies registered', () => {
  const ids = Object.keys(STRATEGIES).sort();
  assert.deepEqual(ids, [
    'bear_put_spread','bull_call_spread','covered_call','iron_butterfly','iron_condor',
    'long_call','long_put','long_straddle','long_strangle','short_put',
  ]);
});

test('long_call has 1 long call leg and unlimited upside', () => {
  const b = buildStrategy('long_call', { S, sigma, r, daysToExpiry });
  assert.equal(b.legs.length, 1);
  assert.equal(b.legs[0].kind, 'call');
  assert.equal(b.legs[0].side, 'long');
  assert.equal(b.maxProfit, null, 'unlimited');
  assert.ok(b.maxLoss != null && b.maxLoss > 0);
});

test('short_put credits entry and has defined max loss', () => {
  const b = buildStrategy('short_put', { S, sigma, r, daysToExpiry });
  assert.ok(b.entryPerContract > 0, 'should credit seller');
  assert.ok(b.maxProfit != null && b.maxProfit > 0);
  assert.ok(b.maxLoss != null && b.maxLoss < 0);
});

test('iron_condor has 4 legs and 2 breakevens', () => {
  const b = buildStrategy('iron_condor', { S, sigma, r, daysToExpiry });
  assert.equal(b.legs.length, 4);
  assert.equal(b.breakEvens.length, 2);
  assert.ok(b.maxLoss != null && b.maxLoss < 0);
  // max loss = (wings - credit) * 100
  const credit = b.entryPerContract;
  const strikes = b.legs.map(l => l.strike!).sort((a, b) => a - b);
  const wingUp = strikes[3] - strikes[2];
  const wingDown = strikes[1] - strikes[0];
  const wings = Math.max(wingUp, wingDown);
  const expectedMaxLoss = -(wings * 100 - credit);
  assert.ok(Math.abs(b.maxLoss! - expectedMaxLoss) < 1, `maxLoss=${b.maxLoss} expected=${expectedMaxLoss}`);
});

test('covered_call: max profit = (strike - cost + premium) * 100', () => {
  const b = buildStrategy('covered_call', { S, sigma, r, daysToExpiry });
  const stockLeg = b.legs.find(l => l.kind === 'stock')!;
  const callLeg = b.legs.find(l => l.kind === 'call')!;
  const expected = ((callLeg.strike! - stockLeg.entryPrice) + callLeg.entryPrice) * 100;
  assert.ok(Math.abs(b.maxProfit! - expected) < 1, `maxProfit=${b.maxProfit} expected≈${expected}`);
});

test('breakeven for long_put is strike - premium', () => {
  const b = buildStrategy('long_put', { S, sigma, r, daysToExpiry });
  const K = b.legs[0].strike!;
  const premium = b.legs[0].entryPrice;
  assert.equal(b.breakEvens.length, 1);
  assert.ok(Math.abs(b.breakEvens[0] - (K - premium)) < 0.01, `BE=${b.breakEvens[0]} expected=${K - premium}`);
});

test('payoffAtExpiry for long call: 0 if ITM, intrinsic - premium otherwise', () => {
  const legs: Leg[] = [{ kind: 'call', side: 'long', strike: 100, entryPrice: 5, quantity: 100 }];
  assert.equal(payoffAtExpiry(legs, 95), -5, 'OTM should lose premium');
  assert.equal(payoffAtExpiry(legs, 100), -5, 'ATM should lose premium');
  assert.equal(payoffAtExpiry(legs, 110), 5, 'ITM should make intrinsic - premium');
});

test('payoffCurve spans user range and zeros out of range', () => {
  const legs: Leg[] = [{ kind: 'call', side: 'long', strike: 100, entryPrice: 5, quantity: 100 }];
  const curve = payoffCurve(legs, 100, 0.30, 41);
  assert.equal(curve.length, 41);
  assert.ok(curve[0].S < 100 && curve[40].S > 100, 'span OK');
  // Out-of-the-money far-OTM should equal -premium
  assert.equal(curve[0].pnl, -5);
});

test('buildStrategy throws helpful error on unknown id', () => {
  // @ts-expect-error testing runtime fallback
  assert.throws(() => buildStrategy('never_heard_of_this', { S, sigma, r, daysToExpiry }), /Unknown strategyId/);
});
