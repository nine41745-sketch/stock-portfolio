import { changelog as previousChangelog } from './changelog-v1414'
import type { ChangelogEntry } from './changelog'

const v1415: ChangelogEntry = {
  version: 'v1.41.5',
  date: 'Development History — เวลา commit รอยืนยัน (ไม่ใช่ Production)',
  changes: [
    'แสดง SEC Annual EPS ระดับบริษัทแยกจากหุ้นที่ยังยืนยัน Share Class ไม่ได้ พร้อมที่มาและข้อจำกัด',
    'คง guard การใช้ EPS กับราคาหุ้นและ P/E Scenario เมื่อหลักฐานไม่ครบ',
  ],
}
export const changelog: ChangelogEntry[] = [v1415, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
