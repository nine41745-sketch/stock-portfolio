import { changelog as previousChangelog } from './changelog-v14115'
import type { ChangelogEntry } from './changelog'

const current: ChangelogEntry = {
  version: 'v1.41.17',
  date: 'Development History — Feature commit 2026-10-31 12:48:47 +07:00 (ไม่ใช่ Production)',
  changes: [
    'ปรับ security-audit ให้ยอมรับ GHSA-g3hv-75wg-m249 ชั่วคราว เฉพาะเมื่อทุกแพ็กเกจและทุกโหนดใน dependency chain เป็น dev-only',
    'ข้อยกเว้นหมดอายุวันที่ 2026-12-15 และต้องลบเมื่อ ESLint toolchain ใช้ minimatch 11.0.1 ขึ้นไป; Production-only audit ยังต้องผ่านโดยไม่มีข้อยกเว้น',
  ],
}

export const changelog: ChangelogEntry[] = [current, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
