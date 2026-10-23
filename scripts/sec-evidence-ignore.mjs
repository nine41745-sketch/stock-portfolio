import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

// Verify archive rules with Git itself, including negation semantics; never skip the check.
export function assertEvidenceIgnored(artifactPath, root = process.cwd()) {
  const absoluteRoot = path.resolve(root)
  const relative = path.relative(absoluteRoot, path.resolve(artifactPath))
  assert.ok(!path.isAbsolute(relative) && relative.startsWith(`.local-artifacts${path.sep}`), 'Evidence must remain under .local-artifacts')
  const run = (cwd, args) => execFileSync('git', args, { cwd, stdio: 'ignore' })
  // CLI source uploads may omit both .git and .gitignore. Ship the same rules as source,
  // and enforce parity whenever the original rules are available (including CI).
  const rules = fs.readFileSync(path.join(absoluteRoot, 'scripts/sec-evidence.gitignore'), 'utf8')
  const originalRules = path.join(absoluteRoot, '.gitignore')
  const normalize = value => value.replace(/\r\n/g, '\n')
  if (fs.existsSync(originalRules)) {
    assert.equal(normalize(rules), normalize(fs.readFileSync(originalRules, 'utf8')), 'Packaged evidence rules must match .gitignore')
  }
  if (fs.existsSync(path.join(absoluteRoot, '.git'))) {
    // A damaged checkout is an error, not permission to use archive mode.
    run(absoluteRoot, ['check-ignore', '-q', '--', relative])
    return
  }
  // Without metadata, do not let unexamined nested rules override the packaged policy.
  for (let directory = path.dirname(path.resolve(artifactPath)); directory !== absoluteRoot; directory = path.dirname(directory)) {
    assert.ok(!fs.existsSync(path.join(directory, '.gitignore')), 'Archive evidence must not override ignore rules')
  }
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'sec-ignore-rules-'))
  try {
    run(sandbox, ['init', '--quiet'])
    fs.writeFileSync(path.join(sandbox, '.gitignore'), rules)
    run(sandbox, ['check-ignore', '-q', '--', relative])
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true })
  }
}
