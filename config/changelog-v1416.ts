import { changelog as previousChangelog } from './changelog-v1415'
import type { ChangelogEntry } from './changelog'

const v1416: ChangelogEntry = {
  version: 'v1.41.6',
  date: 'Development History — รอบันทึกเวลาจาก commit จริง',
  changes: [
    'แก้การแสดงข้อมูลบริษัทจาก SEC ให้สอดคล้องกับข้อมูล CompanyFacts โดยยังคงการป้องกัน Share Class และ P/E Scenario',
  ],
}
export const changelog: ChangelogEntry[] = [v1416, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
