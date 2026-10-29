import { changelog as previousChangelog } from './changelog-v1415'
import type { ChangelogEntry } from './changelog'

const v1416: ChangelogEntry = {
  version: 'v1.41.6',
  date: 'Development History — Feature commit 2026-10-29 00:41:06 +07:00 (ไม่ใช่ Production)',
  changes: [
    'แก้ข้อมูลระบุบริษัทให้ตรงกับข้อมูลที่ SEC ส่งมา และยังไม่ใช้ข้อมูลคำนวณราคาหากยืนยันชนิดหุ้นไม่ได้',
  ],
}
export const changelog: ChangelogEntry[] = [v1416, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
