'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const TABS = [
  { href: '/dashboard', label: 'พอร์ต', icon: '📊' },
  { href: '/scanner', label: 'สแกนหุ้น', icon: '🔎' },
  { href: '/transactions', label: 'ธุรกรรม', icon: '🧾' },
] as const

export default function AppTabs() {
  const pathname = usePathname()

  return (
    <nav className="mb-5 flex flex-wrap gap-2 rounded-xl border border-gray-800 bg-gray-900/50 p-2" aria-label="เมนูหลัก">
      {TABS.map(tab => {
        const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`)
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
  )
}
