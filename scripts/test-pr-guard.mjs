import test from "node:test";
import assert from "node:assert/strict";
import { evaluatePullRequest, detectRecognizedSecret } from "./qa/check-pr-guard.mjs";
const clean = {
  prTitle: "fix: update docs",
  changedFiles: ["src/file.ts"],
  agentsPatch: "",
  vercelConfigText: JSON.stringify({ git: { deploymentEnabled: { main: false } } }),
  additionsPatch: "+const note = \"ordinary text\""
};
test("rejects deletion or edits of existing AGENTS.md lines", () => {
  const errors = evaluatePullRequest({ ...clean, agentsPatch: "@@ -1,2 +1 @@\n keep this\n-remove this existing rule" });
  assert.match(errors.join("\n"), /AGENTS\.md/);
});
test("allows additions to AGENTS.md without removing existing lines", () => {
  const errors = evaluatePullRequest({ ...clean, agentsPatch: "@@ -1,1 +1,2 @@\n existing rule\n+new rule" });
  assert.deepEqual(errors, []);
});
test("rejects vercel.json when git.deploymentEnabled.main is true", () => {
  const errors = evaluatePullRequest({ ...clean, vercelConfigText: JSON.stringify({ git: { deploymentEnabled: { main: true } } }) });
  assert.match(errors.join("\n"), /vercel\.json.*main/i);
});
test("allows main false and fails closed on invalid vercel.json", () => {
  assert.deepEqual(evaluatePullRequest(clean), []);
  const errors = evaluatePullRequest({ ...clean, vercelConfigText: "{" });
  assert.match(errors.join("\n"), /vercel\.json.*valid JSON/i);
});
test("detects a known GitHub token pattern without printing its value", () => {
  const token = ["ghp", "Z".repeat(36)].join("_");
  assert.equal(detectRecognizedSecret("value = " + token), "GitHub token");
});
test("detects provider keys and private key headers", () => {
  assert.equal(detectRecognizedSecret(["AWS_ACCESS_KEY_ID", ["AKIA", "1234567890ABCDEF"].join("")].join("=")), "AWS access key");
  assert.equal(detectRecognizedSecret(["-----BEGIN ", "PRIVATE KEY-----"].join("")), "private key");
});
test("detects secret assignments and ignores obvious placeholders", () => {
  assert.equal(detectRecognizedSecret(["VERCEL_TOKEN", "private-value-1234567890"].join("=")), "credential assignment");
  assert.equal(detectRecognizedSecret(["VERCEL_TOKEN", "ci-placeholder-vercel-token"].join("=")), null);
  assert.equal(detectRecognizedSecret(["API_KEY", "your-api-key"].join("=")), null);
});
test("rejects recognized credentials added by a PR", () => {
  const token = ["ghp", "Z".repeat(36)].join("_");
  const errors = evaluatePullRequest({ ...clean, additionsPatch: "+token = " + token });
  assert.match(errors.join("\n"), /token\/secret pattern/i);
});
test("docs-prefixed PR may change only docs/ and root AGENTS.md", () => {
  assert.deepEqual(evaluatePullRequest({ ...clean, prTitle: "docs: update guide", changedFiles: ["docs/guide.md", "AGENTS.md"] }), []);
  const errors = evaluatePullRequest({ ...clean, prTitle: "docs: update guide", changedFiles: ["docs/guide.md", "src/page.tsx"] });
  assert.match(errors.join("\n"), /docs:.*outside/i);
});
test("non-docs PRs are not restricted by the docs title rule", () => {
  assert.deepEqual(evaluatePullRequest({ ...clean, prTitle: "fix: update page", changedFiles: ["src/page.tsx"] }), []);
});

test("allows an AGENTS.md rule change only with an owner-approved override event", () => {
  const agentsPatch = "@@ -1 +1 @@\n-old rule\n+new rule";
  assert.match(evaluatePullRequest({ ...clean, agentsPatch }).join("\n"), /AGENTS\.md/);
  assert.deepEqual(evaluatePullRequest({ ...clean, agentsPatch, agentsOverrideApproved: true }), []);
});
test("AGENTS.md override leaves every other guard active", () => {
  const token = ["ghp", "Z".repeat(36)].join("_");
  const errors = evaluatePullRequest({
    ...clean,
    agentsPatch: "@@ -1 +1 @@\n-old rule\n+new rule",
    agentsOverrideApproved: true,
    vercelConfigText: JSON.stringify({ git: { deploymentEnabled: { main: true } } }),
    additionsPatch: "+credential = " + token
  });
  assert.match(errors.join("\n"), /vercel\.json/);
  assert.match(errors.join("\n"), /token\/secret pattern/);
  assert.doesNotMatch(errors.join("\n"), new RegExp(token));
});
test("guard failure messages never include the detected secret value", () => {
  const token = ["ghp", "Z".repeat(36)].join("_");
  const errors = evaluatePullRequest({ ...clean, additionsPatch: "+credential = " + token });
  assert.match(errors.join("\n"), /token\/secret pattern/);
  assert.doesNotMatch(errors.join("\n"), new RegExp(token));
});
