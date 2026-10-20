import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const severityOrder = ['critical', 'high', 'moderate', 'low', 'info']
const acceptedAdvisory = 'GHSA-VFJ7-8CJW-P6XM'
const acceptedBracesRange = '<=3.0.3'

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

function advisoryId(item) {
  if (!item || typeof item !== 'object' || typeof item.url !== 'string') return null
  const match = item.url.match(/GHSA-[a-z0-9-]+\/?$/i)
  return match?.[0]?.replace(/\/$/, '').toUpperCase() ?? null
}

function packageNameFromPathSegment(segment) {
  const separator = segment.startsWith('@') ? segment.indexOf('@', 1) : segment.indexOf('@')
  return separator < 0 ? segment : segment.slice(0, separator)
}

function versionAtMost303(version) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/)
  if (!match) return false
  const [major, minor, patch] = match.slice(1).map(Number)
  return major < 3 || (major === 3 && minor === 0 && patch <= 3)
}

function hasOnlyAcceptedBracesFinding({ vulnerabilities, metadata, npmTree, exitCode }) {
  if (exitCode !== 1 || !metadata || Number(metadata.critical) !== 0) return false
  if (severityOrder.filter(severity => severity !== 'high').some(severity => Number(metadata[severity] ?? 0) !== 0)) return false

  const entries = Object.entries(vulnerabilities)
  if (!entries.length || Number(metadata.high) !== entries.length) return false
  if (metadata.total !== undefined && Number(metadata.total) !== entries.length) return false
  const braces = vulnerabilities.braces
  if (!braces || braces.severity !== 'high' || !Array.isArray(braces.via) || braces.via.length !== 1) return false
  const [bracesAdvisory] = braces.via
  if (typeof bracesAdvisory === 'string' || advisoryId(bracesAdvisory) !== acceptedAdvisory ||
      bracesAdvisory.severity !== 'high' || bracesAdvisory.range !== acceptedBracesRange) return false
  if (braces.fixAvailable === true || (braces.fixAvailable && typeof braces.fixAvailable === 'object' && braces.fixAvailable.isSemVerMajor === false)) return false
  if (braces.fixAvailable && typeof braces.fixAvailable === 'object' && braces.fixAvailable.isSemVerMajor !== true) return false
  if (braces.fixAvailable !== false && braces.fixAvailable !== true &&
      (!braces.fixAvailable || typeof braces.fixAvailable !== 'object')) return false

  const paths = collectDependencyPaths(npmTree ?? {}, new Set(['braces'])).get('braces') ?? []
  if (!paths.length) return false
  const allowedPathPackages = new Set()
  for (const path of paths) {
    const segments = path.split(' > ')
    const names = segments.map(packageNameFromPathSegment)
    if (names.length < 3 || names[0] !== 'stock-portfolio' || !['tailwindcss', 'eslint-config-next'].includes(names[1]) || names.at(-1) !== 'braces') return false
    const bracesVersion = segments.at(-1).slice(segments.at(-1).lastIndexOf('@') + 1)
    if (!versionAtMost303(bracesVersion)) return false
    names.slice(1, -1).forEach(name => allowedPathPackages.add(name))
  }

  const allVulnerabilityPaths = collectDependencyPaths(npmTree ?? {}, new Set(entries.map(([name]) => name)))
  for (const [name] of entries) {
    const packagePaths = allVulnerabilityPaths.get(name) ?? []
    if (!packagePaths.length) return false
    for (const path of packagePaths) {
      const names = path.split(' > ').map(packageNameFromPathSegment)
      if (names.length < 2 || names[0] !== 'stock-portfolio' || !['tailwindcss', 'eslint-config-next'].includes(names[1])) return false
      names.slice(1).forEach(packageName => allowedPathPackages.add(packageName))
    }
  }

  function resolvesToAcceptedAdvisory(name, ancestors = new Set()) {
    if (ancestors.has(name)) return false
    const vulnerability = vulnerabilities[name]
    if (!vulnerability || vulnerability.severity !== 'high' || !Array.isArray(vulnerability.via) || vulnerability.via.length === 0) return false
    if (name === 'braces') {
      return vulnerability.via.length === 1 && typeof vulnerability.via[0] !== 'string' &&
        advisoryId(vulnerability.via[0]) === acceptedAdvisory &&
        vulnerability.via[0].severity === 'high' && vulnerability.via[0].range === acceptedBracesRange
    }
    if (!allowedPathPackages.has(name)) return false
    const nextAncestors = new Set([...ancestors, name])
    return vulnerability.via.every(item => typeof item === 'string' && item !== name &&
      (item === 'braces' || allowedPathPackages.has(item))) &&
      vulnerability.via.every(item => resolvesToAcceptedAdvisory(item, nextAncestors))
  }

  return entries.every(([name]) => resolvesToAcceptedAdvisory(name))
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
  const clean = names.length === 0 && exitCode === 0 && severityOrder.every(severity => Number(meta[severity] ?? 0) === 0)
  const exceptionAccepted = mode === 'Full' && hasOnlyAcceptedBracesFinding({ vulnerabilities, metadata: meta, npmTree, exitCode })
  const status = clean ? 'PASS' : exceptionAccepted ? 'PASS_WITH_EXCEPTION' : names.length > 0 || severityOrder.some(severity => Number(meta[severity] ?? 0) > 0) ? 'FINDINGS' : 'BLOCKED'
  const lines = [
    `# ${mode} npm audit`, '',
    `- Status: ${status}`,
    `- Commit: ${commit}`,
    `- npm audit exit code: ${exitCode}`,
    `- Distinct affected packages: ${names.length}`,
    `- Severity counts: ${counts}`,
    '',
  ]
  if (exceptionAccepted) lines.push(`- Accepted exception: ${acceptedAdvisory} only; Full audit remains non-clean and requires the documented review/closure conditions.`)
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
