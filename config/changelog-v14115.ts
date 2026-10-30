import { changelog as previousChangelog } from './changelog-v14114'
import type { ChangelogEntry } from './changelog'

const current: ChangelogEntry = {
  version: 'v1.41.15',
  date: 'Development History — Feature commit timestamp pending (+07:00; ไม่ใช่เวลา Production)',
  changes: [
    'หน้าโอกาสวันนี้ระบุว่าคะแนนใช้วัดแนวโน้มตามกฎ และยังไม่มีหลักฐานว่าคะแนนสูงให้ผลตอบแทนดีกว่า',
    'ใช้ป้ายระดับคะแนนที่เป็นกลาง แยกจำนวนซื้อได้ตอนนี้กับซื้อไม้แรก และเตือนความเสี่ยงเมื่อราคาเปิดกระโดดต่ำกว่าจุดตัดขาดทุน',
  ],
}

export const changelog: ChangelogEntry[] = [current, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
