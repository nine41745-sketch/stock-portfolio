import assert from 'node:assert/strict'
import fs from 'node:fs'
import { resolveBuyingPower } from '../lib/buying-power.ts'

// v1.41.47: งบซื้อ = เงินสด DIME + เงินในธนาคาร
assert.equal(resolveBuyingPower(7.57, 1000), 1007.57, 'Buying power must add the DIME and bank balances')
assert.equal(resolveBuyingPower(7.57, 0), 7.57, 'DIME alone must still work')
assert.equal(resolveBuyingPower(0, 250.5), 250.5, 'Bank balance alone must count')
assert.equal(resolveBuyingPower('7.57', '1000'), 1007.57, 'Numeric strings from the database must be accepted')
assert.equal(resolveBuyingPower(null, undefined), 0, 'Missing balances must be zero')
assert.equal(resolveBuyingPower(Number.NaN, 100), 100, 'NaN must be ignored without poisoning the sum')
assert.equal(resolveBuyingPower(Infinity, 100), 100, 'Infinity must be ignored')
assert.equal(resolveBuyingPower(-50, 100), 100, 'A negative balance must never reduce or fake buying power')
assert.equal(resolveBuyingPower(100, -50), 100, 'A negative bank balance must be ignored')
assert.equal(resolveBuyingPower('', 'abc'), 0, 'Blank and non-numeric strings must be zero')
assert.equal(resolveBuyingPower({}, []), 0, 'Non-primitive values must be zero')

// ทุกจุดที่อ่านงบซื้อต้องใช้ helper เดียวกัน และต้องอ่าน cash_balance ด้วย (กันถอยกลับไปใช้ Dime อย่างเดียว)
const routes = [
  'app/api/cron/daily-analyze/route.ts',
  'app/api/cron/premarket-analyze/route.ts',
  'app/api/analyze/route.ts',
]
for (const file of routes) {
  const source = fs.readFileSync(file, 'utf8')
  assert.match(source, /from '@\/lib\/buying-power'/, `${file} must import the shared buying power helper`)
  assert.match(source, /\.select\('dime_balance, cash_balance'\)/, `${file} must load both the DIME and bank balances`)
  assert.match(source, /const buyingPower = resolveBuyingPower\(/, `${file} must derive buying power through the helper`)
  assert.ok(!/const buyingPower = Number\(/.test(source), `${file} must not read buying power from the DIME balance alone`)
}

const sizing = fs.readFileSync('lib/position-sizing.ts', 'utf8')
assert.ok(sizing.includes('เงินที่พร้อมใช้ (Dime + เงินในธนาคาร)'), 'The cash shortfall note must say the balance includes the bank')
assert.ok(!sizing.includes('เงินใน Dime ที่พร้อมใช้'), 'The old DIME-only wording must be gone')

console.log('PASS buying power includes the bank balance in every stock analysis path')
