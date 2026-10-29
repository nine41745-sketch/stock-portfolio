import { changelog as previousChangelog } from './changelog-v1418'
import type { ChangelogEntry } from './changelog'

const v1419: ChangelogEntry = {
  version: 'v1.41.9',
  date: 'Development History — Feature commit 2026-10-29 16:16:06 +07:00 (ไม่ใช่ Production)',
  changes: [
    'แสดงเวลาราคาจากผู้ให้บริการแยกจากเวลาที่ตรวจข้อมูล และแจ้งเมื่อราคาเก่าหรือไม่มีเวลาราคา',
    'อธิบายเหตุผลของคะแนนและที่มาของเป้าหมายที่ 2 พร้อมบอกว่าอัตราส่วนกำไรต่อความเสี่ยงใช้เป้าหมายที่ 1',
    'เมื่อผลวิเคราะห์ AI อ่านไม่ได้ ระบบจะแสดงสรุปจากหน้าเช็กหุ้นพร้อมแจ้งผู้ใช้',
  ],
}

export const changelog: ChangelogEntry[] = [v1419, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
