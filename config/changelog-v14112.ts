import { changelog as previousChangelog } from './changelog-v14111'
import type { ChangelogEntry } from './changelog'

const current: ChangelogEntry = {
  version: 'v1.41.12',
  date: 'Development History — Feature commit 2026-10-30 02:53:26 +07:00 (ไม่ใช่ Production)',
  changes: [
    'ปรับ “โอกาสวันนี้” ให้แยกผลซื้อได้ตอนนี้ รอย่อ รอราคาทะลุแนวต้าน เฝ้าดู และข้ามตามความเสี่ยงที่คำนวณได้',
    'แสดงคะแนน 6 หมวด เวลาและแหล่งที่มาของราคาต่อหุ้น พร้อมเตือนเมื่อยืนยันวันประกาศงบไม่ได้',
    'รวมและตัดหุ้นซ้ำก่อนเรียกผู้ให้บริการ และปรับเป้าหมายกับจุดตัดขาดทุนให้คำนวณผลตอบแทน/ความเสี่ยงจากระดับราคาเดียวกัน',
  ],
}

export const changelog: ChangelogEntry[] = [current, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
