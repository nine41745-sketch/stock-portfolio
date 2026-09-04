const path = require('path')

/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack(config) {
    // Release metadata wrapper: keep previous changelog history intact while exposing the current version.
    config.resolve.alias['@/config/changelog$'] = path.resolve(__dirname, 'config/changelog-v115.ts')
    return config
  },
}

module.exports = nextConfig
