import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import fs from 'node:fs/promises'
import ts from 'typescript'

const root = process.cwd()
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const target = path.join(root, specifier.slice(2))
    return { url: pathToFileURL(`${target}.ts`).href, shortCircuit: true }
  }
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    const parent = context.parentURL && context.parentURL.startsWith('file:') ? path.dirname(fileURLToPath(context.parentURL)) : root
    const target = path.resolve(parent, specifier)
    if (!path.extname(target)) return { url: pathToFileURL(`${target}.ts`).href, shortCircuit: true }
  }
  return nextResolve(specifier, context)
}

export async function load(url, context, nextLoad) {
  if (url.startsWith('file:') && url.endsWith('.ts')) {
    const source = await fs.readFile(fileURLToPath(url), 'utf8')
    const { outputText, diagnostics = [] } = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022, verbatimModuleSyntax: true },
      fileName: fileURLToPath(url), reportDiagnostics: true,
    })
    const errors = diagnostics.filter(item => item.category === ts.DiagnosticCategory.Error)
    if (errors.length) throw new Error(errors.map(item => ts.flattenDiagnosticMessageText(item.messageText, '\n')).join('\n'))
    return { format: 'module', source: outputText, shortCircuit: true }
  }
  return nextLoad(url, context)
}
