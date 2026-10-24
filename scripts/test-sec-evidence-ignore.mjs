import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { assertEvidenceIgnored } from './sec-evidence-ignore.mjs'

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'sec-ignore-'))
let checks = 0
function check(run) { run(); checks += 1 }
try {
  const root = path.join(fixture, 'source')
  fs.mkdirSync(path.join(root, '.local-artifacts'), { recursive: true })
  const ignore = path.join(root, '.gitignore')
  const artifact = path.join(root, '.local-artifacts', 'sec-filing-verification-test.json')
  fs.writeFileSync(artifact, '{}')
  fs.writeFileSync(ignore, '.local-artifacts/\n')
  check(() => assert.equal(assertEvidenceIgnored(root, artifact), 'gitless'))
  const withoutGit = () => execFileSync(process.execPath, ['--input-type=module', '--eval',
    `import { assertEvidenceIgnored } from ${JSON.stringify(new URL('./sec-evidence-ignore.mjs', import.meta.url).href)}; assertEvidenceIgnored(${JSON.stringify(root)}, ${JSON.stringify(artifact)});`],
  { env: { ...process.env, PATH: '', Path: '' }, cwd: root, stdio: 'pipe' })
  check(() => withoutGit())
  check(() => assert.throws(() => assertEvidenceIgnored(root, path.join(fixture, 'outside.json'))))
  check(() => assert.throws(() => assertEvidenceIgnored(root, path.join(root, '.local-artifacts', 'other.json'))))
  for (const policy of ['', '# .local-artifacts/\n', 'other/.local-artifacts/\n', '.local-artifacts/\n!.local-artifacts/\n', '.local-artifacts/\n!*.json\n']) {
    fs.writeFileSync(ignore, policy)
    check(() => assert.throws(() => assertEvidenceIgnored(root, artifact)))
  }
  fs.rmSync(ignore)
  check(() => assert.throws(() => assertEvidenceIgnored(root, artifact)))
  fs.writeFileSync(ignore, '/.local-artifacts/\r\n')
  check(() => assert.equal(assertEvidenceIgnored(root, artifact), 'gitless'))
  fs.writeFileSync(path.join(root, '.local-artifacts', '.gitignore'), '!*.json\n')
  check(() => assert.throws(() => assertEvidenceIgnored(root, artifact)))
  fs.rmSync(path.join(root, '.local-artifacts', '.gitignore'))
  fs.writeFileSync(path.join(root, '.git'), 'gitdir: missing-metadata\n')
  check(() => assert.throws(() => assertEvidenceIgnored(root, artifact)))
  fs.rmSync(path.join(root, '.git'))
  execFileSync('git', ['init', '--quiet', root], { stdio: 'pipe' })
  check(() => assert.equal(assertEvidenceIgnored(root, artifact), 'git'))
  check(() => assert.throws(withoutGit))
  fs.writeFileSync(ignore, '.local-artifacts/\n!.local-artifacts/\n!.local-artifacts/*.json\n')
  check(() => assert.throws(() => assertEvidenceIgnored(root, artifact)))
  fs.writeFileSync(ignore, '.local-artifacts/\n')
  execFileSync('git', ['-C', root, 'add', '--force', '--', artifact], { stdio: 'pipe' })
  check(() => assert.throws(() => assertEvidenceIgnored(root, artifact)))
} finally {
  fs.rmSync(fixture, { recursive: true, force: true })
}
console.log(`SEC evidence ignore regression: ${checks} checks passed (Git, gitless and fail-closed policies).`)
