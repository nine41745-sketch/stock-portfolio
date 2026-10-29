import assert from 'node:assert/strict'
import { formatChangelogDate } from '../lib/changelog-date.ts'
assert.equal(formatChangelogDate('Development History — Feature commit 2026-10-29 13:07:20 +07:00 (ไม่ใช่ Production)'), '2026-10-29 13:07:20 ICT · เวลาพัฒนา (ไม่ใช่เวลา Production)')
assert.equal(formatChangelogDate('Development History — Preview alias 2026-10-17 15:07 ICT (ไม่ใช่ Production)'), '2026-10-17 15:07 ICT · เวลา Preview (ไม่ใช่เวลา Production)')
assert.equal(formatChangelogDate('2026-10-23 03:55 ICT · Production'), '2026-10-23 03:55 ICT · Production')
assert.equal(formatChangelogDate('ข้อมูลเวลาไม่ทราบ'), 'ข้อมูลเวลาไม่ทราบ')
console.log('PASS changelog date formatting')
