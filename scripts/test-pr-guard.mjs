import test from "node:test";
import assert from "node:assert/strict";
import { evaluatePullRequest, detectRecognizedSecret } from "./qa/check-pr-guard.mjs";

const clean = {
  prTitle: "fix: update guard",
  changedFiles: ["src/file.ts"],
  agentsPatch: "",
  vercelConfigText: JSON.stringify({ git: { deploymentEnabled: { main: false } } }),
  additionsPatch: "+const note = \"ordinary text\"",
  guardFilesChangedInBase: []
};

test("rejects deletion or edits of existing AGENTS.md lines unless owner-approved", () => {
  const patch = "@@ -1,2 +1 @@\n keep this\n-remove this existing rule";
  assert.match(evaluatePullRequest({ ...clean, agentsPatch: patch }).join("\n"), /AGENTS\.md/);
  assert.deepEqual(evaluatePullRequest({ ...clean, agentsPatch: patch, agentsOverrideApproved: true }), []);
});
test("allows additions to AGENTS.md without override", () => {
  const patch = "@@ -1,1 +1,2 @@\n existing rule\n+new rule";
  assert.deepEqual(evaluatePullRequest({ ...clean, agentsPatch: patch }), []);
});
test("requires deploymentEnabled.main to be the boolean false", () => {
  assert.deepEqual(evaluatePullRequest(clean), []);
  for (const config of [
    { git: { deploymentEnabled: { main: true } } },
    { git: { deploymentEnabled: {} } },
    { git: {} },
    {}
  ]) {
    assert.match(evaluatePullRequest({ ...clean, vercelConfigText: JSON.stringify(config) }).join("\n"), /vercel\.json.*explicitly false/);
  }
  assert.match(evaluatePullRequest({ ...clean, vercelConfigText: "{" }).join("\n"), /vercel\.json.*valid JSON/);
});
test("blocks PRs from changing guard files already present on main", () => {
  const errors = evaluatePullRequest({ ...clean, guardFilesChangedInBase: ["scripts/qa/check-pr-guard.mjs"] });
  assert.match(errors.join("\n"), /Guard enforcement files/);
});
test("permits an owner-approved guard implementation update without bypassing other checks", () => {
  const errors = evaluatePullRequest({
    ...clean,
    guardFilesChangedInBase: ["scripts/qa/check-pr-guard.mjs"],
    guardCodeUpdateApproved: true,
    vercelConfigText: JSON.stringify({ git: { deploymentEnabled: { main: true } } })
  });
  assert.doesNotMatch(errors.join("\n"), /Guard enforcement files/);
  assert.match(errors.join("\n"), /vercel\.json/);
});
test("guard-code-update approval cannot be replaced by the AGENTS override", () => {
  const protectedEdit = {
    ...clean,
    guardFilesChangedInBase: [".github/workflows/pr-guard.yml"],
    agentsPatch: "@@ -1 +0,0 @@\n-existing instruction"
  };
  assert.match(evaluatePullRequest({ ...protectedEdit, agentsOverrideApproved: true }).join("\n"), /Guard enforcement files/);
  assert.match(evaluatePullRequest({ ...protectedEdit, guardCodeUpdateApproved: true }).join("\n"), /AGENTS\.md/);
});
test("detects known provider token formats without printing token values", () => {
  const token = ["ghp", "Z".repeat(36)].join("_");
  const errors = evaluatePullRequest({ ...clean, additionsPatch: "+credential = " + token });
  assert.match(errors.join("\n"), /token\/secret pattern/);
  assert.doesNotMatch(errors.join("\n"), new RegExp(token));
});
test("detects provider keys and private key headers", () => {
  assert.equal(detectRecognizedSecret(["AWS_ACCESS_KEY_ID", ["AKIA", "1234567890ABCDEF"].join("")].join("=")), "AWS access key");
  assert.equal(detectRecognizedSecret(["-----BEGIN ", "PRIVATE KEY-----"].join("")), "private key");
});
test("detects secret assignments including JSON keys and ignores placeholders", () => {
  assert.equal(detectRecognizedSecret(["VERCEL_TOKEN", "private-value-1234567890"].join("=")), "credential assignment");
  assert.equal(detectRecognizedSecret("{ \"API_KEY\": \"private-value-1234567890\" }"), "credential assignment");
  assert.equal(detectRecognizedSecret(["VERCEL_TOKEN", "ci-placeholder-vercel-token"].join("=")), null);
  assert.equal(detectRecognizedSecret(["API_KEY", "your-api-key"].join("=")), null);
});
test("docs-prefixed PR may change only docs/ and root AGENTS.md", () => {
  assert.deepEqual(evaluatePullRequest({ ...clean, prTitle: "docs: update guide", changedFiles: ["docs/guide.md", "AGENTS.md"] }), []);
  assert.match(evaluatePullRequest({ ...clean, prTitle: "docs: update guide", changedFiles: ["docs/guide.md", "src/page.tsx"] }).join("\n"), /docs:.*outside/i);
});
test("non-docs PRs are not restricted by the docs title rule", () => {
  assert.deepEqual(evaluatePullRequest({ ...clean, prTitle: "fix: update page", changedFiles: ["src/page.tsx"] }), []);
});

