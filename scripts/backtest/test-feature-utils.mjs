import assert from 'node:assert/strict'
import { calculateFeatureSeries, FEATURE_NAMES } from './feature-utils.mjs'

const bars = Array.from({ length: 420 }, (_, index) => ({
  date: new Date(Date.UTC(2020, 0, 1 + index)).toISOString().slice(0, 10),
  open: 100 + index, high: 101 + index, low: 99 + index, close: 100 + index, volume: 1000,
}))
const benchmark = bars.map((bar, index) => ({ ...bar, close: 100 + index * 0.5 }))
const values = calculateFeatureSeries(bars, benchmark)
const at = 400, features = values[at]
assert.equal(FEATURE_NAMES.length, 13)
assert.ok(Math.abs(features.ret5 - ((bars[at - 20].close / bars[at - 25].close - 1) * 100)) < 1e-10)
assert.ok(Math.abs(features.ret20 - ((bars[at - 20].close / bars[at - 40].close - 1) * 100)) < 1e-10)
assert.equal(features.volumeRatio20, 1)
assert.ok(features.rsi14 > 99)
assert.ok(features.ema50DistancePct > 0)
assert.ok(features.week52HighDistancePct <= 0)
assert.ok(features.rs20VsSpyPct > 0)
assert.equal(values[30].ret120, null)
console.log('feature-utils regression passed')
