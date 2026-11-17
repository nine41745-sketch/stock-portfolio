import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import ts from 'typescript'
import React from 'react'
import { renderToString } from 'react-dom/server'
import * as safety from '../lib/supabase/runtime-safety.mjs'

const require = createRequire(import.meta.url)
const root = fileURLToPath(new URL('../', import.meta.url))
const config = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile)
const options = ts.parseJsonConfigFileContent(config.config, ts.sys, root).options
const activeHost = 'portfolio.example.test'
const deploymentHost = 'portfolio-build-123.vercel.app'
const productionRef = 'synthetic-production-ref'
const previewRef = 'synthetic-preview-ref'

function fixture({ mode = 'production', host, syntheticPreview = false } = {}) {
  const cache = new Map()
  const calls = { sdkFactories: 0, network: 0 }
  const env = {
    NEXT_PUBLIC_VERCEL_ENV: mode,
    NEXT_PUBLIC_VERCEL_URL: deploymentHost,
    NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL: activeHost,
    NEXT_PUBLIC_SUPABASE_URL: `https://${syntheticPreview ? previewRef : productionRef}.supabase.co`,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'synthetic-placeholder',
    ...(syntheticPreview ? {
      NEXT_PUBLIC_SUPABASE_PREVIEW_PROJECT_REF: previewRef,
      NEXT_PUBLIC_SUPABASE_PRODUCTION_PROJECT_REF: productionRef,
    } : {}),
  }
  function load(file) {
    file = path.resolve(root, file)
    if (cache.has(file)) return cache.get(file).exports
    const loadedModule = { exports: {} }
    cache.set(file, loadedModule)
    const output = ts.transpileModule(readFileSync(file, 'utf8'), {
      fileName: file,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText
    const context = {
      module: loadedModule, exports: loadedModule.exports, process: { env }, console, URL, Headers,
      fetch() { calls.network++; throw new Error('Network is forbidden in synthetic SSR tests') },
      require(name) {
        if (name === '@/lib/supabase/runtime-safety.mjs') return safety
        if (name === '@supabase/ssr') return { createBrowserClient() { calls.sdkFactories++; return { auth: {} } } }
        if (name === 'next/navigation') return { useRouter: () => ({ push() {}, refresh() {} }) }
        if (name.startsWith('@/') || name.startsWith('.')) {
          const resolved = ts.resolveModuleName(name, file, options, ts.sys).resolvedModule
          assert.ok(resolved, `Local import must resolve: ${name}`)
          return load(resolved.resolvedFileName)
        }
        return require(name)
      },
    }
    if (host) context.window = { location: { host } }
    vm.runInNewContext(output, context, { filename: file })
    return loadedModule.exports
  }
  return { load, calls }
}

for (const mode of ['production', 'preview']) {
  for (const [file, props] of [
    ['components/auth/LoginForm.tsx', {}],
    ['components/auth/PinGate.tsx', { userEmail: 'synthetic@example.test' }],
    ['components/portfolio/PortfolioDashboard.tsx', { holdings: [] }],
  ]) {
    test(`${mode} SSR renders ${file} without creating a browser client or accessing Auth/DB`, () => {
      const { load, calls } = fixture({ mode })
      const Component = load(file).default
      const html = renderToString(React.createElement(Component, props))
      assert.ok(html.length > 0)
      assert.equal(calls.sdkFactories, 0, 'Browser SDK initialization must be deferred until a browser action')
      assert.equal(calls.network, 0)
    })
  }
}

for (const entry of [
  { name: 'Active Production browser', options: { host: activeHost }, allowed: true },
  { name: 'Staged Production browser', options: { host: deploymentHost }, allowed: false },
  { name: 'Preview without isolation', options: { mode: 'preview', host: deploymentHost }, allowed: false },
  { name: 'Preview with isolated synthetic target', options: { mode: 'preview', host: deploymentHost, syntheticPreview: true }, allowed: true },
  { name: 'Unknown Vercel environment', options: { mode: 'unknown', host: activeHost }, allowed: false },
  { name: 'Direct Production factory call without a request host', options: {}, allowed: false },
]) {
  test(`${entry.name} retains its Supabase guard decision before SDK initialization`, () => {
    const { load, calls } = fixture(entry.options)
    const { createClient } = load('lib/supabase/client.ts')
    if (entry.allowed) assert.doesNotThrow(() => createClient())
    else assert.throws(() => createClient(), /not isolated/)
    assert.equal(calls.sdkFactories, entry.allowed ? 1 : 0)
    assert.equal(calls.network, 0)
  })
}
