const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = process.cwd();
const cli = path.join(root, 'node_modules', 'oxlint', 'bin', 'oxlint');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stock-portfolio-lint-test-'));
const cases = [
  // React Compiler Rules: options, dynamic gating and purity, including allowed contexts.
  { id: 'hooks/config-valid-options', suite: 'hooks/config', options: { compilationMode: 'infer', panicThreshold: 'none' }, code: `export function Good({value}) { return <p>{value}</p> }`, expected: false },
  // These values did not produce a diagnostic in either implementation for this lint-rule path; keep explicit negative assertions.
  { id: 'hooks/config-unknown-option-no-diagnostic', suite: 'hooks/config', options: { compileMode: 'all' }, code: `export function Good() { 'use memo'; return <p>ok</p> }`, expected: false },
  { id: 'hooks/config-invalid-compilation-mode-no-diagnostic', suite: 'hooks/config', options: { compilationMode: 'everything' }, code: `export function Good() { 'use memo'; return <p>ok</p> }`, expected: false },
  { id: 'hooks/config-invalid-dynamic-gating-shape', suite: 'hooks/config', options: { dynamicGating: {} }, code: `export function Good() { 'use memo if(enabled)'; return <p>ok</p> }`, expected: true },
  { id: 'hooks/config-invalid-target', suite: 'hooks/config', options: { target: 'future' }, code: `export function Good() { 'use memo'; return <p>ok</p> }`, expected: true },
  { id: 'hooks/gating-no-directive', suite: 'hooks/gating', options: { dynamicGating: { source: './flags', importSpecifierName: 'enabled' } }, code: `export function Good({value}) { return <p>{value}</p> }`, expected: false },
  { id: 'hooks/gating-valid-dynamic-directive', suite: 'hooks/gating', options: { dynamicGating: { source: './flags', importSpecifierName: 'enabled' } }, code: `export function Good() { 'use memo if(enabled)'; return <p>ok</p> }`, expected: false },
  { id: 'hooks/gating-invalid-dynamic-identifier', suite: 'hooks/gating', options: { dynamicGating: { source: './flags', importSpecifierName: 'enabled' } }, code: `export function Bad() { 'use memo if(enabled!)'; return <p>bad</p> }`, expected: true },
  { id: 'hooks/gating-duplicate-dynamic-directive', suite: 'hooks/gating', options: { dynamicGating: { source: './flags', importSpecifierName: 'enabled' } }, code: `export function Bad() { 'use memo if(enabled)'; 'use memo if(other)'; return <p>bad</p> }`, expected: true },
  { id: 'hooks/purity-math-random-render', suite: 'hooks/purity', code: `export function Bad() { return <p>{Math.random()}</p> }`, expected: true },
  { id: 'hooks/purity-date-now-render', suite: 'hooks/purity', code: `export function Bad() { return <p>{Date.now()}</p> }`, expected: true },
  { id: 'hooks/purity-new-date-render-no-diagnostic', suite: 'hooks/purity', code: `export function Bad() { 'use memo'; const now = new Date(); return <p>{now.toISOString()}</p> }`, expected: false },
  { id: 'hooks/purity-random-outside-render', suite: 'hooks/purity', code: `const stable = Math.random(); export function Good() { return <p>{stable}</p> }`, expected: false },
  { id: 'hooks/purity-random-in-event-handler', suite: 'hooks/purity', code: `export function Good() { return <button onClick={() => Math.random()}>go</button> }`, expected: false },
  { id: 'hooks/purity-random-in-effect', suite: 'hooks/purity', code: `import {useEffect} from 'react'; export function Good() { useEffect(() => { const n = Math.random(); console.log(n) }, []); return <p/> }`, expected: false },
  { id: 'hooks/purity-new-date-outside-render', suite: 'hooks/purity', code: `const now = new Date(); export function Good() { return <p>{now.toISOString()}</p> }`, expected: false },
  { id: 'hooks/purity-new-date-in-event-handler', suite: 'hooks/purity', code: `export function Good() { return <button onClick={() => new Date()}>go</button> }`, expected: false },
  { id: 'hooks/purity-date-now-in-effect', suite: 'hooks/purity', code: `import {useEffect} from 'react'; export function Good() { useEffect(() => { const n = Date.now(); console.log(n) }, []); return <p/> }`, expected: false },
  // Next navigation rule: global references, computed member names, relative/absolute values and shadowed names.
  { id: 'next/global-window-assign-relative', suite: 'next/no-location-assign-relative-destination', code: `window.location.assign('/dashboard')`, expected: true },
  { id: 'next/global-window-computed-assign-relative', suite: 'next/no-location-assign-relative-destination', code: `window.location['assign']('/dashboard')`, expected: true },
  { id: 'next/global-this-assign-relative', suite: 'next/no-location-assign-relative-destination', code: `globalThis.location.assign('../account')`, expected: true },
  { id: 'next/global-this-computed-assign-relative', suite: 'next/no-location-assign-relative-destination', code: `globalThis['location']['assign']('/account')`, expected: true },
  { id: 'next/global-this-href-relative', suite: 'next/no-location-assign-relative-destination', code: `globalThis.location.href = '/account'`, expected: true },
  { id: 'next/self-assign-relative', suite: 'next/no-location-assign-relative-destination', code: `self.location.assign('/account')`, expected: true },
  { id: 'next/document-href-relative', suite: 'next/no-location-assign-relative-destination', code: `document.location.href = '/account'`, expected: true },
  { id: 'next/global-this-absolute-not-reported', suite: 'next/no-location-assign-relative-destination', code: `globalThis.location.assign('https://example.com/account')`, expected: false },
  { id: 'next/shadowed-global-this-not-reported', suite: 'next/no-location-assign-relative-destination', code: `function go(globalThis) { globalThis.location.assign('/account') }`, expected: false },
  { id: 'next/global-location-href-relative', suite: 'next/no-location-assign-relative-destination', code: `location.href = '/dashboard'`, expected: true },
  { id: 'next/global-location-computed-href-relative', suite: 'next/no-location-assign-relative-destination', code: `window.location['href'] = '/dashboard'`, expected: true },
  { id: 'next/absolute-url-not-reported', suite: 'next/no-location-assign-relative-destination', code: `window.location.assign('https://example.com/dashboard')`, expected: false },
  { id: 'next/protocol-relative-url-not-reported', suite: 'next/no-location-assign-relative-destination', code: `window.location.assign('//example.com/dashboard')`, expected: false },
  { id: 'next/shadowed-window-not-reported', suite: 'next/no-location-assign-relative-destination', code: `function go(window) { window.location.assign('/dashboard') }`, expected: false },
  { id: 'next/shadowed-location-not-reported', suite: 'next/no-location-assign-relative-destination', code: `function go(location) { location.href = '/dashboard' }`, expected: false },
  { id: 'next/dynamic-property-not-reported', suite: 'next/no-location-assign-relative-destination', code: `window.location[action]('/dashboard')`, expected: false },
  // Legacy React deprecations: default, imported alias and namespace wrapper; shadowing and type-only import negatives.
  { id: 'react/deprecated-create-class', suite: 'react/no-deprecated', code: `import React from 'react'; const C = React.createClass({ render() { return <div/> } });`, expected: true },
  { id: 'react/deprecated-import-alias', suite: 'react/no-deprecated', code: `import {createClass as make} from 'react'; const C = make({ render() { return <div/> } });`, expected: true },
  { id: 'react/deprecated-namespace-alias', suite: 'react/no-deprecated', code: `import * as R from 'react'; R.createClass({ render() { return <div/> } });`, expected: true, baselineExpected: false },
  { id: 'react/deprecated-dom-render', suite: 'react/no-deprecated', code: `import * as ReactDOM from 'react-dom'; ReactDOM.render(<p/>, root);`, expected: true },
  { id: 'react/deprecated-dom-import-alias', suite: 'react/no-deprecated', code: `import {render as mount} from 'react-dom'; mount(<p/>, root);`, expected: true },
  { id: 'react/deprecated-server-stream', suite: 'react/no-deprecated', code: `import * as Server from 'react-dom/server'; Server.renderToNodeStream(<p/>);`, expected: true },
  { id: 'react/deprecated-lifecycle-in-component', suite: 'react/no-deprecated', code: `import React from 'react'; class C extends React.Component { componentWillMount() {} render(){ return null } }`, expected: true },
  { id: 'react/deprecated-lifecycle-in-create-class', suite: 'react/no-deprecated', code: `import React from 'react'; React.createClass({ componentWillReceiveProps() {}, render(){ return null } });`, expected: true },
  { id: 'react/non-component-lifecycle-negative', suite: 'react/no-deprecated', code: `class C { componentWillMount() {} }`, expected: false },
  { id: 'react/deprecated-computed-member', suite: 'react/no-deprecated', code: `import React from 'react'; React['createClass']({ render(){ return null } });`, expected: true },
  { id: 'react/deprecated-commonjs-destructure-alias', suite: 'react/no-deprecated', code: `const {createClass: make} = require('react'); make({ render() { return <div/> } });`, expected: true },
  { id: 'react/deprecated-shadowed-namespace-negative', suite: 'react/no-deprecated', code: `import * as R from 'react'; function f(R) { return R.createClass({render(){return null}}) }`, expected: false },
  { id: 'react/deprecated-local-object-negative', suite: 'react/no-deprecated', code: `const R = {createClass(){}}; R.createClass();`, expected: false },
  { id: 'react/deprecated-modern-api-negative', suite: 'react/no-deprecated', code: `import React from 'react'; export const node = React.createElement('div');`, expected: false },
];
function oxlintConfig(test) {
  const rules = {};
  if (test.suite.startsWith('hooks/')) {
    const name = test.suite.slice('hooks/'.length);
    rules['peerless/' + name] = test.options ? ['error', test.options] : 'error';
  } else if (test.suite.startsWith('next/')) {
    rules['peerless/no-location-assign-relative-destination'] = 'warn';
  } else {
    rules['react-legacy/no-deprecated'] = 'error';
    rules['react-namespace/namespace-deprecated'] = 'error';
  }
  return {
    env: { browser: true, node: true },
    jsPlugins: [
      { name: 'peerless', specifier: './peerless-plugin.cjs' },
      { name: 'react-legacy', specifier: './react-legacy-plugin.cjs' },
      { name: 'react-namespace', specifier: './react-namespace-plugin.cjs' },
    ],
    globals: { globalThis: 'readonly' },
    rules,
    settings: { react: { version: '19.3' } },
  };
}
function runOxlint(test, configFile, sourcePath) {
  fs.writeFileSync(configFile, JSON.stringify(oxlintConfig(test)));
  fs.writeFileSync(sourcePath, test.code);
  const run = spawnSync(process.execPath, [cli, '--config', configFile, '--format', 'json', sourcePath], { cwd: root, encoding: 'utf8' });
  let result;
  try {
    result = JSON.parse(run.stdout);
  } catch {
    return { found: false, status: run.status, fatal: [run.stderr || run.stdout.slice(0, 500)] };
  }
  const prefix = test.suite.startsWith('hooks/')
    ? 'peerless(' + test.suite.slice('hooks/'.length) + ')'
    : test.suite.startsWith('next/')
      ? 'peerless(no-location-assign-relative-destination)'
      : null;
  const matching = result.diagnostics.filter((item) => prefix
    ? item.code === prefix
    : ['react-legacy(no-deprecated)', 'react-namespace(namespace-deprecated)'].includes(item.code));
  const pluginErrors = result.diagnostics.filter((item) =>
    item.severity === 'error' && item.message.startsWith('Error running JS plugin.'),
  );
  return {
    found: matching.length > 0 || pluginErrors.length > 0,
    status: run.status,
    fatal: run.stderr ? [run.stderr] : [],
    pluginErrors: pluginErrors.map((item) => item.message),
  };
}
(async () => {
  const output = [];
  const configFile = path.join(root, 'scripts', 'lint', 'parity-test-config.json');
  const sourcePath = path.join(tempDir, 'expanded-parity.jsx');
  try {
    for (const test of cases) {
      const result = runOxlint(test, configFile, sourcePath);
      const pass = result.fatal.length === 0 && result.found === test.expected;
      output.push({ id: test.id, suite: test.suite, expected: test.expected, candidate: result.found, pass, fatal: result.fatal, pluginErrors: result.pluginErrors });
    }
    const failed = output.filter((item) => !item.pass);
    console.log(JSON.stringify({ testCount: cases.length, passed: cases.length - failed.length, failed: failed.length, failures: failed }, null, 2));
    if (failed.length) process.exitCode = 1;
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
    const configFile = path.join(root, 'scripts', 'lint', 'parity-test-config.json');
    if (fs.existsSync(configFile)) fs.rmSync(configFile);
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
