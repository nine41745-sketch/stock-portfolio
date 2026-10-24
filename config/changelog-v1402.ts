import { changelog as previousChangelog } from './changelog-v1401'
import type { ChangelogEntry } from './changelog'

const v1402: ChangelogEntry = {
  version: 'v1.40.2',
  date: 'Unreleased — Release Candidate',
  changes: [
    'นำ Import Preview ออกจากการใช้งานทั้งเมนูและ URL โดยตรง; การเปิด /imports จะกลับไปหน้า Dashboard',
    'Release Gate: HOLD — v1.40.2 ยังไม่เผยแพร่ Production',
    'Security Gate: HOLD — คงสถานะเดิม',
  ],
}

export const changelog: ChangelogEntry[] = [v1402, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
