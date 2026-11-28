import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function fail(message) {
  console.error(`check-licenses: ${message}`);
  process.exitCode = 1;
}

const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const appVersionTs = readFileSync(path.join(root, 'src', 'shared', 'app-version.ts'), 'utf8');
const versionMatch = appVersionTs.match(/export const APP_VERSION = '([^']+)'/);
if (versionMatch === null) {
  fail('app-version.ts is missing APP_VERSION.');
} else if (versionMatch[1] !== packageJson.version) {
  fail(`APP_VERSION (${versionMatch[1]}) does not match package.json (${packageJson.version}).`);
}

const licenseManifest = JSON.parse(
  readFileSync(path.join(root, 'resources', 'licenses', 'manifest.json'), 'utf8'),
);
for (const component of licenseManifest.components) {
  const noticePath = path.join(root, 'resources', 'licenses', component.noticeFile);
  try {
    statSync(noticePath);
  } catch {
    fail(`missing notice ${component.noticeFile} for ${component.name}.`);
    continue;
  }
  const notice = readFileSync(noticePath, 'utf8');
  if (notice.trim().length < 40) {
    fail(`notice ${component.noticeFile} is too short.`);
  }
  if (component.npmPackage !== undefined) {
    const pkgPath = path.join(root, 'node_modules', component.npmPackage, 'package.json');
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      if (typeof pkg.version !== 'string') {
        fail(`${component.npmPackage} has no version in package.json.`);
      } else if (!notice.includes(pkg.version)) {
        fail(`notice ${component.noticeFile} does not mention ${component.npmPackage}@${pkg.version}.`);
      }
    } catch {
      fail(`dependency ${component.npmPackage} is not installed.`);
    }
  }
  if (component.fullTextFile !== undefined) {
    const fullPath = path.join(root, 'resources', 'licenses', component.fullTextFile);
    try {
      statSync(fullPath);
    } catch {
      fail(`missing full license ${component.fullTextFile} for ${component.name}.`);
    }
  }
}

const fontManifest = JSON.parse(readFileSync(path.join(root, 'assets', 'fonts', 'manifest.json'), 'utf8'));
const fontsDir = path.join(root, 'assets', 'fonts');
const fontFiles = readdirSync(fontsDir).filter((name) => name.endsWith('.ttf'));
const licenseFiles = readdirSync(fontsDir).filter((name) => name.endsWith('.txt'));
if (fontFiles.length !== fontManifest.faces.length) {
  fail(`assets/fonts has ${fontFiles.length} .ttf files but manifest lists ${fontManifest.faces.length} faces.`);
}
for (const face of fontManifest.faces) {
  const full = path.join(fontsDir, face.file);
  try {
    statSync(full);
  } catch {
    fail(`missing font file ${face.file}.`);
  }
}
if (licenseFiles.length === 0) {
  fail('assets/fonts has no license .txt files.');
}
for (const license of licenseFiles) {
  const text = readFileSync(path.join(fontsDir, license), 'utf8');
  if (!/Open Font License|SIL\s+Open Font/i.test(text)) {
    fail(`${license} does not look like an OFL license.`);
  }
}

const familiesTs = readFileSync(path.join(root, 'src', 'shared', 'fonts', 'manifest.ts'), 'utf8');
if (/DejaVu/i.test(familiesTs)) {
  fail('DejaVu must not be bundled.');
}

const msixPlan = readFileSync(path.join(root, 'scripts', 'msix-plan.mjs'), 'utf8');
if (!msixPlan.includes('readBundledFontFileNames')) {
  fail('msix-plan.mjs must list bundled fonts for packaging.');
}

const noticesTs = readFileSync(path.join(root, 'src', 'renderer', 'shell', 'about', 'notices.ts'), 'utf8');
if (!noticesTs.includes('Generated from resources/licenses/manifest.json')) {
  fail('about/notices.ts is stale; run scripts/generate-about-notices.mjs.');
}
const manifestIds = licenseManifest.components.map((row) => row.id).sort();
const noticeIds = [...noticesTs.matchAll(/id: '([^']+)'/g)].map((match) => match[1]).sort();
if (JSON.stringify(manifestIds) !== JSON.stringify(noticeIds)) {
  fail(`about notices (${noticeIds.join(', ')}) do not match manifest (${manifestIds.join(', ')}).`);
}

for (const row of familiesTs.matchAll(/family: '([^']+)', licenseFile: '([^']+)'/g)) {
  const licensePath = path.join(fontsDir, row[2]);
  try {
    const text = readFileSync(licensePath, 'utf8');
    if (!/Open Font License|SIL\s+Open Font/i.test(text)) {
      fail(`license ${row[2]} for ${row[1]} is not OFL.`);
    }
  } catch {
    fail(`missing license ${row[2]} for bundled family ${row[1]}.`);
  }
}

if (process.exitCode === undefined || process.exitCode === 0) {
  console.log('check-licenses: ok');
}