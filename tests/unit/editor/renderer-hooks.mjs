import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

export async function load(url, context, nextLoad) {
  if (!url.endsWith('.tsx')) {
    return nextLoad(url, context);
  }
  const source = readFileSync(fileURLToPath(url), 'utf8');
  const result = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2024,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.ReactJSX,
      verbatimModuleSyntax: false,
    },
    fileName: fileURLToPath(url),
  });
  return {
    format: 'module',
    source: result.outputText,
    shortCircuit: true,
  };
}

export async function resolve(specifier, context, nextResolve) {
  const parent = context.parentURL ?? '';
  const fromRenderer = parent.includes('/src/renderer/');
  if (
    fromRenderer
    && (specifier.startsWith('./') || specifier.startsWith('../'))
    && specifier.endsWith('.js')
  ) {
    const stem = specifier.slice(0, -3);
    try {
      return await nextResolve(`${stem}.ts`, context);
    } catch {
      return nextResolve(`${stem}.tsx`, context);
    }
  }
  return nextResolve(specifier, context);
}
