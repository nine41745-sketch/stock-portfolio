import { changelog as previousChangelog } from './changelog'
import type { ChangelogEntry } from './changelog'

const v1140: ChangelogEntry = {
  version: 'v1.14.0',
  date: '2026-08-29 02:43 ICT',
  changes: [
    'เพิ่มแถบอายุการลงทุน: บันทึกวันเริ่มเล่นหุ้น 13/11/2567 และคำนวณจำนวนวันที่ผ่านมาเทียบกับวันปัจจุบันตามเวลา Asia/Bangkok อัตโนมัติ รวมถึงอัปเดตเองเมื่อเปิดหน้าค้างข้ามวัน',
    'เพิ่ม Position Sizing หลังผล AI ผ่าน Decision Framework/SELL_ALL safeguard เดิม: BUY/SELL_PARTIAL ใช้ระดับ 5/10/15/20/25/33/50%, SELL_ALL=100%, HOLD=0% โดยเปอร์เซ็นต์คิดจากจำนวนหุ้นที่ถือปัจจุบันและแสดงจำนวนหุ้นโดยประมาณ; BUY ยังถูกจำกัดด้วยเงินสดและ concentration risk และ Daily Batch กันไม่ให้ BUY หลายตัวใช้งบเงินสดก้อนเดียวซ้ำเกินยอดรวม',
    'เปลี่ยน inactivity 30 นาทีจากการ signOut Gmail/Supabase เป็นล็อกเฉพาะ PIN session แล้วพาไปหน้า /pin; session อีเมลยังอยู่ จึงกลับเข้าได้ด้วย PIN อย่างเดียว ขณะที่ปุ่มออกจากระบบยัง signOut เต็มรูปแบบเหมือนเดิม',
    'แก้หัวข้อแก้ไขล่าสุดของหุ้นหลังเปลี่ยนจำนวนหุ้น/ต้นทุน/หมายเหตุ: หลังบันทึกสำเร็จ reload ข้อมูลจาก server เพื่ออ่าน holdings.updated_at ที่ DB trigger/RPC อัปเดตจริงทันที ไม่ต้องรอเปิดหน้าใหม่เอง',
    'รอบนี้ไม่เพิ่มตาราง/คอลัมน์และไม่ต้องรัน Supabase Migration; ระบบ Daily Batch JSONL v1.13.1, PIN hashing/session binding และกติกา SELL_ALL เดิมยังคงอยู่',
  ],
}

export const changelog: ChangelogEntry[] = [v1140, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
