import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'

async function importTsModule(filePath) {
  const source = fs.readFileSync(filePath, 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022, strict: true },
    fileName: filePath,
    reportDiagnostics: true,
  })
  const errors = (compiled.diagnostics ?? []).filter(item => item.category === ts.DiagnosticCategory.Error)
  assert.equal(errors.length, 0, `${filePath} transpile diagnostics: ${errors.map(item => item.messageText).join('; ')}`)
  return import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`)
}
const read = file => fs.readFileSync(file, 'utf8')

// ---------- trendMark: direction mark next to a percentage ----------
const { trendMark } = await importTsModule('lib/trend-mark.ts')
assert.equal(trendMark(5.2), '▲')
assert.equal(trendMark(-5.2), '▼')
assert.equal(trendMark(0), '')
assert.equal(trendMark(null), '')
assert.equal(trendMark(undefined), '')
assert.equal(trendMark(Number.NaN), '')
assert.equal(trendMark(Number.POSITIVE_INFINITY), '')
assert.equal(trendMark(Number.NEGATIVE_INFINITY), '')
// the mark follows the displayed value (2 decimals): +0.004 shows as "+0.00%" and -0.004 as "-0.00%", neither has a mark
assert.equal(trendMark(0.004), '')
assert.equal(trendMark(-0.004), '')
assert.equal(trendMark(0.005), '▲', 'a value that shows as +0.01% has a mark')
assert.equal(trendMark(-0.006), '▼')
assert.equal(trendMark(0.01), '▲')
assert.equal(trendMark(-0.01), '▼')
// review of PR #168: toFixed rounds half away from zero, so -0.005 displays as "-0.01" and needs the mark (Math.round gave -0)
assert.equal(trendMark(-0.005), '▼', 'a value that shows as -0.01% has a mark')
assert.equal(trendMark(0.005), '▲')
assert.equal(trendMark(-0.0049), '', 'shows as -0.00%')
assert.equal(trendMark(-0), '')
// the mark agrees with the text fmtPct builds (copy of fmtPct in PortfolioDashboard.tsx) for many values, including every half step
const fmtPct = n => (n === null ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`)
let seed = 987654321
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296 }
const samples = []
for (let k = -400; k <= 400; k++) samples.push(k / 1000, k / 100, k / 10)
for (let i = 0; i < 20000; i++) samples.push((rnd() - 0.5) * 0.04, (rnd() - 0.5) * 40, (rnd() - 0.5) * 4000)
for (const value of samples) {
  const text = fmtPct(value)
  const shown = Number(text.replace('%', ''))
  const expected = shown > 0 ? '▲' : shown < 0 ? '▼' : ''
  assert.equal(trendMark(value), expected, `mark for ${value} (shown as ${text})`)
}

// ---------- contrast of the dark-theme secondary text (WCAG) ----------
const lum = hex => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05) }
const card = '#111827'
assert.ok(contrast('#4b5563', card) < 3, 'the old gray-600 text was far too faint on the card')
assert.ok(contrast('#6b7280', card) < 4.5, 'the old gray-500 text was below the 4.5:1 reading limit')
assert.ok(contrast('#9ca3af', card) >= 4.5, 'the new text-gray-500 colour reads on the card')
assert.ok(contrast('#8b93a1', card) >= 4.5, 'the new text-gray-600 colour reads on the card')
assert.ok(contrast('#9ca3af', '#030712') >= 4.5, 'and on the page background')
assert.ok(contrast('#8b93a1', '#030712') >= 4.5)
assert.ok(contrast('#9ca3af', card) > contrast('#8b93a1', card), 'text-gray-600 stays one step quieter than text-gray-500')

// ---------- font ----------
const layout = read('app/layout.tsx')
assert.match(layout, /import \{ Noto_Sans_Thai \} from 'next\/font\/google'/)
assert.match(layout, /Noto_Sans_Thai\(\{ subsets: \['thai', 'latin'\], display: 'swap', variable: '--font-noto-sans-thai' \}\)/)
assert.match(layout, /<html lang="th" className=\{notoSansThai\.variable\} suppressHydrationWarning>/, 'the variable is on <html>, where Tailwind\'s preflight reads font-sans')
const tailwind = read('tailwind.config.ts')
assert.match(tailwind, /import defaultTheme from 'tailwindcss\/defaultTheme'/)
assert.match(tailwind, /sans: \['var\(--font-noto-sans-thai\)', \.\.\.defaultTheme\.fontFamily\.sans\]/, 'the Thai font comes first and the system fonts stay as the fallback')

