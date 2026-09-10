import { changelog as previousChangelog } from './changelog-v125'
import type { ChangelogEntry } from './changelog'

const v1251: ChangelogEntry = {
  version: 'v1.25.1',
  date: '2026-09-11 00:39 ICT',
  changes: [
    'Performance Oversell Atomicity: ตรวจจำนวนหุ้นใน FIFO lots ให้ครบก่อนประมวลผล SELL เพื่อให้รายการขายเกินจำนวนถูกปฏิเสธโดยไม่กิน lots และไม่เพิ่ม net sells ของรายการที่ไม่สมบูรณ์',
    'Finnhub Rate-limit Hardening: แบ่ง batch การดึง Quote หลายสัญลักษณ์และลด Earnings fan-out โดยใช้ earnings-calendar request ร่วมแล้วกรองเฉพาะหุ้นที่ติดตาม',
    'Regression Coverage: เพิ่มกรณีทดสอบยืนยันว่า oversell ไม่เปลี่ยน FIFO state / realized result และยืนยันพฤติกรรม batch/provider request ของ Alerts + Calendar',
    'Setup Documentation: ปรับ SETUP.md ให้สะท้อน migration ที่ใช้งานจริงถึง Watchlist v1.18.0, Transactions v1.21.0 และ Trade Plan v1.23.0 โดยไม่สั่ง rerun migration เดิม',
    'Versioning Documentation: ปรับ VERSIONING.md ให้ตรงกับ repo ปัจจุบันว่า package-lock.json ถูก track และต้อง sync version คู่กับ package.json ใน release',
    'Safety: Hotfix ไม่มี Supabase Migration/SQL ใหม่ ไม่มีการแก้ Holdings, Transactions หรือ Trade Plan อัตโนมัติ และคงพฤติกรรมหลักของ v1.25.0 ไว้เดิม',
  ],
}

export const changelog: ChangelogEntry[] = [v1251, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
