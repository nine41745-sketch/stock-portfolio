import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const severityOrder = ['critical', 'high', 'moderate', 'low', 'info']

function collectDependencyPaths(root, affectedNames) {
  const matches = new Map([...affectedNames].map(name => [name, []]))
  const rootName = root?.name || 'stock-portfolio'

  function visit(node, currentPath, ancestors) {
    for (const [name, dependency] of Object.entries(node?.dependencies ?? {})) {
      const version = typeof dependency.version === 'string' ? dependency.version : 'version-unavailable'
      const path = [...currentPath, `${name}@${version}`]
      if (matches.has(name)) matches.get(name).push(path.join(' > '))
      if (!ancestors.has(dependency)) visit(dependency, path, new Set([...ancestors, dependency]))
    }
  }

  visit(root, [rootName], new Set([root]))
  return matches
}

function fixLabel(value) {
  if (value === true) return 'npm metadata reports a fix available (compatibility not independently verified)'
  if (value === false || value == null) return 'npm metadata reports no fix available'
  if (typeof value === 'object') {
    const target = [value.name, value.version].filter(Boolean).join('@')
    return `npm metadata reports a fix${target ? ` via ${target}` : ''}${value.isSemVerMajor ? ' requiring a SemVer-major change' : ''} (compatibility not independently verified)`
  }
  return 'npm metadata fix availability is unknown'
}

export function renderAuditSummary({ report, npmTree, exitCode, mode, commit = 'not supplied' }) {
  const meta = report?.metadata?.vulnerabilities
  const vulnerabilities = report?.vulnerabilities
  if (report?.error || !report || typeof vulnerabilities !== 'object' || !meta) {
    const detail = report?.error?.code === 'ENOTFOUND' ? 'Registry DNS lookup failed (ENOTFOUND).' : 'Audit did not return a complete npm audit JSON report.'
    return { status: 'BLOCKED', markdown: `# ${mode} npm audit\n\n- Status: BLOCKED\n- Commit: ${commit}\n- Exit code: ${exitCode}\n- Reason: ${detail}\n` }
  }

  const names = Object.keys(vulnerabilities).sort()
  const paths = collectDependencyPaths(npmTree ?? {}, new Set(names))
  const counts = severityOrder.map(severity => `${severity}: ${Number(meta[severity] ?? 0)}`).join(', ')
  const status = names.length === 0 && exitCode === 0 ? 'PASS' : names.length > 0 ? 'FINDINGS' : 'BLOCKED'
  const lines = [
    `# ${mode} npm audit`, '',
    `- Status: ${status}`,
    `- Commit: ${commit}`,
    `- npm audit exit code: ${exitCode}`,
    `- Distinct affected packages: ${names.length}`,
    `- Severity counts: ${counts}`,
    '',
  ]
  if (names.length) {
    lines.push('## Affected packages, advisories, dependency paths, and npm fix metadata', '')
    for (const name of names) {
      const vuln = vulnerabilities[name] ?? {}
      const advisories = (vuln.via ?? []).map(item => {
        if (typeof item === 'string') return item
        return [item.source ? String(item.source) : null, item.url ? String(item.url).split('/').pop() : null].filter(Boolean).join(' ')
      }).filter(Boolean)
      lines.push(`- ${name}: severity ${vuln.severity ?? 'unknown'}; range ${vuln.range ?? 'unknown'}; advisories ${advisories.join(', ') || 'not identified'}; ${fixLabel(vuln.fixAvailable)}`)
      const packagePaths = paths.get(name) ?? []
      lines.push(`  - Dependency paths: ${packagePaths.length ? packagePaths.join('; ') : 'not present in the installed npm dependency tree'}`)
    }
  } else {
    lines.push('No affected packages were reported by npm audit.')
  }
  lines.push('', 'This is the package registry audit result for the exact checked-out commit. npm fix metadata is informational and does not constitute a remediation decision.', '')
  return { status, markdown: lines.join('\n') }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , mode, auditPath, treePath, exitCodeText, outputPath] = process.argv
  if (!mode || !auditPath || !treePath || !outputPath) throw new Error('Usage: node summarize-npm-audit.mjs <mode> <audit-json> <npm-ls-json> <exit-code> <output-md>')
  const parse = async path => {
    try { return JSON.parse(await readFile(path, 'utf8')) } catch { return null }
  }
  const auditText = await readFile(auditPath, 'utf8').catch(() => '')
  const report = await parse(auditPath)
  const npmTree = await parse(treePath)
  const result = renderAuditSummary({ report: report ?? (auditText ? { error: { code: 'INVALID_JSON' } } : null), npmTree, exitCode: Number(exitCodeText), mode, commit: process.env.GITHUB_SHA ?? 'not supplied' })
  await writeFile(outputPath, result.markdown, 'utf8')
  console.log(result.status)
}
