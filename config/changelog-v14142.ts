import { changelog as previousChangelog } from './changelog-v14141'
import type { ChangelogEntry } from './changelog'

const current: ChangelogEntry = {
  version: 'v1.41.42',
  date: 'Development History — Feature commit 2026-11-17 10:30:40 +07:00 (ไม่ใช่ Production)',
  changes: [
    'แก้ช่องโหว่ของ minimatch (GHSA-g3hv-75wg-m249) ที่ต้นเหตุ โดยอัปเดตชุดเครื่องมือ ESLint (typescript-eslint 8.70.0 เป็น 8.73.0) ให้ใช้ minimatch 11.0.9 ซึ่งอยู่นอกช่วงที่ได้รับผลกระทบ เป็นแพ็กเกจที่ใช้ตอนพัฒนาเท่านั้น ไม่อยู่ในแอปที่ผู้ใช้เปิด',
    'ถอดข้อยกเว้นชั่วคราวของ minimatch ออกจากตัวตรวจ security audit (เดิมจะหมดอายุ 2026-12-15) ตอนนี้ตัวตรวจไม่มีข้อยกเว้นเหลืออยู่ ถ้าพบช่องโหว่ใดในรายงาน audit จะไม่ผ่านทันที',
    'ไม่เปลี่ยนหน้าจอ API ฐานข้อมูล การวิเคราะห์ AI หรือเวลาการทำงานของ cron',
  ],
}

export const changelog: ChangelogEntry[] = [current, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
