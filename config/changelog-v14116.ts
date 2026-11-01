import { changelog as previousChangelog } from './changelog-v14115'
import type { ChangelogEntry } from './changelog'

const current: ChangelogEntry = {
  version: 'v1.41.16',
  date: 'Development History — Feature commit 2026-11-01 14:24:14 +07:00 (ไม่ใช่ Production)',
  changes: [
    'แทนชุดเครื่องมือ lint เดิมด้วย Oxlint และคงกฎเดิมที่ตรวจเทียบแล้ว พร้อม regression ครอบคลุมกฎสำคัญ',
    'บันทึกที่มาและ license ของโค้ดกฎที่ฝังไว้ และตรวจช่องโหว่ของแพ็กเกจที่ใช้งานจริงโดยไม่รวม peer dependency ที่ไม่ได้ bundle',
    'ย้าย regression ตรวจตัวแปรไม่ประกาศมาใช้ Oxlint และปรับ Dependabot ให้ติดตามชุดเครื่องมือใหม่',
    'ทำให้การตรวจ hash ของ lint bundle ให้ผลตรงกันทั้ง Windows และ Linux โดยใช้รูปแบบบรรทัดมาตรฐานเดียวกัน',
  ],
}

export const changelog: ChangelogEntry[] = [current, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
