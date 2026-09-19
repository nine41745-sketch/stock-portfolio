import { changelog as previousChangelog } from './changelog-v1273'
import type { ChangelogEntry } from './changelog'

const v1274: ChangelogEntry = {
  version: 'v1.27.4',
  date: '2026-09-19 16:02 ICT',
  changes: [
    'Daily Execution Guard Parity: Daily Portfolio Analysis อ่าน Auto Sync BUY/SELL ล่าสุดแยกตาม symbol และใช้ Execution Guard 24 ชั่วโมงตัวเดียวกับ Manual AI ก่อนบันทึกผล เพื่อไม่ให้รอบ Daily สั่งทำไม้เดิมซ้ำหลังพอร์ตเพิ่งเปลี่ยน',
    'Guard Semantics: BUY ล่าสุด + AI BUY จะพักเป็น HOLD; SELL ล่าสุด + AI SELL_PARTIAL จะพักเป็น HOLD; SELL_ALL ยังคงไม่ถูกบล็อก และเมื่อพ้น 24 ชั่วโมงคำแนะนำเดิมจะกลับมาทำงานตามปกติ',
    'Shared Guard + Regression Coverage: แยก logic เป็น helper กลางที่ Manual/Daily ใช้ร่วมกัน พร้อม runtime regression ครอบคลุม BUY, SELL_PARTIAL, SELL_ALL และกรณีเกิน 24 ชั่วโมง เพื่อป้องกันสองเส้นทาง drift กันอีก',
  ],
}

export const changelog: ChangelogEntry[] = [v1274, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
