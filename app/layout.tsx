import type { Metadata } from 'next'
import Script from 'next/script'
import UserSettingsMutationGuard from '@/components/auth/UserSettingsMutationGuard'
import './globals.css'

export const metadata: Metadata = {
  title: 'Stock Portfolio Tracker',
  description: 'ติดตามพอร์ตหุ้น US ส่วนตัว',
}

const THEME_INIT_SCRIPT = `
(() => {
  try {
    const saved = window.localStorage.getItem('stock-portfolio-theme')
    document.documentElement.setAttribute('data-theme', saved === 'light' ? 'light' : 'dark')
  } catch {
    document.documentElement.setAttribute('data-theme', 'dark')
  }
})()
`

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="th" suppressHydrationWarning>
      <body className="min-h-screen bg-gray-950 text-gray-100 transition-colors duration-200">
        <Script
          id="theme-preference-init"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }}
        />
        <UserSettingsMutationGuard />
        {children}
      </body>
    </html>
  )
}
