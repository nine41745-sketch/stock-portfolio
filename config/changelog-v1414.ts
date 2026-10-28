import { changelog as previousChangelog } from './changelog-v1413'
import type { ChangelogEntry } from './changelog'

const v1414: ChangelogEntry = {
  version: 'v1.41.4',
  date: 'Development History — Feature commit 2026-10-28 15:18:58 +07:00 (ไม่ใช่ Production)',
  changes: [
    'แสดงหลักฐาน SEC ย้อนหลังเพื่อแยกหุ้นสามัญ EOSE และ Warrant EOSEW โดยไม่ยืนยันสถานะปัจจุบัน',
    'คง guard ของ EPS และราคา Scenario เมื่อหลักฐาน Share Class หรือข้อมูลอื่นยังไม่ครบ',
  ],
}

export const changelog: ChangelogEntry[] = [v1414, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
