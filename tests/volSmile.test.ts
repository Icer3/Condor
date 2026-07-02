import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateSmile, atmIvFromRealized } from '../lib/volSmile';

test('generateSmile returns N points centered around spot', () => {
  const s = generateSmile(100, 0.30, 30, { points: 21 });
  assert.equal(s.points.length, 21);
  // mid point should be near spot
  const mid = s.points[10];
  assert.ok(Math.abs(mid.strike - 100) < 5, `mid.strike=${mid.strike}`);
});

test('smile has positive ATM IV and skewed wings', () => {
  const s = generateSmile(100, 0.30, 30);
  // Put wing (K < S) typically has higher IV than call wing for negative skew.
  const left = s.points.find(p => p.moneyness < -0.10);
  const right = s.points.find(p => p.moneyness > 0.10);
  assert.ok(left && right);
  assert.ok(left.iv > s.atmIv, 'put wing IV > ATM IV');
});

test('atmIvFromRealized scales ~1.1x (approximately)', () => {
  assert.ok(Math.abs(atmIvFromRealized(0.20) - 0.22) < 1e-9);
  // Floors at 0.08 minimum
  assert.equal(atmIvFromRealized(0.0), 0.08);
});

test('minVol/maxVol in result are monotonic with ATM', () => {
  const s = generateSmile(185, 0.27, 30);
  assert.ok(s.minIv <= s.atmIv && s.atmIv <= s.maxIv);
});
