import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
const PLACEHOLDER = /^(?:ci[-_ ]?placeholder|placeholder|example|your[-_ ]|<[^>]+>|\$\{[^}]+\}|redacted|replace[-_ ]?me|fake[-_ ]|test[-_ ]|dummy)/i;
export function detectRecognizedSecret(line) {
  if (/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/.test(line)) return "private key";
  if (/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/.test(line)) return "GitHub token";
  if (/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/.test(line)) return "AWS access key";
  if (/\bAIza[0-9A-Za-z_-]{35}\b/.test(line)) return "Google API key";
  if (/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/.test(line)) return "Slack token";
  if (/\bvercel_[A-Za-z0-9_-]{20,}\b/.test(line)) return "Vercel token";
  const assignment = line.match(/\b([A-Za-z0-9_-]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API[_-]?KEY|PRIVATE[_-]?KEY)[A-Za-z0-9_-]*)\b\s*[:=]\s*["']?([^"' ,;\s]{8,})/i);
  if (!assignment) return null;
  if (PLACEHOLDER.test(assignment[2])) return null;
  if (/^(?:true|false|null|undefined)$/i.test(assignment[2])) return null;
  return "credential assignment";
}
export function evaluatePullRequest({ prTitle, changedFiles, agentsPatch, vercelConfigText, additionsPatch }) {
  const errors = [];
  if (agentsPatch.split(/\r?\n/).some((line) => line.startsWith("-") && !line.startsWith("---"))) errors.push("AGENTS.md: existing lines may not be deleted or edited; additions are allowed.");
  try {
    const config = JSON.parse(vercelConfigText);
    if (config?.git?.deploymentEnabled?.main === true) errors.push("vercel.json: git.deploymentEnabled.main must remain false.");
  } catch {
    errors.push("vercel.json must contain valid JSON for the deployment guard.");
  }
  for (const line of additionsPatch.split(/\r?\n/)) {
    if (!line.startsWith("+") || line.startsWith("+++")) continue;
    const kind = detectRecognizedSecret(line.slice(1));
    if (kind) {
      errors.push("Added lines contain a recognized token/secret pattern (" + kind + "); remove it and rotate it if it was real.");
      break;
    }
  }
  if (/^docs:/i.test(prTitle.trim())) {
    const outOfScope = changedFiles.filter((path) => path !== "AGENTS.md" && !path.startsWith("docs/"));
    if (outOfScope.length > 0) errors.push("PR title docs: may change only docs/ and root AGENTS.md; outside paths: " + outOfScope.join(", ") + ".");
  }
  return errors;
}
function gitDiff(args) {
  return execFileSync("git", ["diff", "--no-ext-diff", "--no-color", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}
function main() {
  const baseSha = process.env.BASE_SHA ?? "";
  const headSha = process.env.HEAD_SHA ?? "";
  if (!/^[0-9a-f]{40}$/i.test(baseSha) || !/^[0-9a-f]{40}$/i.test(headSha)) throw new Error("BASE_SHA and HEAD_SHA must be full 40-character commit SHAs.");
  const range = baseSha + "..." + headSha;
  const changedFiles = gitDiff(["--name-only", "-z", range]).split("\0").filter(Boolean);
  const agentsPatch = gitDiff(["--unified=0", range, "--", "AGENTS.md"]);
  const additionsPatch = gitDiff(["--unified=0", range]);
  const vercelConfigText = readFileSync("vercel.json", "utf8");
  const errors = evaluatePullRequest({ prTitle: process.env.PR_TITLE ?? "", changedFiles, agentsPatch, vercelConfigText, additionsPatch });
  if (errors.length) {
    console.error("PR guard failed:");
    for (const error of errors) console.error("- " + error);
    process.exitCode = 1;
    return;
  }
  console.log("PR guard passed.");
}
if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  try { main(); } catch (error) {
    console.error("PR guard could not verify the change: " + error.message);
    process.exitCode = 1;
  }
}
