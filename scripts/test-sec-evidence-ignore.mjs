import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { assertEvidenceIgnored } from './sec-evidence-ignore.mjs'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sec-ignore-regression-'))
const git = args => execFileSync('git', args, { cwd: root, stdio: 'ignore' })
try {
  const artifact = path.join(root, '.local-artifacts', 'probe.json')
  fs.mkdirSync(path.dirname(artifact))
  fs.writeFileSync(artifact, '{}')
  fs.mkdirSync(path.join(root, 'scripts'))
  const snapshot = path.join(root, 'scripts/sec-evidence.gitignore')
  fs.writeFileSync(snapshot, '.local-artifacts/\n')
  fs.writeFileSync(path.join(root, '.gitignore'), '.local-artifacts/\n')
  assertEvidenceIgnored(artifact, root) // source archive, no Git metadata
  assert.equal(fs.existsSync(path.join(root, '.git')), false, 'Archive is not modified to become a checkout')
  assert.throws(() => assertEvidenceIgnored(path.join(root, 'probe.json'), root))
  assert.throws(() => assertEvidenceIgnored(path.join(root, '.local-artifacts', '..', 'probe.json'), root))
  const nestedRules = path.join(root, '.local-artifacts', '.gitignore')
  fs.writeFileSync(nestedRules, '!probe.json\n')
  assert.throws(() => assertEvidenceIgnored(artifact, root), 'Archive nested rules cannot bypass the policy')
  fs.unlinkSync(nestedRules)
  fs.writeFileSync(path.join(root, '.gitignore'), '.local-artifacts/*\n!.local-artifacts/probe.json\n')
  assert.throws(() => assertEvidenceIgnored(artifact, root), 'Divergent packaged rules must fail closed')
  fs.writeFileSync(snapshot, '.local-artifacts/*\n!.local-artifacts/probe.json\n')
  assert.throws(() => assertEvidenceIgnored(artifact, root), 'Negated archive rules must fail closed')
  fs.unlinkSync(path.join(root, '.gitignore'))
  assert.throws(() => assertEvidenceIgnored(artifact, root), 'Negation remains enforced when Vercel strips .gitignore')
  fs.unlinkSync(snapshot)
  assert.throws(() => assertEvidenceIgnored(artifact, root), 'Missing rules must fail closed')
  fs.writeFileSync(snapshot, '.local-artifacts/\n')
  assertEvidenceIgnored(artifact, root) // Vercel excludes .git and .gitignore
  fs.writeFileSync(path.join(root, '.gitignore'), '.local-artifacts/\n')
  git(['init', '--quiet'])
  assertEvidenceIgnored(artifact, root)
  git(['add', '--force', '.local-artifacts/probe.json'])
  assert.throws(() => assertEvidenceIgnored(artifact, root), 'Force-tracked evidence must fail closed')
  git(['rm', '--cached', '.local-artifacts/probe.json'])
  fs.writeFileSync(path.join(root, '.gitignore'), '')
  fs.writeFileSync(snapshot, '')
  assert.throws(() => assertEvidenceIgnored(artifact, root), 'Unignored checkout evidence must fail closed')
  fs.writeFileSync(path.join(root, '.gitignore'), '.local-artifacts/\n')
  fs.writeFileSync(snapshot, '.local-artifacts/\n')
  fs.renameSync(path.join(root, '.git'), path.join(root, 'saved-git'))
  fs.writeFileSync(path.join(root, '.git'), 'gitdir: nonexistent-git-directory\n')
  assert.throws(() => assertEvidenceIgnored(artifact, root), 'Broken Git metadata cannot bypass the checkout check')
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}
console.log('✓ SEC evidence ignore rules: archive, checkout, negation, missing rules, outside path and tracked-file rejection passed')