// ---------- global CSS ----------
const css = read('app/globals.css')
assert.match(css, /body \{ font-variant-numeric: tabular-nums; \}/)
assert.match(css, /\[data-theme="dark"\] :where\(\.text-gray-500\) \{ color: #9ca3af; \}/, 'dark theme only, one-class specificity so hover/focus/dark: variants still win')
assert.match(css, /\[data-theme="dark"\] :where\(\.text-gray-600\) \{ color: #8b93a1; \}/)
assert.doesNotMatch(css, /\[data-theme="light"\][^{]*\.text-gray-500 \{ color: #9ca3af/, 'the light theme keeps its own colours')
assert.match(css, /\.text-\\\[10px\\\] \{ font-size: 11px; \}/)
assert.match(css, /\.text-\\\[11px\\\] \{ font-size: 12px; \}/)
assert.match(css, /\.skeleton \{ background-color: rgba\(75, 85, 99, 0\.55\); \}/)
assert.match(css, /\[data-theme="light"\] \.skeleton \{ background-color: #e2e8f0; \}/, 'the placeholder is visible on the light theme too')
// the rules sit after Tailwind's layers so they apply, and nothing was removed from the existing light-theme rules
assert.ok(css.indexOf('@tailwind utilities') < css.indexOf('Readability (v1.41.36)'))
assert.match(css, /\[data-theme="dark"\] \.risk-dashboard \.text-gray-500,/, 'the existing Risk dashboard rule is kept')
// hover/focus colours on elements that are gray-500/600 must keep working: no !important in the new dark rules
const readability = css.slice(css.indexOf('Readability (v1.41.36)'))
assert.doesNotMatch(readability, /!important/, 'the new rules must not override hover, focus or dark: colours')

// ---------- skeleton and trend mark components ----------
const skeleton = read('components/portfolio/Skeleton.tsx')
assert.match(skeleton, /role="status" aria-label=\{label\}/, 'screen readers are told that something is loading')
assert.match(skeleton, /skeleton animate-pulse motion-reduce:animate-none rounded/, 'no pulsing for people who ask for reduced motion')
assert.match(skeleton, /<span className="sr-only">\{label\}<\/span>/, 'the status region has a text screen readers can announce')
assert.match(skeleton, /label = 'กำลังโหลดข้อมูล'/)
const trendComponent = read('components/portfolio/TrendMark.tsx')
assert.match(trendComponent, /aria-hidden="true"/, 'the mark is decorative: the sign in the text already carries the meaning')
assert.match(trendComponent, /if \(!mark\) return null/)
assert.match(trendComponent, /className="mr-0\.5 text-\[10px\]"/, 'the mark is small and sits close to the number')
assert.match(tailwind, /\n {6}fontFamily: \{\r?\n {8}sans: \[/, 'the font family block is part of theme.extend and is not commented out')

// ---------- dashboard ----------
const dashboard = read('components/portfolio/PortfolioDashboard.tsx')
assert.match(dashboard, /import Skeleton from '\.\/Skeleton'/)
assert.match(dashboard, /import TrendMark from '\.\/TrendMark'/)
assert.equal((dashboard.match(/<Skeleton className="my-2 h-7 w-28" \/>/g) ?? []).length, 4, 'the four cash and return cards use a placeholder')
assert.equal((dashboard.match(/<Skeleton className="h-16 w-full" label="กำลังโหลด Track Record" \/>/g) ?? []).length, 1)
assert.doesNotMatch(dashboard, /py-2 text-sm text-gray-500">กำลังโหลดข้อมูล\.\.\./, 'the four card loading sentences are gone')
assert.doesNotMatch(dashboard, /<p className="text-gray-600 text-sm">กำลังโหลด\.\.\.<\/p>/)
assert.match(dashboard, /\$\{pnlColor\}`\}><TrendMark value=\{h\.pnl_pct\} \/>\{fmtPct\(h\.pnl_pct\)\}<\/td>/, 'the table shows the mark before the percentage')
assert.match(dashboard, /\$\{pctBadge\}`\}><TrendMark value=\{h\.pnl_pct\} \/>\{fmtPct\(h\.pnl_pct\)\}<\/span>/, 'the mobile card badge too')
assert.equal((dashboard.match(/<TrendMark /g) ?? []).length, 2)
assert.match(dashboard, /function fmtPct\(n: number \| null\) \{\r?\n  if \(n === null\) return '—'\r?\n  return `\$\{n >= 0 \? '\+' : ''\}\$\{n\.toFixed\(2\)\}%`/, 'the sign in the text is unchanged')

// ---------- scope ----------
const pkg = JSON.parse(read('package.json'))
for (const name of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) {
  assert.ok(!/fontsource|webfont|google-fonts/i.test(name), 'no extra font package: ' + name)
}
for (const file of ['lib/finnhub.ts', 'proxy.ts', 'app/api/prices/route.ts']) {
  assert.doesNotMatch(read(file), /Noto_Sans_Thai|trendMark|Skeleton/, file + ' is not part of this change')
}

console.log('✓ UI level 1 (Thai font, dark secondary text contrast, small text, skeleton, trend mark) regression tests passed')
