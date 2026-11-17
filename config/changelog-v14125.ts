import { changelog as previousChangelog } from './changelog-v14124'
import type { ChangelogEntry } from './changelog'

const current: ChangelogEntry = {
  version: 'v1.41.25',
  date: 'Development History — Feature commit 2026-11-05 01:57:07 +07:00 (ไม่ใช่ Production)',
  changes: [
    'แก้ตัวตรวจ security audit ให้ข้อยกเว้นของ minimatch (GHSA-g3hv-75wg-m249) ทำงานอีกครั้ง หลังข้อมูลช่องโหว่ภายนอกเปลี่ยนวิธีเขียนช่วงเวอร์ชัน ทำให้ CI ล้มทุก PR ทั้งที่ช่องโหว่ยังเป็นรายการเดิม',
    'ข้อยกเว้นยอมรับเฉพาะช่วงเวอร์ชันสองแบบที่ระบุตรงตัว เงื่อนไขอื่นไม่เปลี่ยน ได้แก่ ระดับ moderate เท่านั้น, dev-only ทั้ง chain, หมดอายุวันที่ 2026-12-15 และ Production-only audit ยังไม่มีข้อยกเว้น พร้อมเทสต์ที่ต้องล้มเมื่อช่วงเวอร์ชันหรือเงื่อนไขอื่นไม่ตรง',
  ],
}

export const changelog: ChangelogEntry[] = [current, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
