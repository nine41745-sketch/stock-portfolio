import { changelog as previousChangelog } from './changelog-v1311'
import type { ChangelogEntry } from './changelog'

const v1312: ChangelogEntry = {
  version: 'v1.31.2',
  date: '2026-10-07 02:20 ICT',
  changes: [
    'Portfolio UI Polish Round 2: รวมพอร์ต/เพิ่มพอร์ต/ธีม/ล็อก/บัญชีเป็น Top Bar เดียว และลดพื้นที่ว่างช่วงบน',
    'KPI Hierarchy: จัดการ์ดสรุปเป็น 4 + 4 บน Desktop แยกภาพรวมพอร์ตกับเงินสด/เงินลงทุนให้ชัดเจน',
    'Holdings Table: ลดความหนาแน่นของแถว ปรับปุ่ม Graph/AI hierarchy และทำสถานะ ATH/แนวรับเป็น badge บรรทัดเดียวพร้อม tooltip',
    'AI Analysis Accordion: เปิดรายละเอียดได้ทีละหุ้น สรุปก่อน รายละเอียดข่าว/แหล่งข้อมูลพับไว้ และลดกรอบ/สีที่รบกวนสายตา',
    'Presentation-only: ไม่เปลี่ยนสูตรคำนวณ, AI decision logic, Trade execution, Authentication, Database, Supabase หรือ Environment',
  ],
}

export const changelog: ChangelogEntry[] = [v1312, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
