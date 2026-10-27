import { changelog as previousChangelog } from './changelog-v1410'
import type { ChangelogEntry } from './changelog'

const v1411: ChangelogEntry = {
  version: 'v1.41.1',
  date: 'Unreleased — รอเผยแพร่ Production',
  changes: [
    'Cron และ Supabase: ตรวจ Deployment ID กับ Production URL ทุกครั้ง เพื่อป้องกัน Staged deployment ผ่านการปลอม Host; หากยืนยันตัวตนไม่ได้ให้ปฏิเสธการทำงาน',
    'เพิ่ม regression tests แบบสังเคราะห์สำหรับ Staged Production, Cron, Supabase และ Host ที่ไม่ตรงกับ Deployment',
    'Security Gate และ Production Release Gate: HOLD สำหรับรุ่นนี้ รอการตรวจรับและอนุมัติเผยแพร่',
  ],
}

export const changelog: ChangelogEntry[] = [v1411, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
