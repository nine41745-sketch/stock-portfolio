import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { recordInterruptedRunSync, writeQaCheckpointSync } from './qa/qa-runner-evidence.mjs'

async function withTemporaryDirectory(run) {
  const parent = fileURLToPath(new URL('../.local-artifacts/', import.meta.url))
  await mkdir(parent, { recursive: true })
  const directory = await mkdtemp(join(parent, 'qa-runner-evidence-test-'))
  try {
    await run(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test('checkpoint keeps the current stage, elapsed duration, and checks without arbitrary payload fields', async () => {
  await withTemporaryDirectory(async directory => {
    writeQaCheckpointSync(directory, {
      stage: 'AUTH_SETUP',
      startedAtMs: 100,
      stageStartedAtMs: 250,
      passedChecks: ['synthetic user created', 'unauthenticated control rejected'],
    }, 900)

    const checkpoint = JSON.parse(await readFile(join(directory, 'runner-status.json'), 'utf8'))
    assert.equal(checkpoint.status, 'RUNNING')
    assert.equal(checkpoint.stage, 'AUTH_SETUP')
    assert.equal(checkpoint.elapsedMs, 800)
    assert.equal(checkpoint.stageElapsedMs, 650)
    assert.deepEqual(checkpoint.checks, ['synthetic user created', 'unauthenticated control rejected'])
    assert.equal(Object.hasOwn(checkpoint, 'password'), false)
    assert.equal(Object.hasOwn(checkpoint, 'token'), false)
  })
})

test('interrupted runner evidence records TIMEOUT and last checkpoint without losing passed checks', async () => {
  await withTemporaryDirectory(async directory => {
    writeQaCheckpointSync(directory, {
      stage: 'PORTFOLIO_INITIALIZATION',
      startedAtMs: 100,
      stageStartedAtMs: 400,
      passedChecks: ['Account A empty portfolio verified'],
    }, 1000)

    const result = recordInterruptedRunSync(directory, 124, 1100)
    assert.equal(result.written, true)
    const evidence = JSON.parse(await readFile(join(directory, 'results.json'), 'utf8'))
    assert.equal(evidence.status, 'TIMEOUT')
    assert.equal(evidence.finalStage, 'PORTFOLIO_INITIALIZATION')
    assert.equal(evidence.failure.stage, 'PORTFOLIO_INITIALIZATION')
    assert.equal(evidence.passedChecks, 1)
    assert.deepEqual(evidence.checks, [{ name: 'Account A empty portfolio verified', status: 'PASS' }])
    assert.equal(evidence.failure.message.includes('password'), false)
  })
})

test('interrupted runner evidence preserves an already completed browser result', async () => {
  await withTemporaryDirectory(async directory => {
    const completed = { status: 'PASS', finalStage: 'COMPLETE', passedChecks: 51 }
    await writeFile(join(directory, 'results.json'), JSON.stringify(completed))

    const result = recordInterruptedRunSync(directory, 124, 1100)
    assert.equal(result.written, false)
    assert.deepEqual(JSON.parse(await readFile(join(directory, 'results.json'), 'utf8')), completed)
  })
})

test('non-timeout interruption is recorded as BLOCKED and unknown stages stay explicit', async () => {
  await withTemporaryDirectory(async directory => {
    const result = recordInterruptedRunSync(directory, 1, 1100)
    assert.equal(result.written, true)
    const evidence = JSON.parse(await readFile(join(directory, 'results.json'), 'utf8'))
    assert.equal(evidence.status, 'BLOCKED')
    assert.equal(evidence.finalStage, 'UNKNOWN')
    assert.equal(evidence.passedChecks, 0)
  })
})

test('workflow cancellation without runner results is BLOCKED rather than a fabricated QA pass', async () => {
  await withTemporaryDirectory(async directory => {
    writeQaCheckpointSync(directory, {
      stage: 'ACCOUNT_B_PIN_SETUP',
      startedAtMs: 100,
      stageStartedAtMs: 400,
      passedChecks: ['Account A authenticated and PIN controls passed'],
    }, 1000)

    const result = recordInterruptedRunSync(directory, 143, 1100)
    const evidence = JSON.parse(await readFile(join(directory, 'results.json'), 'utf8'))
    assert.equal(result.status, 'BLOCKED')
    assert.equal(evidence.status, 'BLOCKED')
    assert.equal(evidence.finalStage, 'ACCOUNT_B_PIN_SETUP')
    assert.equal(evidence.passedChecks, 1)
    assert.notEqual(evidence.status, 'PASS')
  })
})

test('authenticated QA workflow remains PR-scoped and defines bounded readiness, runner, and evidence steps', async () => {
  const workflowPath = fileURLToPath(new URL('../.github/workflows/authenticated-browser-qa.yml', import.meta.url))
  const workflow = await readFile(workflowPath, 'utf8')
  assert.match(workflow, /types:\s*\[labeled\]/)
  assert.match(workflow, /github\.event\.pull_request\.number == 73/)
  assert.match(workflow, /github\.event\.pull_request\.head\.ref == 'fix\/v1\.40\.0-consolidated-remediation'/)
  assert.match(workflow, /github\.event\.label\.name == 'authenticated-browser-qa'/)
  assert.match(workflow, /timeout-minutes:\s*45/)
  assert.match(workflow, /curl[^\n]*--connect-timeout/)
  assert.match(workflow, /curl[^\n]*--max-time/)
  assert.match(workflow, /timeout --signal=TERM --kill-after=10s/)
  assert.match(workflow, /if:\s*always\(\)[\s\S]*?name: Upload synthetic QA evidence/)
})

test('browser runner uses bounded action/API waits and closes context before draining response tasks', async () => {
  const scriptPath = fileURLToPath(new URL('./qa/authenticated-browser.mjs', import.meta.url))
  const script = await readFile(scriptPath, 'utf8')
  assert.match(script, /context\.setDefaultTimeout\(15_000\)/)
  assert.match(script, /context\.setDefaultNavigationTimeout\(30_000\)/)
  assert.match(script, /request\.get\(url,\{timeout:15_000/)
  assert.match(script, /request\.delete\(url,\{timeout:15_000/)
  assert.match(script, /AbortSignal\.timeout\(10_000\)/)
  assert.match(script, /process\.once\('SIGTERM'/)
  assert.match(script, /process\.kill\(process\.pid,'SIGTERM'\)/)
  const contextClose = script.indexOf('await context.close()')
  const responseDrain = script.indexOf('await Promise.allSettled([...responseTasks])', contextClose)
  assert(contextClose >= 0 && responseDrain > contextClose, 'response tasks must be drained only after closing their browser context')
})

test('browser runner validates Cache-Control with a RegExp accepted by assert.match', async () => {
  const scriptPath = fileURLToPath(new URL('./qa/authenticated-browser.mjs', import.meta.url))
  const script = await readFile(scriptPath, 'utf8')
  assert.match(script, /assert\.match\([^,\n]+,\s*\/no-store\/\)/)
  assert.doesNotMatch(script, /assert\.match\([^,\n]+,\s*'no-store'\)/)
})
