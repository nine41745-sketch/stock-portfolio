import { readFile, appendFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
const statusPath = process.argv[2]
if (!statusPath || !process.env.GITHUB_ENV) throw new Error('Missing private status file or Actions environment path')
const values = Object.fromEntries((await readFile(statusPath, 'utf8')).split(/\r?\n/).flatMap(line => {
  const match = line.match(/^([A-Z_]+)=(?:"([^"]*)"|'([^']*)'|(.*))$/)
  return match ? [[match[1], match[2] ?? match[3] ?? match[4]]] : []
}))
const api = new URL(values.API_URL ?? '')
const db = new URL(values.DB_URL ?? '')
const local = host => ['localhost', '127.0.0.1', '::1'].includes(host)
if (api.protocol !== 'http:' || !local(api.hostname) || api.port !== '54321' ||
    !local(db.hostname) || db.port !== '54322' || !values.ANON_KEY || !values.SERVICE_ROLE_KEY)
  throw new Error('Supabase API/database endpoint failed strict loopback validation')
for (const key of [values.ANON_KEY, values.SERVICE_ROLE_KEY]) process.stdout.write('::add-mask::' + key + '\n')
const entries = {
  NEXT_PUBLIC_SUPABASE_URL: api.origin,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: values.ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: values.SERVICE_ROLE_KEY,
  SUPABASE_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
  PIN_PEPPER: randomBytes(32).toString('hex'),
  PIN_SESSION_SECRET: randomBytes(32).toString('hex'),
  CRON_SECRET: randomBytes(32).toString('hex'),
  QA_BASE_URL: 'http://127.0.0.1:3000',
}
for (const [name, value] of Object.entries(entries)) await appendFile(process.env.GITHUB_ENV, name + '=' + value + '\n', { mode: 0o600 })
console.log('Validated disposable loopback Supabase API, database, and Auth configuration.')
