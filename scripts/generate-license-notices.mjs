import { copyFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const licensesDir = path.join(root, 'resources', 'licenses');

function readPackageLicense(pkgName) {
  const base = path.join(root, 'node_modules', pkgName);
  const licensePath = existsSync(path.join(base, 'LICENSE'))
    ? path.join(base, 'LICENSE')
    : path.join(base, 'license');
  const pkg = JSON.parse(readFileSync(path.join(base, 'package.json'), 'utf8'));
  return { pkg, text: readFileSync(licensePath, 'utf8') };
}

for (const pkgName of ['yauzl', 'yazl', 'nspell', 'dictionary-en']) {
  const { pkg, text } = readPackageLicense(pkgName);
  writeFileSync(
    path.join(licensesDir, `${pkgName}.txt`),
    `${pkg.name} ${pkg.version}\n\n${text.trim()}\n`,
  );
}

const proPkgs = [
  'prosemirror-model',
  'prosemirror-state',
  'prosemirror-view',
  'prosemirror-commands',
  'prosemirror-history',
  'prosemirror-inputrules',
  'prosemirror-keymap',
  'prosemirror-transform',
];
let prosemirror = 'ProseMirror (packages shipped with Obelisk)\n\n';
for (const pkgName of proPkgs) {
  const { pkg, text } = readPackageLicense(pkgName);
  prosemirror += `${pkgName} ${pkg.version}\n${text.trim()}\n\n`;
}
writeFileSync(path.join(licensesDir, 'prosemirror.txt'), prosemirror);

const react = readPackageLicense('react');
const reactDom = readPackageLicense('react-dom');
writeFileSync(
  path.join(licensesDir, 'react.txt'),
  `react ${react.pkg.version}\nreact-dom ${reactDom.pkg.version}\n\n${react.text.trim()}\n`,
);

const electron = readPackageLicense('electron');
copyFileSync(path.join(root, 'node_modules', 'electron', 'LICENSE'), path.join(licensesDir, 'electron-full.txt'));
writeFileSync(
  path.join(licensesDir, 'electron.txt'),
  `Electron ${electron.pkg.version} (MIT).\n\nChromium and other third-party notices are included in electron-full.txt and in the Electron distribution shipped with this app.\n`,
);

const families = readFileSync(path.join(root, 'src', 'shared', 'fonts', 'manifest.ts'), 'utf8');
const rows = [...families.matchAll(/family: '([^']+)', licenseFile: '([^']+)'/g)];
const bundleLines = [
  'Obelisk bundled fonts (SIL Open Font License 1.1).',
  'Full license text for each family is in assets/fonts alongside the font files.',
  '',
  'Families:',
  ...rows.map((match) => `- ${match[1]} (${match[2]})`),
  '',
  'Font files:',
  ...readdirSync(path.join(root, 'assets', 'fonts'))
    .filter((name) => name.endsWith('.ttf'))
    .sort()
    .map((name) => `- ${name}`),
  '',
];
writeFileSync(path.join(licensesDir, 'bundled-fonts.txt'), `${bundleLines.join('\n')}\n`);

console.log('Wrote resources/licenses notices');