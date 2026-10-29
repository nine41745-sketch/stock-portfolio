import { changelog as previousChangelog } from './changelog-v1330'
import type { ChangelogEntry } from './changelog'

const v1331: ChangelogEntry = {
  version: 'v1.33.1',
  date: 'เวลาเดิมใน Changelog — 2026-10-13 18:01 ICT (ยังไม่มีหลักฐานยืนยันว่าเป็นเวลา Production)',
  changes: [
    'Scanner mine: ใช้ Holdings ของพอร์ตที่เลือกเท่านั้น',
    'Security: ตรวจ Auth/PIN และ Portfolio Ownership ฝั่ง Server ก่อนอ่าน Holdings',
    'Portfolio Isolation: ป้องกันข้อมูล Holdings ปะปนระหว่างพอร์ต',
    'Watchlist: ไม่รวม Watchlist ระดับบัญชีจนถึง v1.35.0',
    'Regression Tests: เพิ่มการทดสอบการสลับพอร์ต สิทธิ์ผู้ใช้ Schema และพฤติกรรม Scanner',
  ],
}

export const changelog: ChangelogEntry[] = [v1331, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'