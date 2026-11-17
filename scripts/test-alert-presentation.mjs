import assert from 'node:assert/strict'
import { evaluationTime, levelLabel } from '../lib/alert-presentation.ts'
const shown = evaluationTime('2026-10-23T20:24:00Z')
assert.match(shown, /24/)
assert.match(shown, /03:24/)
assert.match(shown, /ICT/)
assert.equal(evaluationTime('bad'), 'ไม่ทราบเวลาประเมิน')
assert.equal(evaluationTime(null), 'ไม่ทราบเวลาประเมิน')
assert.equal(levelLabel('NEAR_SUPPORT'), 'แนวรับ')
assert.equal(levelLabel('BREAKOUT'), 'แนวต้าน')
assert.equal(levelLabel('STOP'), 'ระดับ Stop')
console.log('PASS synthetic alert Bangkok evaluation time and level labels')
