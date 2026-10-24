import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import postcss from 'postcss'
import colors from 'tailwindcss/colors.js'

function transpileModule(source, fileName) {
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022, strict: true },
    fileName,
    reportDiagnostics: true,
  })
  const errors = (compiled.diagnostics ?? []).filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)
  assert.equal(errors.length, 0, `${fileName} transpile diagnostics: ${errors.map(error => error.messageText).join('; ')}`)
  return compiled.outputText
}

async function importTsModule(filePath) {
  let source = fs.readFileSync(filePath, 'utf8')
  const validationModules = [
    ['@/lib/portfolio-validation', 'lib/portfolio-validation.ts'],
    ['@/lib/transaction-validation', 'lib/transaction-validation.ts'],
  ]
  for (const [specifier, dependencyPath] of validationModules) {
    if (!source.includes(specifier)) continue
    const dependency = transpileModule(fs.readFileSync(dependencyPath, 'utf8'), dependencyPath)
    const dependencyUrl = `data:text/javascript;base64,${Buffer.from(dependency).toString('base64')}`
    source = source.replaceAll(`'${specifier}'`, `'${dependencyUrl}'`)
  }
  const output = transpileModule(source, filePath)
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`)
}

const preview = await importTsModule('lib/import-preview.ts')
const header = preview.CANONICAL_CSV_HEADERS.join(',')
const csv = [
  '\uFEFF' + header,
  '"BUY","NVDA","2","142.50","0.25","","2026-10-12","USD"',
  'BUY,NVDA,2,142.50,0.25,,2026-10-12,USD',
  'BUY,MSFT,1,521.30,0,,2026-10-12,USD',
].join('\r\n')
const parsed = preview.parseCanonicalCsv(csv)
assert.deepEqual(parsed.errors, [])
assert.equal(parsed.rows.length, 3, 'duplicate candidates remain visible in preview')
assert.equal(parsed.rows[0].transaction.symbol, 'NVDA')
assert.equal(parsed.rows[0].transaction.fee, 0.25)
assert.equal(parsed.rows[1].duplicateCandidate, true)
assert.equal(parsed.rows[2].duplicateCandidate, false)
assert.equal(parsed.rejected.length, 0)
assert.match(parsed.warnings.join(' '), /Duplicate Candidate/)

const duplicateHeaders = preview.parseCanonicalCsv(`${header},SYMBOL\n`)
assert.match(duplicateHeaders.errors.join(' '), /Header ซ้ำ/i)

const missingAndUnknown = preview.parseCanonicalCsv('type,symbol,shares,price,fee,amount,trade_date,currency\n')
assert.match(missingAndUnknown.errors.join(' '), /Header/)

const malformedQuote = preview.parseCanonicalCsv(`${header}\nBUY,"NVDA,2,142.50,0.25,,2026-10-12,USD`)
assert.match(malformedQuote.errors.join(' '), /quote ไม่ถูกปิด/)

const textAfterQuote = preview.parseCanonicalCsv(`${header}\nBUY,"NVDA"x,2,142.50,0.25,,2026-10-12,USD`)
assert.match(textAfterQuote.errors.join(' '), /ต่อหลังเครื่องหมายปิด quote/)

const rejected = preview.parseCanonicalCsv([
  header,
  'BUY,"=HYPERLINK(""https://bad.example"")",1,10,0,,2026-10-12,USD',
  'BUY,AMD,1,10,0,,2026-10-12,EUR',
  'BUY,AMD,1,10,0,,2026-02-30,USD',
  'BUY,AMD,1,10,0,,2026-10-12',
].join('\n'))
assert.equal(rejected.rows.length, 0)
assert.equal(rejected.rejected.length, 4)
assert.match(rejected.rejected[0].reason, /Formula/)
assert.match(rejected.rejected[1].reason, /USD/)
assert.match(rejected.rejected[2].reason, /วันที่/)
assert.match(rejected.rejected[3].reason, /จำนวน field/)

for (const formula of ['=1+1', '+SUM(A1)', '@SUM(A1)', '-SUM(A1)', '\t=1+1', '  =1+1']) {
  const injected = preview.parseCanonicalCsv(`${header}\nBUY,"${formula}",1,10,0,,2026-10-12,USD`)
  assert.equal(injected.rows.length, 0, 'formula-like values must not enter the preview')
  assert.match(injected.rejected[0].reason, /Formula/)
}

const overLimit = [header, ...Array.from({ length: preview.MAX_CSV_ROWS + 1 }, (_, index) => `BUY,ACME,1,10,0,,2026-10-${String(index % 28 + 1).padStart(2, '0')},USD`)].join('\n')
assert.match(preview.parseCanonicalCsv(overLimit).errors.join(' '), /เกิน 500 แถว/)
assert.match(preview.parseCanonicalCsv('x'.repeat(preview.MAX_CSV_BYTES + 1)).errors.join(' '), /ขนาดไม่เกิน/)
assert.equal(preview.parseCanonicalCsv(header).rows.length, 0)
for (const count of [1, 499, 500]) {
  const boundary = [header, ...Array.from({ length: count }, (_, index) => `BUY,ACME,1,10,0,,2026-10-${String(index % 28 + 1).padStart(2, '0')},USD`)].join('\n')
  assert.equal(preview.parseCanonicalCsv(boundary).rows.length, count, `${count} row boundary remains previewable`)
}
assert.equal(preview.validateScreenshotImageMetadata({ type: 'image/png', size: preview.MAX_SCREENSHOT_BYTES, width: 4000, height: 4000 }), null)
assert.match(preview.validateScreenshotImageMetadata({ type: 'image/png', size: preview.MAX_SCREENSHOT_BYTES + 1, width: 100, height: 100 }), /5 MB/)
assert.match(preview.validateScreenshotImageMetadata({ type: 'application/pdf', size: 100, width: 1, height: 1 }), /JPG/)
assert.match(preview.validateScreenshotImageMetadata({ type: 'image/jpeg', size: 100, width: 4001, height: 4000 }), /16 ล้าน/)

const ocr = preview.parseScreenshotOcr([
  'Symbol Shares Price Date',
  'nvda 12.5 142.50 2026-10-12',
  'MSFT 4.5 521.30 2026-10-12',
  'BAD! 0 12.00 2026-10-12',
  'TSLA 2 200.00 2026-02-30',
  'unrecognized text from the screenshot',
].join('\n'))
assert.equal(ocr.rows.length, 2)
assert.equal(ocr.rows[0].symbol, 'NVDA')
assert.equal(ocr.rows[0].marketValue, 1781.25)
assert.equal(ocr.rejected.length, 3)
assert.match(ocr.rejected[0].reason, /Symbol/)
assert.match(ocr.rejected[1].reason, /วันที่/)
assert.match(ocr.rejected[2].reason, /รูปแบบ/)
assert.equal(preview.parseScreenshotOcr('x'.repeat(preview.MAX_OCR_TEXT_LENGTH + 1)).rows.length, 0)
const tooManySnapshotRows = Array.from({ length: preview.MAX_SCREENSHOT_ROWS + 1 }, () => 'NVDA 1 100 2026-10-12').join('\n')
assert.equal(preview.parseScreenshotOcr(tooManySnapshotRows).rows.length, 0)
assert.match(preview.parseScreenshotOcr(tooManySnapshotRows).rejected[0].reason, /ไม่เกิน 100/)

const component = fs.readFileSync('components/portfolio/ImportPreviewWorkspace.tsx', 'utf8')
assert.doesNotMatch(component, /fetch\s*\(|localStorage|sessionStorage|indexedDB|sendBeacon|console\.(?:log|info|warn|error)/, 'preview UI must not persist or transmit imported content')
assert.match(component, /cacheMethod: 'write'/, 'only the OCR model may use browser cache to avoid repeated downloads')
assert.match(component, /ไฟล์และข้อความอยู่ในหน่วยความจำ/, 'raw source files and OCR text must remain page-memory only')
assert.match(component, /await worker\.terminate\(\)/, 'OCR worker must be terminated after processing')
assert.doesNotMatch(component, /dangerouslySetInnerHTML/, 'untrusted import values must render as escaped text')

// Calculate contrast from the existing theme mappings and Tailwind palette,
// rather than treating the presence of a color class as evidence of readability.
const themeCss = postcss.parse(fs.readFileSync('app/globals.css', 'utf8'))
function lightColor(className, property, fallback) {
  let color = fallback
  const selector = `[data-theme="light"] .${className.replaceAll('/', '\\/')}`
  themeCss.walkRules(rule => {
    if (rule.selectors?.includes(selector)) rule.walkDecls(property, declaration => { color = declaration.value.replace(/\s*!important$/, '') })
  })
  return color
}
function rgb(hex) {
  const expanded = hex.length === 4 ? `#${[...hex.slice(1)].map(character => character.repeat(2)).join('')}` : hex
  return [1, 3, 5].map(index => parseInt(expanded.slice(index, index + 2), 16) / 255)
}
function blend(foreground, background, alpha) {
  return foreground.map((channel, index) => channel * alpha + background[index] * (1 - alpha))
}
function luminance(color) {
  const linear = color.map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722
}
function contrast(foreground, background) {
  const a = luminance(foreground)
  const b = luminance(background)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}
const darkPanel = blend(rgb(colors.gray[900]), rgb(colors.gray[950]), 0.5)
const lightPanel = rgb(lightColor('bg-gray-900/50', 'background-color', colors.gray[900]))
for (const semantic of ['amber', 'red']) {
  const match = component.match(new RegExp(`text-${semantic}-(\\d+)`))
  assert.ok(match, `${semantic} status must have an explicit text color`)
  const shade = match[1]
  const darkBackground = blend(rgb(colors[semantic][500]), darkPanel, 0.1)
  const lightBackground = rgb(lightColor(`bg-${semantic}-500/10`, 'background-color', '#000000'))
  const lightHasBackgroundOverride = lightColor(`bg-${semantic}-500/10`, 'background-color', '') !== ''
  const effectiveLightBackground = lightHasBackgroundOverride ? lightBackground : blend(rgb(colors[semantic][500]), lightPanel, 0.1)
  assert.ok(contrast(rgb(colors[semantic][shade]), darkBackground) >= 4.5, `${semantic} dark status contrast must meet WCAG AA`)
  assert.ok(contrast(rgb(lightColor(`text-${semantic}-${shade}`, 'color', colors[semantic][shade])), effectiveLightBackground) >= 4.5, `${semantic} light status contrast must meet WCAG AA`)
}
assert.match(component, /hover:bg-blue-700/, 'primary action hover must retain a readable background')
for (const shade of [600, 700]) assert.ok(contrast(rgb(colors.white), rgb(colors.blue[shade])) >= 4.5, 'primary action text must meet AA in default and hover states')
assert.ok(contrast(rgb(colors.gray[400]), darkPanel) >= 4.5, 'informational and success status text must remain readable in dark mode')
assert.ok(contrast(rgb(lightColor('text-gray-400', 'color', colors.gray[400])), lightPanel) >= 4.5, 'informational and success status text must remain readable in light mode')

const page = fs.readFileSync('app/imports/page.tsx', 'utf8')
assert.match(page, /import \{ redirect \} from 'next\/navigation'/, 'direct Import Preview access must use the framework redirect')
assert.match(page, /redirect\('\/dashboard'\)/, 'the retired Import Preview route must return users to Dashboard')
assert.doesNotMatch(page, /ImportPreviewWorkspace|InactivityPinLock/, 'the retired route must not render the preview workspace')
const nav = fs.readFileSync('components/navigation/AppTabs.tsx', 'utf8')
assert.doesNotMatch(nav, /href: '\/imports'/, 'Import Preview must not appear in the navigation')
const rootGuard = fs.readFileSync('components/auth/UserSettingsMutationGuard.tsx', 'utf8')
assert.match(rootGuard, /pathname === '\/imports' \|\| pathname\.startsWith\('\/imports\/'\)/, 'preview route must skip the global portfolio data read')
const currentChangelog = fs.readFileSync('config/changelog-v1402.ts', 'utf8')
assert.match(currentChangelog, /version: 'v1\.40\.2'/, 'the removal must be recorded under its pending patch candidate')
assert.match(currentChangelog, /Import Preview/)
assert.match(currentChangelog, /Unreleased — Release Candidate/)
assert.match(currentChangelog, /Security Gate: HOLD/)

console.log('✓ Import Preview deterministic regression tests passed')
