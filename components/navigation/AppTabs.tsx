'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const TABS = [
  { href: '/dashboard', label: 'พอร์ต', icon: '📊' },
  { href: '/scanner', label: 'สแกนหุ้น', icon: '🔎' },
  { href: '/transactions', label: 'ธุรกรรม', icon: '🧾' },
  { href: '/performance', label: 'ผลงาน', icon: '📈' },
  { href: '/trade-plan', label: 'แผน', icon: '🎯' },
  { href: '/risk', label: 'ความเสี่ยง', icon: '🛡️' },
] as const

const PLAN_SUBTABS = [
  { href: '/trade-plan', label: 'Trade Plan', icon: '🎯' },
  { href: '/alerts', label: 'Alerts', icon: '🔔' },
  { href: '/calendar', label: 'Calendar', icon: '📅' },
] as const

function isPlanWorkspace(pathname: string): boolean {
  return PLAN_SUBTABS.some(tab => pathname === tab.href || pathname.startsWith(`${tab.href}/`))
}

export default function AppTabs() {
  const pathname = usePathname()
  const planWorkspace = isPlanWorkspace(pathname)

  return (
    <>
      <nav className="mb-2 flex flex-wrap gap-2 rounded-xl border border-gray-800 bg-gray-900/50 p-2" aria-label="เมนูหลัก">
        {TABS.map(tab => {
          const active = tab.href === '/trade-plan'
            ? planWorkspace
            : pathname === tab.href || pathname.startsWith(`${tab.href}/`)
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
                active
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-gray-400 hover:bg-gray-800 hover:text-gray-100'
              }`}
            >
              <span className="mr-1.5" aria-hidden="true">{tab.icon}</span>
              {tab.label}
            </Link>
          )
        })}
      </nav>

      {planWorkspace ? (
        <nav className="mb-5 flex flex-wrap gap-2 px-1" aria-label="เมนูย่อยแผน">
          {PLAN_SUBTABS.map(tab => {
            const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`)
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                  active
                    ? 'border-blue-500/50 bg-blue-500/10 text-blue-200'
                    : 'border-gray-800 bg-gray-950 text-gray-500 hover:border-gray-700 hover:text-gray-300'
                }`}
              >
                <span className="mr-1" aria-hidden="true">{tab.icon}</span>
                {tab.label}
              </Link>
            )
          })}
        </nav>
      ) : <div className="mb-3" />}
    </>
  )
}
