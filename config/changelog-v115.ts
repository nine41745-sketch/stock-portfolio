import { changelog as previousChangelog } from './changelog-v114'
import type { ChangelogEntry } from './changelog'

const v1150: ChangelogEntry = {
  version: 'v1.15.0',
  date: '2026-09-04 15:45 ICT',
  changes: [
    'เพิ่ม Latest Analysis Wins: ผลที่กด ✨ วิเคราะห์ AI เองและสำเร็จจะถูกบันทึกทันทีฝั่ง server ทำให้ Refresh, ล็อก PIN, ออกจากระบบ หรือกลับมาเปิดภายหลังแล้วยังเห็นผลล่าสุดเดิม ไม่ต้องรอให้ browser ปิดหรือ logout แล้วค่อยบันทึก',
    'แยก manual latest result ออกจาก daily_analyses โดยเพิ่ม manual_latest_analyses เพื่อไม่แก้ประวัติ Daily/Track Record เดิม; ตอนโหลด Dashboard ระบบเปรียบเทียบ analysedAt ของ manual กับ cron แล้วให้อันที่ใหม่กว่าชนะ แม้อยู่คนละวัน',
    'Cron schedule เดิมไม่เปลี่ยน: เมื่อผลอัตโนมัติของวันใหม่เกิดทีหลัง manual ของวันก่อน ผล cron ใหม่จะขึ้นแทนตามเวลา; ถ้าภายหลังวันเดียวกันกด Analyze ใหม่อีก manual ที่ใหม่กว่าจะขึ้นแทนอีกครั้ง',
    'การวิเคราะห์ซ้ำหลังซื้อ/ขายหุ้นยังใช้ shares, cost_basis, เงินสด, P/L, position weight และ market data ปัจจุบันจาก server ทุกครั้ง พร้อม fingerprint เดิมที่รวมสถานะพอร์ต จึงสามารถเปลี่ยนจาก BUY เป็น HOLD/SELL_PARTIAL หรือปรับ % sizing ตามสถานการณ์ใหม่ได้โดยไม่บังคับสัญญาณเดิม',
    'คง Daily Portfolio Batch, Track Record, deterministic SELL_ALL safeguard, Position Sizing v1.14.0 และ PIN/Auth เดิมไว้; release นี้ต้อง apply Supabase migration_latest_analysis_wins_v1.15.0.sql หนึ่งครั้งก่อนทดสอบ persistence เต็มรูปแบบ',
  ],
}

export const changelog: ChangelogEntry[] = [v1150, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
