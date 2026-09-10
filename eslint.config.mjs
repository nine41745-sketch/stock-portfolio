import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'

export default defineConfig([
  ...nextVitals,
  // These components intentionally synchronize browser/network state after mount.
  // Keep the modern rules enabled everywhere else and scope exceptions to the specific
  // components rather than weakening the repository-wide lint baseline.
  {
    files: [
      'components/auth/UserSettingsMutationGuard.tsx',
      'components/portfolio/PortfolioDashboard.tsx',
      'components/portfolio/TradePlanWorkspace.tsx',
    ],
    rules: {
      'react-hooks/set-state-in-effect': 'off',
    },
  },
  {
    files: ['components/portfolio/PortfolioDashboard.tsx'],
    rules: {
      'react-hooks/immutability': 'off',
      'react-hooks/static-components': 'off',
    },
  },
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
  ]),
])
