import { changelog as previousChangelog } from './changelog-v14131'
import type { ChangelogEntry } from './changelog'

const current: ChangelogEntry = {
  version: 'v1.41.32',
  date: 'Development History — Feature commit 2026-11-11 17:26:24 +07:00 (ไม่ใช่ Production)',
  changes: [
    'บรรทัดบันทึกของตัวตรวจข้อความ AI ในพอร์ตระบุชื่อกฎที่ตัดข้อความออกและจำนวน เช่น "price-near-support=1" เพื่อให้รู้ว่ากฎใดทำงานจริงหลังกดวิเคราะห์ โดยยังไม่บันทึกข้อความหรือตัวเลขใด ๆ และไม่เปลี่ยนสิ่งที่ผู้ใช้เห็น',
  ],
}

export const changelog: ChangelogEntry[] = [current, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
