const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
]

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  // Public, non-secret marker lets browser-side Supabase clients fail closed on Preview.
  env: {
    NEXT_PUBLIC_VERCEL_ENV: process.env.VERCEL_ENV ?? (process.env.VERCEL === '1' ? 'unknown' : 'development'),
    NEXT_PUBLIC_VERCEL_URL: process.env.VERCEL_URL ?? '',
    NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL: process.env.VERCEL_PROJECT_PRODUCTION_URL ?? '',
    NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF: process.env.VERCEL_GIT_COMMIT_REF ?? '',
    NEXT_PUBLIC_SUPABASE_PREVIEW_PRODUCTION_ACCESS_BRANCH: process.env.NEXT_PUBLIC_SUPABASE_PREVIEW_PRODUCTION_ACCESS_BRANCH ?? '',
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ]
  },
}

module.exports = nextConfig
