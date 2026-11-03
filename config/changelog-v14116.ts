import { changelog as previousChangelog } from './changelog-v14115'
import type { ChangelogEntry } from './changelog'

const current: ChangelogEntry = {
  version: 'v1.41.16',
  date: 'Development History — Feature commit 2026-11-03 10:46:28 +07:00 (ไม่ใช่ Production)',
  changes: [
    'Preview ของทุก branch ใช้ฐานข้อมูล Production ได้ เมื่อเจ้าของตั้งตัวแปรเปิดใช้งานเองบน Vercel ถ้าไม่ตั้ง Preview ยังถูกปิดไว้เหมือนเดิม และลบตัวแปรเมื่อไรก็กลับมาแยกฐานข้อมูลได้ทันที',
    'ยังตรวจชื่อ host ของ Preview, branch, รหัส project Production และ URL ของฐานข้อมูลทุกครั้ง และ Cron ยังถูกบล็อกบน Preview ทุกตัว',
  ],
}

export const changelog: ChangelogEntry[] = [current, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
