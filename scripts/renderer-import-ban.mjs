import { builtinModules, isBuiltin } from 'node:module';

const topLevelBuiltins = new Set(
  builtinModules
    .filter((name) => !name.startsWith('node:'))
    .map((name) => name.split('/')[0]),
);

export const rendererImportBanMessage =
  'The renderer cannot import Node or Electron main APIs.';

export function isBannedRendererSpecifier(specifier) {
  if (typeof specifier !== 'string' || specifier.length === 0) {
    return false;
  }
  if (specifier === 'electron' || specifier.startsWith('electron/')) {
    return true;
  }
  if (specifier.startsWith('node:')) {
    return true;
  }
  if (isBuiltin(specifier)) {
    return true;
  }
  return topLevelBuiltins.has(specifier.split('/')[0]);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function rendererImportBanRegexSource() {
  const names = [...topLevelBuiltins].map(escapeRegex).sort().join('|');
  return `^(?:node:.+|electron(?:/.*)?|(?:${names})(?:/.*)?)$`;
}

export function rendererRequireSelectors() {
  const body = rendererImportBanRegexSource().replaceAll('/', '\\/');
  const value = `[value=/${body}/]`;
  return [
    `CallExpression[callee.name='require'] > Literal${value}`,
    `TSExternalModuleReference > Literal${value}`,
  ];
}

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

export function bannedSpecifiersIn(source) {
  const stripped = stripComments(source);
  const patterns = [
    /\b(?:import|export)\s+(?:type\s+)?(?:[^'"\n;]*?\sfrom\s+)?['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  const found = new Set();
  for (const pattern of patterns) {
    for (const match of stripped.matchAll(pattern)) {
      const specifier = match[1];
      if (isBannedRendererSpecifier(specifier)) {
        found.add(specifier);
      }
    }
  }
  return [...found];
}
