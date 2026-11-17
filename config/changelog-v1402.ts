import { changelog as previousChangelog } from './changelog-v1401'
import type { ChangelogEntry } from './changelog'

// Released application SHA: 9e63f5173c6765b553d09a51ba992053976f9cd7
// Approved Production deployment: dpl_9RmeQ3tK7q9bPdWyQwm22cYGsM1n
const v1402: ChangelogEntry = {
  version: 'v1.40.2',
  date: '2026-10-25 14:24 ICT · Production',
  changes: [
    'นำ Import Preview ออกจากการใช้งานทั้งเมนูและ URL โดยตรง; การเปิด /imports จะกลับไปหน้า Dashboard',
    'เผยแพร่ Production แล้ว; ผ่านการตรวจรับ Smoke Test แบบอ่านอย่างเดียว 6/6 และหลักฐาน CI/Security Audit',
    'Security Gate และ Production Release Gate: เจ้าของอนุมัติปลด HOLD เฉพาะการปล่อย v1.40.2 นี้',
    'Staged Authenticated QA: BLOCKED — เจ้าของยอมรับข้อจำกัดการแยกสภาพแวดล้อมแล้ว ไม่ถือว่าเป็นผลทดสอบผ่าน',
    'การซื้อ/ขายจริงและความถูกต้องของตัวเลขพอร์ต: NOT TESTED / Owner-Accepted Limitation ไม่ถือว่าผ่านการทดสอบ',
  ],
}

export const changelog: ChangelogEntry[] = [v1402, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
