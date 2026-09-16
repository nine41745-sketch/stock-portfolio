import { changelog as previousChangelog } from './changelog-v127'
import type { ChangelogEntry } from './changelog'

const v1271: ChangelogEntry = {
  version: 'v1.27.1',
  date: '2026-09-16 02:10 ICT',
  changes: [
    'Active Portfolio Title: แก้ชื่อพอร์ตบน Dashboard ให้แสดงตามพอร์ตที่เลือกจริง แทนข้อความ hardcode "พอร์ตน้องเจน" เพื่อให้การแสดงผลตรงกับ Multi-Portfolio ที่ใช้งานอยู่',
    'Atomic BUY/SELL Auto Sync: เพิ่มเส้นทางบันทึกซื้อ/ขายจริงที่อัปเดต Transaction Ledger, Holdings และยอด Dime ภายใน database transaction เดียว ลดความเสี่ยงข้อมูลค้างหรืออัปเดตไม่ครบ',
    'Cost / Position Accounting: BUY คำนวณ weighted-average cost ใหม่โดยรวมค่าธรรมเนียม; SELL ตรวจจำนวนหุ้นก่อนขาย เพิ่มเงินกลับ Dime, คงต้นทุนเฉลี่ยเมื่อขายบางส่วน และลบ Holding อัตโนมัติเมื่อขายหมด',
    'Legacy Safety: Transaction เดิมและรายการที่บันทึกแบบ manual ยังคงเป็น ledger-only และไม่ถูกนำไป apply ย้อนหลัง; รายการที่ Auto Sync แล้วถูกป้องกันการแก้/ลบเพื่อไม่ให้ Holdings กับ Dime drift',
    'Production Verification: migration transaction_autosync_v1_27_1 ผ่าน verification แบบ read-only, CI/Preview ผ่าน และ Production release เสร็จโดยไม่แก้ Environment เพิ่มเติม',
  ],
}

export const changelog: ChangelogEntry[] = [v1271, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
