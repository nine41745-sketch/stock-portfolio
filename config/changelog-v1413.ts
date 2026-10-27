import { changelog as previousChangelog } from './changelog-v1412'
import type { ChangelogEntry } from './changelog'

const v1413: ChangelogEntry = {
  version: 'v1.41.3',
  date: 'Development History — รอยืนยันเวลา commit',
  changes: [
    'หน้าพื้นฐานและมูลค่า: เพิ่มภาพรวมข้อมูลที่มีและข้อมูลเพิ่มเติมจากผู้ให้บริการ พร้อมระบุข้อจำกัดของหน่วย งวด และความสด',
    'คงการป้องกันการแสดงราคา Scenario เมื่อยังไม่มีหลักฐานยืนยันข้อมูลที่จำเป็น',
  ],
}

export const changelog: ChangelogEntry[] = [v1413, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
