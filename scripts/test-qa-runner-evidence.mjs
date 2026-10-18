import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { recordInterruptedRunSync, writeQaCheckpointSync } from './qa/qa-runner-evidence.mjs'
import { getVerifiedLocalUserAccessToken, LocalUserAuthError } from './qa/local-user-auth-token.mjs'

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

test('browser runner obtains the synthetic RLS user token through local Auth and verifies identity', async () => {
  const scriptPath = fileURLToPath(new URL('./qa/authenticated-browser.mjs', import.meta.url))
  const script = await readFile(scriptPath, 'utf8')
  assert.match(script, /getVerifiedLocalUserAccessToken\(/, 'RLS token acquisition must come from the isolated local Auth helper')
  assert.doesNotMatch(script, /localStorage/, 'The SSR browser client does not persist its Auth session in localStorage')
  assert.match(script, /expectedUserId:qaUser\.id/, 'The independent Auth token must be bound to the created synthetic user')
  assert.match(script, /Local Auth password-grant session[\s\S]*not extracted from the browser's cookie-backed session/)
})

test('local Auth password grant returns a token only after Auth verifies the expected synthetic identity', async () => {
  const calls = []
  const syntheticToken = `synthetic-${randomUUID()}`
  const expected = {
    baseUrl: 'http://127.0.0.1:54321',
    expectedPort: '54321',
    anonKey: 'synthetic-anon-key',
    email: 'qa-user@example.test',
    password: 'synthetic-password',
    expectedUserId: 'synthetic-user-a',
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init })
      return calls.length === 1
        ? { ok: true, status: 200, json: async () => ({ access_token: syntheticToken }) }
        : { ok: true, status: 200, json: async () => ({ id: 'synthetic-user-a' }) }
    },
  }

  const token = await getVerifiedLocalUserAccessToken(expected)
  assert.equal(token, syntheticToken)
  assert.equal(calls.length, 2)
  assert.equal(calls[0].url, 'http://127.0.0.1:54321/auth/v1/token?grant_type=password')
  assert.equal(calls[0].init.method, 'POST')
  assert.equal(calls[0].init.headers.apikey, 'synthetic-anon-key')
  assert.equal(calls[0].init.headers.authorization, undefined, 'The password grant must not use a service-role bearer')
  assert.deepEqual(JSON.parse(calls[0].init.body), { email: 'qa-user@example.test', password: 'synthetic-password' })
  assert.equal(calls[0].init.redirect, 'error')
  assert.ok(calls[0].init.signal instanceof AbortSignal)
  assert.equal(calls[1].url, 'http://127.0.0.1:54321/auth/v1/user')
  assert.equal(calls[1].init.headers.apikey, 'synthetic-anon-key')
  assert.equal(calls[1].init.headers.authorization, `Bearer ${syntheticToken}`)
  assert.equal(calls[1].init.redirect, 'error')
  assert.ok(calls[1].init.signal instanceof AbortSignal)
})

test('local Auth rejects invalid credentials without retaining response text or exposing credentials', async () => {
  const email = 'synthetic-private@example.test'
  const password = 'synthetic-private-password'
  const accessToken = `synthetic-${randomUUID()}`
  await assert.rejects(
    getVerifiedLocalUserAccessToken({
      baseUrl: 'http://localhost:54321', expectedPort: '54321', anonKey: 'synthetic-anon-key',
      email, password, expectedUserId: 'synthetic-user-a',
      fetchImpl: async () => ({ ok: false, status: 400, json: async () => ({ message: `${email} ${password} ${accessToken}` }) }),
    }),
    error => {
      assert.ok(error instanceof LocalUserAuthError)
      assert.equal(error.code, 'LOCAL_AUTH_INVALID_CREDENTIALS')
      assert.equal(error.status, 400)
      for (const sensitive of [email, password, accessToken]) assert.equal(error.message.includes(sensitive), false)
      return true
    },
  )
})

test('local Auth rejects missing tokens and mismatched verified identities', async () => {
  const base = {
    baseUrl: 'http://127.0.0.1:54321', expectedPort: '54321', anonKey: 'synthetic-anon-key',
    email: 'qa-user@example.test', password: 'synthetic-password', expectedUserId: 'synthetic-user-a',
  }
  let calls = 0
  await assert.rejects(
    getVerifiedLocalUserAccessToken({
      ...base,
      fetchImpl: async () => { calls++; return { ok: true, status: 200, json: async () => ({ user: { id: 'synthetic-user-a' } }) } },
    }),
    error => error.code === 'LOCAL_AUTH_ACCESS_TOKEN_MISSING',
  )
  assert.equal(calls, 1, 'No identity request may run without an access token')

  const token = `synthetic-${randomUUID()}`
  calls = 0
  await assert.rejects(
    getVerifiedLocalUserAccessToken({
      ...base,
      fetchImpl: async () => {
        calls++
        return calls === 1
          ? { ok: true, status: 200, json: async () => ({ access_token: token }) }
          : { ok: true, status: 200, json: async () => ({ id: 'synthetic-user-b' }) }
      },
    }),
    error => {
      assert.equal(error.code, 'LOCAL_AUTH_IDENTITY_MISMATCH')
      assert.equal(error.message.includes(token), false)
      return true
    },
  )
  assert.equal(calls, 2)
})

test('local Auth rejects non-loopback and wrong-port URLs before making requests', async () => {
  let calls = 0
  const base = {
    expectedPort: '54321', anonKey: 'synthetic-anon-key', email: 'qa-user@example.test',
    password: 'synthetic-password', expectedUserId: 'synthetic-user-a', fetchImpl: async () => { calls++ },
  }
  for (const [baseUrl, code] of [
    ['https://project.supabase.co', 'LOCAL_AUTH_URL_NOT_ALLOWED'],
    ['http://127.0.0.1:54322', 'LOCAL_AUTH_URL_NOT_ALLOWED'],
  ]) {
    await assert.rejects(
      getVerifiedLocalUserAccessToken({ ...base, baseUrl }),
      error => error.code === code,
    )
  }
  assert.equal(calls, 0)
})

test('local Auth failures from unexpected statuses stay sanitized and fail closed', async () => {
  const error = await getVerifiedLocalUserAccessToken({
    baseUrl: 'http://127.0.0.1:54321', expectedPort: '54321', anonKey: 'synthetic-anon-key',
    email: 'qa-user@example.test', password: 'synthetic-password', expectedUserId: 'synthetic-user-a',
    fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({ message: 'must not be surfaced' }) }),
  }).then(() => null, reason => reason)
  assert.ok(error instanceof LocalUserAuthError)
  assert.equal(error.code, 'LOCAL_AUTH_TOKEN_REQUEST_FAILED')
  assert.equal(error.status, 503)
  assert.equal(error.message.includes('must not be surfaced'), false)
})
