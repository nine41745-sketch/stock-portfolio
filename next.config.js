const path = require('path')

/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack(config) {
    // v1.14.0 release branch: force the dashboard runtime bundle to use the
    // release changelog module. TypeScript `paths` alone is not sufficient
    // to override this already-existing module in the Next.js bundle.
    config.resolve.alias['@/config/changelog$'] = path.resolve(__dirname, 'config/changelog-v114.ts')
    return config
  },
}

module.exports = nextConfig
