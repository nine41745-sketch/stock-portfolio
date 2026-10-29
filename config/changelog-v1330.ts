import { changelog as previousChangelog } from './changelog-v1320'
import type { ChangelogEntry } from './changelog'

const v1330: ChangelogEntry = {
  version: 'v1.33.0',
  date: 'เวลาเดิมใน Changelog — 2026-10-13 02:20 ICT (ยังไม่มีหลักฐานยืนยันว่าเป็นเวลา Production)',
  changes: [
    'Smart DCA: เพิ่มตัวช่วยวางแผนลงทุนแบบ read-only โดยคำนึงถึงเงินคงเหลือ DIME ค่าธรรมเนียมจริง เป้าหมายสัดส่วนพอร์ต และข้อจำกัดความกระจุกตัว ไม่ส่งคำสั่งซื้อขายหรือบันทึกรายการลงทุน',
    'Dividend Intelligence Phase 1: สรุปเงินปันผลจากรายการที่บันทึกไว้จริง พร้อมตรวจสอบความครบถ้วนของข้อมูลและ fail-closed เมื่อเกินขีดจำกัด ไม่ใช่การพยากรณ์เงินปันผล',
    'Screenshot Import Preview: อ่านข้อความจากภาพด้วย OCR ฝั่งเบราว์เซอร์เพื่อให้ผู้ใช้ตรวจข้อมูลก่อนนำเข้า ยังไม่บันทึกข้อมูลเข้า Holdings หรือ Transaction Ledger',
    'Broker CSV Import Preview: เพิ่มการตรวจรูปแบบและแสดงตัวอย่างข้อมูล CSV รวมถึงการตรวจรายการซ้ำภายในไฟล์ โดยยังไม่เขียนข้อมูลลงฐานข้อมูล',
    'Database Bootstrap: เพิ่ม SQL สำหรับ fresh bootstrap และ forward repair พร้อมตัวตรวจสอบ RPC/RLS/สิทธิ์การเรียกฟังก์ชัน ทดสอบแล้วบน Local Supabase ด้วยข้อมูลสังเคราะห์เท่านั้น ยังไม่ได้ Apply ไปยัง Cloud หรือ Production',
  ],
}

export const changelog: ChangelogEntry[] = [v1330, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
