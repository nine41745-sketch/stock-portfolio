import { changelog as previousChangelog } from './changelog-v14137'
import type { ChangelogEntry } from './changelog'

const current: ChangelogEntry = {
  version: 'v1.41.38',
  date: 'Development History — Feature commit 2026-11-14 11:59:42 +07:00 (ไม่ใช่ Production)',
  changes: [
    'อัปเดตไลบรารี hono เป็น 4.13.18 และ @hono/node-server เป็น 2.1.8 เพื่อปิดช่องโหว่ระดับปานกลางที่เพิ่งประกาศ ทั้งสองตัวเป็นของที่ติดมากับไลบรารีดึงข้อมูลหุ้น yahoo-finance2 (ไม่ได้ใช้ตรงจากโค้ดของแอป) การประกาศช่องโหว่ทำให้ด่านตรวจ security-audit ล้มทั้งที่โค้ดไม่ได้เปลี่ยน',
    'แก้เฉพาะไฟล์ package-lock.json (เลขเวอร์ชัน ที่อยู่ดาวน์โหลด และค่าตรวจสอบความถูกต้องของสองตัวนี้) ไม่เปลี่ยนโค้ดแอป การตั้งค่า หรือรายการ dependency ใน package.json',
    'ยังไม่ได้ตรวจว่าโค้ดของแอปเรียกใช้ส่วนที่มีช่องโหว่หรือไม่ (น่าจะไม่ใช้เพราะเป็น dependency ซ้อนของ SDK ที่ไลบรารีดึงข้อมูลหุ้นพ่วงมา)',
  ],
}

export const changelog: ChangelogEntry[] = [current, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
