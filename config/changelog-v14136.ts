import { changelog as previousChangelog } from './changelog-v14135'
import type { ChangelogEntry } from './changelog'

const current: ChangelogEntry = {
  version: 'v1.41.36',
  date: 'Development History — Feature commit 2026-11-12 10:27:56 +07:00 (ไม่ใช่ Production)',
  changes: [
    'ปรับให้อ่านง่ายขึ้นทั้งแอป (ระดับ 1): ใช้ฟอนต์ไทย Noto Sans Thai, ข้อความรองสีเทาบนธีมมืดเข้มขึ้นจนอ่านสบาย (เดิมความต่างสีต่ำกว่าเกณฑ์), ตัวอักษรเล็กสุดสองขนาดใหญ่ขึ้นราวหนึ่งก้าว (10→11 px, 11→12 px), ตัวเลขใช้ความกว้างเท่ากันเพื่อให้คอลัมน์ตรงกัน',
    'หน้าแรก: การ์ดเงินสด/ผลตอบแทนและ Track Record แสดงกรอบเทาเรืองแสงแทนข้อความ "กำลังโหลด..." และตารางกับการ์ดมือถือมีลูกศร ▲/▼ ข้างเปอร์เซ็นต์กำไร/ขาดทุน (ไม่พึ่งสีอย่างเดียว) ไม่เปลี่ยนตัวเลขหรือเครื่องหมาย +/− เดิม ยังไม่ได้ตรวจหน้าตาจริงหลังแก้ (ต้องล็อกอินดูหลังปล่อย)',
  ],
}

export const changelog: ChangelogEntry[] = [current, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
