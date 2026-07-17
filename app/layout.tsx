import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Stock Portfolio Tracker',
  description: 'ติดตามพอร์ตหุ้น US ส่วนตัว',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="th">
      <body className="min-h-screen bg-gray-950 text-gray-100 transition-colors duration-200">{children}</body>
    </html>
  )
}
