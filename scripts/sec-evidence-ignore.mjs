import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

function entryExists(file) {
  try { fs.lstatSync(file); return true } catch (error) {
    if (error.code === 'ENOENT') return false
    throw error
  }
}

/** Verify evidence exclusion without treating a broken Git checkout as gitless. */
export function assertEvidenceIgnored(root, artifactPath) {
  root = fs.realpathSync(root)
  const artifact = path.resolve(artifactPath)
  const directory = path.join(root, '.local-artifacts')
  assert.equal(path.dirname(artifact), directory, 'Evidence must be directly inside .local-artifacts')
  assert.match(path.basename(artifact), /^sec-filing-verification-[A-Za-z0-9-]{1,100}\.json$/)
  assert.equal(fs.lstatSync(directory).isSymbolicLink(), false, 'Evidence directory must not be a symlink')
  assert.equal(fs.realpathSync(directory), directory, 'Evidence must not escape through a linked directory')
  assert.equal(fs.lstatSync(artifact).isFile(), true, 'Evidence must be a regular file')
  assert.equal(fs.lstatSync(artifact).isSymbolicLink(), false, 'Evidence must not be a symlink')
  // Do not discover an unrelated parent repository in an exported source tree.
  if (entryExists(path.join(root, '.git'))) {
    const top = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
    assert.equal(fs.realpathSync(top), root, 'Git must describe this source root')
    execFileSync('git', ['check-ignore', '-q', '--', artifact], { cwd: root, stdio: 'pipe' })
    return 'git'
  }
  // An exported tree has no index. Require an explicit directory exclusion and
  // conservatively reject negations/nested policies instead of guessing Git semantics.
  const ignorePath = path.join(root, '.gitignore')
  assert.equal(fs.lstatSync(ignorePath).isFile(), true, 'Ignore policy must be a regular file')
  assert.equal(fs.lstatSync(ignorePath).isSymbolicLink(), false, 'Ignore policy must not be a symlink')
  const rules = fs.readFileSync(ignorePath, 'utf8').split(/\r?\n/)
    .map(line => line.trim()).filter(line => line && !line.startsWith('#'))
  assert.ok(rules.includes('.local-artifacts/') || rules.includes('/.local-artifacts/'), 'Explicit evidence directory exclusion is required')
  assert.ok(rules.every(line => !line.startsWith('!')), 'Gitless validation rejects ignore negations')
  assert.equal(entryExists(path.join(directory, '.gitignore')), false, 'Nested evidence ignore policy is unsupported')
  return 'gitless'
}
