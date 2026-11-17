import type { Metadata } from 'next'
import { Noto_Sans_Thai } from 'next/font/google'
import Script from 'next/script'
import UserSettingsMutationGuard from '@/components/auth/UserSettingsMutationGuard'
import './globals.css'

export const metadata: Metadata = {
  title: 'Stock Portfolio Tracker',
  description: 'ติดตามพอร์ตหุ้น US ส่วนตัว',
}

// Thai-capable sans font, downloaded at build time and served from our own domain; Tailwind's font-sans uses it (tailwind.config.ts).
const notoSansThai = Noto_Sans_Thai({ subsets: ['thai', 'latin'], display: 'swap', variable: '--font-noto-sans-thai' })

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
    <html lang="th" className={notoSansThai.variable} suppressHydrationWarning>
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
