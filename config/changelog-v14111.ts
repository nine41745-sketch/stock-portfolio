import { changelog as previousChangelog } from './changelog-v14110'
import type { ChangelogEntry } from './changelog'

const current: ChangelogEntry = {
  version: 'v1.41.11',
  date: 'Development History — รอเวลา Git commit จริง (ไม่ใช่ Production)',
  changes: [
    'ปรับป้ายเวลาเดิมในประวัติรุ่น v1.30.0–v1.34.0 ให้บอกว่าเป็นข้อมูลจาก Changelog เดิม และยังไม่มีหลักฐานยืนยันว่าเป็นเวลา Production',
    'คงวันที่และเวลาเดิมไว้ โดยไม่แต่งเวลาเผยแพร่ย้อนหลัง',
  ],
}
export const changelog: ChangelogEntry[] = [current, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'