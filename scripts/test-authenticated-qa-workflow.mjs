import assert from 'node:assert/strict'
import fs from 'node:fs'

const workflow = fs.readFileSync('.github/workflows/authenticated-browser-qa.yml', 'utf8')

const has = (pattern, message) => assert.ok(pattern.test(workflow), message)

has(/^  workflow_dispatch:/m, 'QA must be manually runnable for the current main snapshot')
has(/target_sha:[\s\S]*?required: true/, 'Manual QA must require an explicit target SHA')
has(/github\.event_name == 'workflow_dispatch'/, 'The manual route must be separately gated')
has(/github\.ref == 'refs\/heads\/main'/, 'Manual QA must run only from the main workflow ref')
has(/github\.actor == 'nine41745-sketch'/, 'Manual QA must be restricted to the repository owner')
has(/ref: \$\{\{ github\.event_name == 'workflow_dispatch' && 'main' \|\| env\.QA_EXPECTED_HEAD_SHA \}\}/, 'Manual runs must begin from main while PR runs keep their exact target checkout')
has(/test "\$\(git rev-parse HEAD\)" = "\$QA_EXPECTED_HEAD_SHA"/, 'Checkout must match the verified expected target SHA')
has(/github\.event\.pull_request\.head\.ref == 'codex\/qa-main-readiness'[\s\S]*?github\.event\.pull_request\.base\.ref == 'main'/, 'The isolated QA PR route must be restricted to its dedicated branch and main base')
has(/github\.event\.pull_request\.head\.ref == 'codex\/qa-main-readiness' && github\.event\.pull_request\.base\.sha/, 'The QA PR must test its exact main base SHA, not the workflow branch head')
has(/github\.event\.pull_request\.number == 83/, 'QA #47 must be restricted to its exact PR')
has(/github\.event\.pull_request\.head\.ref == 'codex\/qa47-pin-completion'/, 'QA #47 must use its dedicated branch')
has(/github\.event\.pull_request\.base\.ref == 'main'/, 'QA #47 must target main')
has(/elif number == "83" and head\.get\("ref"\) == "codex\/qa47-pin-completion"[\s\S]*?head\.get\("sha"\) != sha/, 'QA #47 must test the exact PR head SHA and reject other targets')
has(/sha != base\.get\("sha"\)/, 'The PR validator must bind the target SHA to the event base SHA')
has(/git ls-remote --exit-code origin refs\/heads\/main/, 'Manual QA must compare its target with live main before and after tests')
has(/Confirm main SHA is still current[\s\S]*?if: always\(\)/, 'The final exact-main check must run even after a failed QA step')
has(/persist-credentials: false/, 'Checkout credentials must not persist')
has(/node-version: '22'/, 'QA must use the supported Node 22 runtime')
has(/deny-external-network\.cjs/, 'QA must retain the external network guard')
has(/supabase start --exclude/, 'QA must use its isolated local Supabase test stack')
has(/permissions:\s*\n\s+contents: read/, 'Workflow token permissions must remain read-only')

const vercel = JSON.parse(fs.readFileSync('vercel.json', 'utf8'))
assert.equal(vercel.git?.deploymentEnabled?.['codex/qa-main-readiness'], false, 'The QA branch must stay excluded from Vercel deployments')
assert.equal(vercel.git?.deploymentEnabled?.['codex/qa47-pin-completion'], false, 'QA #47 must stay excluded from Vercel deployments')

console.log('Authenticated QA workflow safety assertions passed')
