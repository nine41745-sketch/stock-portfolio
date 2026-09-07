import { BASE_CHANGELOG, ChangeLogEntry } from './changelog-v117'

export const CHANGELOG: ChangeLogEntry[] = [
  {
    version: 'v1.18.0',
    date: '2026-09-08 04:48 ICT',
    title: 'Scanner, Watchlist & UI',
    changes: [
      {
        category: 'Feature',
        description: 'Added a deterministic stock scanner across curated US universes and the personal portfolio/watchlist, with bounded provider fan-out to limit quote and technical-data requests.'
      },
      {
        category: 'Feature',
        description: 'Added a persistent per-user Watchlist / entry-candidate list with optional target entry price and note, protected by authenticated RLS.'
      },
      {
        category: 'UI',
        description: 'Improved Light Mode semantic text and status contrast so labels, values and supporting copy remain readable on light backgrounds.'
      },
      {
        category: 'Bug Fix',
        description: 'Excluded sold and zero-share holdings from current Dashboard stale-AI warnings while preserving historical analyses for Track Record.'
      }
    ]
  },
  ...BASE_CHANGELOG
]

export const BASE_CHANGELOG = CHANGELOG

export type { ChangeLogEntry } from './changelog-v117'
export const CURRENT_VERSION = CHANGELOG[0].version
