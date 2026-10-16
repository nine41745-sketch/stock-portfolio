import { changelog as previousChangelog } from './changelog-v1350'
import type { ChangelogEntry } from './changelog'

// Local release preparation only. This entry is not evidence of a Production deployment.
const v1351: ChangelogEntry = {
  version: 'v1.35.1',
  date: 'Unreleased — อยู่ระหว่างเตรียม Release',
  changes: [
    'แก้ Placeholder ใน Light Theme ให้มี Contrast ผ่าน WCAG AA และตรวจ Computed Styles ใน Light/Dark บนความกว้าง 375/768/1440px ด้วยข้อมูลสังเคราะห์',
    'ใช้ QuickNotesDrawer ร่วมกันบน Dashboard และหน้าอื่น ปิดแล้วออกจาก Accessibility Tree และ Tab Sequence พร้อม Focus Trap, Escape, Focus Restoration และสถานะ ARIA ของปุ่มเปิด',
    'บันทึก QuickNotes เฉพาะข้อความที่ผู้ใช้แก้จริง รักษา Debounce และ Draft เมื่อโหลดหรือบันทึกล้มเหลว พร้อมป้องกัน Stale Requests และ Concurrent Writes',
    'กำหนดให้ PUT Scratchpad ทุกคำขอส่ง Revision และ User Identity ที่ตรงกับบัญชีปัจจุบัน โดยใช้ updated_at เดิม ไม่เปลี่ยน Schema และไม่รองรับ Legacy Upsert ที่ข้าม Guard',
    'เพิ่ม Regression ด้วยข้อมูลสังเคราะห์สำหรับ QuickNotes และ Scanner Portfolio Isolation; ผล Local QA ไม่ใช่ Production Acceptance และ Full Audit ยังต้องได้รับ Security Decision เฉพาะ v1.35.1 ก่อน Release',
  ],
}

export const changelog: ChangelogEntry[] = [v1351, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
