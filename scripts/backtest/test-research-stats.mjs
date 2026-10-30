import assert from 'node:assert/strict'
import { benjaminiHochberg, neweyWestMean, rank, spearman } from './research-stats.mjs'

assert.deepEqual(rank([10, 10, 30, 20]), [1.5, 1.5, 4, 3])
assert.equal(spearman([1, 2, 3, 4], [2, 4, 6, 8]), 1)
assert.equal(spearman([1, 2, 3, 4], [8, 6, 4, 2]), -1)
assert.equal(neweyWestMean([0.1, 0.1, 0.1, 0.1, 0.1], 4).tStatistic, Infinity)
assert.equal(neweyWestMean([1], 4).status, 'insufficient-sample')
assert.deepEqual(benjaminiHochberg([0.01, 0.04, 0.03, 0.2], 0.1).passed, [true, true, true, false])
console.log('research-stats regression passed')
