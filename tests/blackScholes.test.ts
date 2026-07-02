// Black-Scholes math tests — run with: npx tsx --test tests/blackScholes.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blackScholes, inverseNormCdf, normCdf, realizedVol } from '../lib/blackScholes';

test('BSM call-put parity holds (1e-8 tolerance)', () => {
  const S = 100, K = 100, T = 0.25, r = 0.05, sigma = 0.20;
  const g = blackScholes({ S, K, T, r, sigma });
  const lhs = g.call - g.put;
  const rhs = S - K * Math.exp(-r * T);
  assert.ok(Math.abs(lhs - rhs) < 1e-8, `parity gap ${Math.abs(lhs - rhs)}`);
});

test('BSM call-put parity holds across wide parameter sweep', () => {
  for (const S of [50, 100, 200]) {
    for (const K of [80, 100, 120]) {
      for (const sigma of [0.10, 0.30, 0.50]) {
        for (const r of [0.01, 0.05, 0.10]) {
          const g = blackScholes({ S, K, T: 0.25, r, sigma });
          const err = Math.abs((g.call - g.put) - (S - K * Math.exp(-r * 0.25)));
          assert.ok(err < 1e-6, `parity fail S=${S} K=${K} sigma=${sigma} r=${r} err=${err}`);
        }
      }
    }
  }
});

test('BSM zero-time uses intrinsic', () => {
  const gITM = blackScholes({ S: 110, K: 100, T: 0, r: 0.05, sigma: 0.30 });
  assert.equal(gITM.call, 10);
  assert.equal(gITM.put, 0);
  const gOTM = blackScholes({ S: 90, K: 100, T: 0, r: 0.05, sigma: 0.30 });
  assert.equal(gOTM.call, 0);
  assert.equal(gOTM.put, 10);
});

test('inverse normal CDF round-trip is accurate', () => {
  const ps = [0.001, 0.01, 0.1, 0.25, 0.4, 0.5, 0.6, 0.75, 0.9, 0.99, 0.999];
  for (const p of ps) {
    const z = inverseNormCdf(p);
    const recovered = normCdf(z);
    assert.ok(Math.abs(recovered - p) < 1e-5, `p=${p} round-trip recovered=${recovered}`);
  }
});

test('delta is in [0,1] for calls and [-1,0] for puts', () => {
  const g = blackScholes({ S: 100, K: 100, T: 0.5, r: 0.05, sigma: 0.30 });
  assert.ok(g.deltaCall > 0 && g.deltaCall < 1, `deltaCall=${g.deltaCall}`);
  assert.ok(g.deltaPut < 0 && g.deltaPut > -1, `deltaPut=${g.deltaPut}`);
  assert.ok(Math.abs(g.deltaCall - g.deltaPut - 1) < 1e-10);
});

test('gamma is positive', () => {
  const g = blackScholes({ S: 100, K: 100, T: 0.5, r: 0.05, sigma: 0.30 });
  assert.ok(g.gamma > 0);
});

test('realizedVol over a synthetic driftless series is ~0', () => {
  const prices = [100, 100.5, 99.5, 100.2, 99.8, 100.1];
  const v = realizedVol(prices);
  assert.ok(v != null);
  assert.ok(v < 0.5, `vol on near-flat series = ${v}`);
});

test('realizedVol returns null on <5 prices', () => {
  assert.equal(realizedVol([100, 101]), null);
});
