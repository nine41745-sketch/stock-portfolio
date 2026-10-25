import { changelog as previousChangelog } from './changelog-v1360'
import type { ChangelogEntry } from './changelog'

// Development history; a standalone Production release time has not been established.
const v1370: ChangelogEntry = {
  version: 'v1.37.0',
  date: 'Development History — ไม่ยืนยันเวลา Production แยกรุ่น',
  changes: [
    'Portfolio Stress Test: จำลอง Market/Industry/Symbol Shock ในหน่วยความจำ พร้อม Portfolio Risk Intelligence และการเปิดเผย Coverage, Missing Prices และ Freshness ที่ยังไม่ทราบ',
    'SEC Financial Risk Radar และ Filing Monitor แบบ On-demand พร้อม CIK/Issuer, Filing Provenance, Period/Units และสถานะ Missing/Unavailable; ใช้ Synthetic Mock QA โดยยังไม่ยืนยัน SEC Live',
    'รวม v1.35.1 QuickNotes Native Dialog, Genuine-edit Autosave, Draft Preservation, Scratchpad Revision/Concurrency Guard และ Scanner Account Switching จาก PR #67',
    'คง Next.js/eslint-config-next 16.4.1 และ React/ReactDOM 19.3.1 ที่รวมแล้ว พร้อม Investment Discovery และ Deadline/ATH Fix จาก PR #70 โดยไม่ Merge Patch ซ้ำ',
    'แก้ Accessible Labels ของ Target Allocation และ Contrast ใน Risk/SEC/Shared Navigation; รักษา Keyboard, Light/Dark, Responsive และ Account/Portfolio Isolation',
    'Authenticated QA Harness ตรวจ Expected HTTP ตาม Auth/PIN Lifecycle และ Positive Controls พร้อม Network Guard และ Disposable Cleanup; ผล QA เดิมไม่เท่ากับ Production Acceptance',
    'ประวัติขณะเตรียมรุ่น: Release Gate: HOLD — Full Audit 7 High; ขณะนั้นยังไม่มี Security Risk Acceptance, SEC Live Verification หรือสิทธิ์ Merge/Deploy/Tag/Release บันทึกนี้ไม่ใช่สถานะ Gate ปัจจุบันหรือการอนุมัติย้อนหลัง',
  ],
}

export const changelog: ChangelogEntry[] = [v1370, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
