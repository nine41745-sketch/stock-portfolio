import { changelog as previousChangelog } from './changelog-v14132'
import type { ChangelogEntry } from './changelog'

const current: ChangelogEntry = {
  version: 'v1.41.33',
  date: 'Development History — Feature commit 2026-11-11 23:13:47 +07:00 (ไม่ใช่ Production)',
  changes: [
    'อัปเดต Next.js และ eslint-config-next จาก 16.4.1 เป็น 16.4.5 ซึ่งเป็นรุ่นแพตช์ความปลอดภัยของ framework (ช่องโหว่ระดับ moderate 7 รายการ เช่น cache รั่วข้ามผู้ใช้ และการข้ามตรวจ SVG ใน image optimization) แอปนี้ไม่ได้ใช้ use cache หรือ Edge runtime จึงเสี่ยงต่ำอยู่แล้ว แต่อัปเดตไว้เพื่อความปลอดภัย ไม่มีการเปลี่ยนฟีเจอร์ ยังไม่ได้ทดสอบหลังเข้าสู่ระบบบน Production',
  ],
}

export const changelog: ChangelogEntry[] = [current, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
