import assert from 'node:assert/strict'
import { selectPreliminary, selectAutomatic } from '../lib/today-candidates.ts'
const base = { setup:'PULLBACK', trend:'UPTREND', price:100, ema50:98, ema200:90, support:97, riskReward:1.5, earnings:null }
const items = Array.from({length:15}, (_, i) => ({...base, symbol:`S${String(i).padStart(2, '0')}`, score:80-i}))
items.push({...base, symbol:'AVOID', score:99, setup:'AVOID'})
items.push({...base, symbol:'LOW', score:57})
items.push({...base, symbol:'EARN', score:99, earnings:{daysUntil:3}})
items.push({...base, symbol:'DOWN', score:99, trend:'DOWNTREND'})
const preliminary = selectPreliminary(items)
assert.equal(preliminary.length, 12)
assert.deepEqual(preliminary.map(x => x.symbol), items.slice(0,12).map(x => x.symbol))
assert.equal(selectAutomatic(preliminary).length, 6)
assert.deepEqual(selectAutomatic(preliminary).map(x => x.symbol), preliminary.slice(0,6).map(x => x.symbol))
assert.equal(selectPreliminary([{...base, symbol:'SIDE', score:60, trend:'SIDEWAYS', ema50:100}]).length, 1)
assert.deepEqual(selectPreliminary([{...base, symbol:'BELOW', score:57}]), [])
assert.equal(selectAutomatic(preliminary.slice(0,2)).length, 2)
console.log('PASS synthetic preliminary eligibility, ranking and 12/6 limits')
