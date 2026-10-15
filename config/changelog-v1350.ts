import { changelog as previousChangelog } from './changelog-v1341'
import type { ChangelogEntry } from './changelog'

const v1350: ChangelogEntry = {
  version: 'v1.35.0',
  date: '2026-10-15 18:02 ICT',
  changes: [
    'เพิ่ม Portfolio-scoped Watchlist พร้อมราคาเป้าหมาย บันทึกย่อ และ Collections แยกตามพอร์ตที่ผู้ใช้เลือก รวมถึง Scanner mine ที่อ่านเฉพาะ Holdings และ Watchlist ใหม่ของพอร์ตนั้น',
    'เพิ่ม Smart Alerts และ Conditional Investment Rules แบบ deterministic ให้ผู้ใช้สั่งประเมินเอง พร้อม Support/Resistance Ladder และการรีเฟรชราคาที่จำกัดจำนวน ไม่เพิ่ม Cron หรือการซื้อขายอัตโนมัติ',
    'คง Legacy Watchlist ระดับบัญชีไว้แบบอ่านอย่างเดียวผ่านเส้นทางแยก ไม่ย้าย ไม่กำหนด portfolio_id และไม่รวม Legacy เข้ากับ Scanner mine หรือ Smart Alerts',
    'เพิ่มฐานข้อมูลแบบ Additive จำนวน 3 ตาราง พร้อม Portfolio Ownership Foreign Keys, RLS 12 Policies, ACL และ Updated-at Triggers; Cloud Migration ถูก Apply และตรวจ Catalog แล้ว โดย Legacy Watchlist ยังคงเดิม',
    'ผ่าน GitHub CI และ Authenticated Browser QA 40 checks บน Supabase Local Disposable ด้วยข้อมูลสังเคราะห์; Full Security Audit ยังมี 7 High ใน Development tooling ตาม Temporary Risk Acceptance เฉพาะ v1.35.0 โดยไม่ได้ปิด Security Gates',
  ],
}

export const changelog: ChangelogEntry[] = [v1350, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
