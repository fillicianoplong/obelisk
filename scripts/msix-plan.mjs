import { readdirSync } from 'node:fs';
import { readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const MSIX_PACKAGE_NAME = 'Obelisk.Dev';

export const MSIX_PUBLISHER = 'CN=Obelisk Dev';

export const MSIX_EXECUTABLE = 'Obelisk.exe';

export const MSIX_PACKAGE_FILE = 'Obelisk-Dev.msix';

export const MSIX_CERTIFICATE_FILE = 'obelisk-dev.cer';

export const DEV_CERT_INF_FILE = 'obelisk-dev.inf';

export const STALE_PACKAGE_FILES = [MSIX_PACKAGE_FILE, MSIX_CERTIFICATE_FILE, DEV_CERT_INF_FILE];

export const MSIX_APP_ID = 'Obelisk';

// These files are for the working tree. The running app needs package.json,
// the built dist files, and nothing else from the repository root.
export const DEV_PACKAGE_FILES = [
  '.npmrc',
  '.gitignore',
  'README.md',
  'tsconfig.base.json',
  'tsconfig.build.json',
  'tsconfig.renderer.json',
  'tsconfig.node.json',
  'vite.config.mts',
  'vite.preload.config.mts',
  'eslint.config.mjs',
];

export const MSIX_ASSETS = {
  'assets\\StoreLogo.png': { width: 50, height: 50 },
  'assets\\Square44x44Logo.png': { width: 44, height: 44 },
  'assets\\Square150x150Logo.png': { width: 150, height: 150 },
  'assets\\Wide310x150Logo.png': { width: 310, height: 150 },
  'assets\\Square310x310Logo.png': { width: 310, height: 310 },
  'assets\\SplashScreen.png': { width: 620, height: 300 },
};

// The manifest names the scale-100 file. Windows picks scale-200 and the
// altform target sizes from resources.pri.
//
// A packaged app's taskbar (running and pinned) uses Square44x44Logo from
// this index, not the window icon. An unqualified targetsize file is the
// plated tile, and the shell selects it for the taskbar when it is present.
// unplated and lightunplated are the same tile, so both Windows
// modes show that full tile. The sizes cover the Windows 11 taskbar slots
// (24 at 100%, 30 at 125%, 36 at 150%, 48 at 200%, and the rest of the list).
export const SQUARE44_UNPLATED_SIZES = [16, 20, 24, 30, 32, 36, 40, 48, 60, 64, 72, 80, 96, 256];

// Title bar and Explorer icon frames. Each one is drawn at that size.
// BMP below 256, PNG at 256. 16 px is the 100% title bar, 20 is 125%, 24 is 150%.
export const WINDOW_ICON_SIZES = [16, 20, 24, 32, 40, 48, 64, 256];

export const PRI_CONFIG_FILE = 'priconfig.xml';

export const PRI_RESOURCE_FILE = 'resources.pri';

export const APP_ICON_RELATIVE = path.join('packaging', 'icons', 'obelisk.ico');

export const APP_ICON_PNG = path.join('packaging', 'icons', 'obelisk-256.png');

export const APP_ICON_SIZES = WINDOW_ICON_SIZES;

// makepri's folder indexer would otherwise pick up the Electron runtime.
// The manifest logos live under assets\. These excludes keep the index there
// while startIndexAt stays the layout root, so the resource name keeps assets\.
export const PRI_INDEX_EXCLUDES = [
  ['path', 'locales'],
  ['path', 'resources'],
  ['path', 'LICENSE'],
  ['path', 'version'],
  ['extension', '.exe'],
  ['extension', '.dll'],
  ['extension', '.pak'],
  ['extension', '.bin'],
  ['extension', '.dat'],
  ['extension', '.json'],
  ['extension', '.html'],
  ['extension', '.js'],
  ['extension', '.css'],
  ['extension', '.xml'],
  ['extension', '.node'],
  ['extension', '.asar'],
  ['extension', '.txt'],
  ['extension', '.ico'],
];

function scale200Name(assetPath) {
  const file = assetPath.slice(assetPath.lastIndexOf('\\') + 1);
  const stem = file.slice(0, -'.png'.length);
  return `assets\\${stem}.scale-200.png`;
}

function withQualifiedAssets(base) {
  const assets = { ...base };
  for (const [name, size] of Object.entries(base)) {
    assets[scale200Name(name)] = { width: size.width * 2, height: size.height * 2 };
  }
  for (const target of SQUARE44_UNPLATED_SIZES) {
    assets[`assets\\Square44x44Logo.targetsize-${target}_altform-unplated.png`] = {
      width: target,
      height: target,
    };
    assets[`assets\\Square44x44Logo.targetsize-${target}_altform-lightunplated.png`] = {
      width: target,
      height: target,
    };
  }
  return assets;
}

export const MSIX_PACKAGE_ASSETS = withQualifiedAssets(MSIX_ASSETS);

// makepri indexes scale-200, targetsize, and altform names. priconfig.xml is
// removed afterwards so makeappx does not pack it. /pr is the package layout
// root and startIndexAt stays that root. The manifest paths are assets\....png,
// so the resource names have to be Files/assets/....png. Indexing from the
// assets folder drops that prefix and Windows falls back to the loose tile.
// The resource-pack split is removed so one resources.pri holds every variant.
export function resourceIndexPlan(layout) {
  const configPath = path.join(layout, PRI_CONFIG_FILE);
  const outputPath = path.join(layout, PRI_RESOURCE_FILE);
  return {
    configPath,
    outputPath,
    createConfig: ['createconfig', '/cf', configPath, '/dq', 'en-US', '/pv', '10.0.0', '/o'],
    createIndex: [
      'new',
      '/pr',
      layout,
      '/cf',
      configPath,
      '/mn',
      path.join(layout, 'AppxManifest.xml'),
      '/of',
      outputPath,
      '/o',
    ],
  };
}

function decodePriConfig(buffer) {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return { text: buffer.toString('utf16le', 2), encoding: 'utf16le' };
  }
  return { text: buffer.toString('utf8').replace(/^\uFEFF/, ''), encoding: 'utf8' };
}

function encodePriConfig(text, encoding) {
  if (encoding === 'utf16le') {
    return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
  }
  return Buffer.from(text, 'utf8');
}

function excludeElement(kind, value) {
  return `<exclude type="${kind}" value="${value}" doNotTraverse="true" doNotIndex="true"/>`;
}

function ensureIndexerExcludes(text) {
  const excludes = PRI_INDEX_EXCLUDES.map(([kind, value]) => excludeElement(kind, value)).join('');
  const selfClosing = /<indexer-config\b[^>]*\btype="folder"[^>]*\/>/;
  if (selfClosing.test(text)) {
    return text.replace(selfClosing, (tag) => `${tag.slice(0, -2)}>${excludes}</indexer-config>`);
  }
  const open = /<indexer-config\b[^>]*\btype="folder"[^>]*>/;
  if (open.test(text)) {
    return text.replace(open, (tag) => `${tag}${excludes}`);
  }
  if (!text.includes('</index>')) {
    throw new Error('makepri createconfig did not write an index element.');
  }
  const block = `<indexer-config type="folder" foldernameAsQualifier="true" filenameAsQualifier="true" qualifierDelimiter=".">${excludes}</indexer-config>`;
  return text.replace('</index>', `${block}</index>`);
}

export function preparePriConfigText(text) {
  if (!/startIndexAt="[^"]*"/.test(text)) {
    throw new Error('makepri createconfig did not write startIndexAt.');
  }
  const rooted = text
    .replace(/startIndexAt="[^"]*"/, 'startIndexAt="\\"')
    .replace(/<packaging>[\s\S]*?<\/packaging>\s*/, '');
  const prepared = ensureIndexerExcludes(rooted);
  if (!/startIndexAt="\\"/.test(prepared)) {
    throw new Error('makepri config is not indexed from the layout root.');
  }
  if (/startIndexAt="assets"/.test(prepared)) {
    throw new Error('makepri config still indexes from the assets folder.');
  }
  if (!/foldernameAsQualifier="true"/.test(prepared) || !/filenameAsQualifier="true"/.test(prepared)) {
    throw new Error('makepri config must keep folder and file qualifiers.');
  }
  return prepared;
}

async function preparePriConfig(configPath) {
  const decoded = decodePriConfig(await readFile(configPath));
  const prepared = preparePriConfigText(decoded.text);
  await writeFile(configPath, encodePriConfig(prepared, decoded.encoding));
}

export function priResourceUri(manifestPath) {
  return `Files/${String(manifestPath).replace(/\\/g, '/')}`;
}

export function assertPriDumpMatchesManifest(dump, manifestXml) {
  // makepri's name attribute is the file name. The path Windows looks up is
  // the uri, and that has to be Files/assets/... to match the manifest.
  if (/\/Files\/Square44x44Logo\.png"/.test(dump)) {
    throw new Error('resources.pri names Square44x44Logo.png without the assets folder.');
  }
  const uris = manifestAssetPaths(manifestXml).map((asset) => priResourceUri(asset));
  const missing = uris.filter((uri) => !dump.includes(uri));
  if (missing.length > 0) {
    throw new Error(`resources.pri is missing manifest logo resources: ${missing.join(', ')}.`);
  }
  const marker = 'Files/assets/Square44x44Logo.png';
  const at = dump.indexOf(marker);
  if (at < 0) {
    throw new Error('resources.pri has no Files/assets/Square44x44Logo.png resource.');
  }
  const next = dump.indexOf('<NamedResource', at + marker.length);
  const block = dump.slice(at, next === -1 ? undefined : next);
  if (!/[^A-Za-z]unplated/i.test(block)) {
    throw new Error('Files/assets/Square44x44Logo.png has no altform-unplated candidate.');
  }
  if (!/lightunplated/i.test(block)) {
    throw new Error('Files/assets/Square44x44Logo.png has no altform-lightunplated candidate.');
  }
}

function decodePriDump(buffer) {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.toString('utf16le', 2);
  }
  return buffer.toString('utf8').replace(/^\uFEFF/, '');
}

export async function dumpResourceIndex(makepri, layout, run) {
  const priPath = path.join(layout, PRI_RESOURCE_FILE);
  const dumpPath = path.join(layout, 'resources.pri.xml');
  try {
    run(makepri, ['dump', '/if', priPath, '/of', dumpPath, '/dt', 'detailed', '/o']);
    const dump = decodePriDump(await readFile(dumpPath));
    console.log('resources.pri NamedResource:');
    for (const match of dump.matchAll(/<NamedResource\b[^>]*>/g)) {
      console.log(match[0]);
    }
    return dump;
  } finally {
    await rm(dumpPath, { force: true });
  }
}

export async function buildResourceIndex(makepri, layout, run) {
  const plan = resourceIndexPlan(layout);
  console.log(`makepri ${JSON.stringify([makepri, ...plan.createIndex])}`);
  try {
    run(makepri, plan.createConfig);
    await preparePriConfig(plan.configPath);
    run(makepri, plan.createIndex);
  } finally {
    await rm(plan.configPath, { force: true });
  }
  let info;
  try {
    info = await stat(plan.outputPath);
  } catch {
    info = null;
  }
  if (!info?.isFile() || info.size === 0) {
    throw new Error('makepri did not write resources.pri.');
  }
  const extras = (await readdir(layout)).filter((name) => name.endsWith('.pri') && name !== PRI_RESOURCE_FILE);
  if (extras.length > 0) {
    throw new Error(`makepri wrote extra resource indexes: ${extras.join(', ')}.`);
  }
}

function fileNamePattern(name) {
  return new RegExp(`[\\\\/]${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
}

export const PACKAGER_IGNORE = [
  /[\\/]\.github([\\/]|$)/,
  /[\\/]coverage([\\/]|$)/,
  /[\\/]dist[\\/]msix([\\/]|$)/,
  /[\\/]dist[\\/]packaged([\\/]|$)/,
  /[\\/]docs([\\/]|$)/,
  /[\\/]node_modules([\\/]|$)/,
  /[\\/]packaging([\\/]|$)/,
  /[\\/]scripts([\\/]|$)/,
  /[\\/]src([\\/]|$)/,
  /[\\/]tests([\\/]|$)/,
  ...DEV_PACKAGE_FILES.map(fileNamePattern),
  // Source maps are not loaded at runtime. The dev package ships the built
  // JavaScript only.
  /\.(?:js|mjs|css)\.map$/,
];

export function isDevPackageFile(fileName) {
  return DEV_PACKAGE_FILES.includes(fileName) || /\.(?:js|mjs|css)\.map$/.test(fileName);
}

export function filesInDirectory(directory) {
  const found = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (entry.isFile()) {
        found.push(path.relative(directory, full));
      }
    }
  };
  walk(directory);
  return found.sort();
}

export function devFilesInDirectory(directory) {
  return filesInDirectory(directory).filter((relative) => isDevPackageFile(path.basename(relative)));
}

export function assertNoDevPackageFiles(directory) {
  const found = devFilesInDirectory(directory);
  if (found.length > 0) {
    throw new Error(`The packaged app contains dev files: ${found.join(', ')}.`);
  }
}

export function ignoredByPackager(candidate) {
  return PACKAGER_IGNORE.some((pattern) => pattern.test(candidate));
}

export function stalePackagePaths(directory) {
  return STALE_PACKAGE_FILES.map((name) => path.join(directory, name));
}

// Reuse the current-user code-signing cert when it is still valid. A missing
// private key, a different subject, or an expiry at or before `now` means create.
export function chooseDevCertificate(certs, now) {
  const moment = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const valid = (certs ?? []).filter((cert) => {
    if (cert.subject !== MSIX_PUBLISHER || !cert.codeSigning || !cert.hasPrivateKey) {
      return false;
    }
    if (!/^[0-9A-Fa-f]{40}$/.test(String(cert.thumbprint ?? ''))) {
      return false;
    }
    const expires = new Date(cert.notAfter).getTime();
    return Number.isFinite(expires) && expires > moment;
  });
  valid.sort((left, right) => {
    const byExpiry = new Date(right.notAfter).getTime() - new Date(left.notAfter).getTime();
    if (byExpiry !== 0) {
      return byExpiry;
    }
    const leftThumb = String(left.thumbprint).toUpperCase();
    const rightThumb = String(right.thumbprint).toUpperCase();
    if (rightThumb > leftThumb) {
      return 1;
    }
    if (rightThumb < leftThumb) {
      return -1;
    }
    return 0;
  });
  return valid[0] ?? null;
}

export function toAppxVersion(version) {
  const parts = version.split('.');
  if (parts.length === 3) {
    parts.push('0');
  }
  if (parts.length !== 4 || parts.some((part) => !/^(0|[1-9]\d{0,4})$/.test(part))) {
    throw new Error(`Package version ${version} is not an Appx version (four numbers, each 0-65535).`);
  }
  for (const part of parts) {
    if (Number(part) > 65535) {
      throw new Error(`Appx version part ${part} is above 65535.`);
    }
  }
  return parts.join('.');
}

function attributes(text) {
  const found = {};
  for (const match of text.matchAll(/([A-Za-z0-9:]+)="([^"]*)"/g)) {
    found[match[1]] = match[2];
  }
  return found;
}

export function identityAttributes(xml) {
  const match = xml.match(/<Identity\b([^>]*)\/?>/);
  if (!match) {
    throw new Error('AppxManifest.xml has no Identity element.');
  }
  return attributes(match[1]);
}

export function applicationAttributes(xml) {
  const match = xml.match(/<Application\b([^>]*)>/);
  if (!match) {
    throw new Error('AppxManifest.xml has no Application element.');
  }
  return attributes(match[1]);
}

export function manifestAssetPaths(xml) {
  const fromAttributes = [...xml.matchAll(/(?:Logo|Image)="([^"]+)"/g)].map((match) => match[1]);
  const fromElements = [...xml.matchAll(/<(?:[A-Za-z0-9]+:)?Logo>([^<]+)<\/(?:[A-Za-z0-9]+:)?Logo>/g)].map(
    (match) => match[1].trim(),
  );
  return [...new Set([...fromAttributes, ...fromElements])];
}

export function withAppxVersion(xml, packageVersion) {
  const version = toAppxVersion(packageVersion);
  if (!/<Identity\b[^>]*\bVersion="[^"]+"/.test(xml)) {
    throw new Error('AppxManifest.xml Identity has no Version attribute.');
  }
  return xml.replace(/(<Identity\b[^>]*\bVersion=")[^"]+(")/, `$1${version}$2`);
}

export function assertDevManifest(xml) {
  const identity = identityAttributes(xml);
  const application = applicationAttributes(xml);
  if (identity.Name !== MSIX_PACKAGE_NAME) {
    throw new Error(`MSIX identity name is ${identity.Name ?? 'missing'}.`);
  }
  if (identity.Publisher !== MSIX_PUBLISHER) {
    throw new Error(`MSIX publisher is ${identity.Publisher ?? 'missing'}.`);
  }
  if (identity.ProcessorArchitecture !== 'x64') {
    throw new Error('The dev MSIX must be x64.');
  }
  if (application.Executable !== MSIX_EXECUTABLE) {
    throw new Error(`MSIX executable is ${application.Executable ?? 'missing'}.`);
  }
  if (application.Id !== MSIX_APP_ID) {
    throw new Error(`MSIX app id is ${application.Id ?? 'missing'}. The Start-menu id is ${MSIX_APP_ID}.`);
  }
  if (application.EntryPoint !== 'Windows.FullTrustApplication') {
    throw new Error('The dev MSIX must be a full-trust desktop app.');
  }
  if (!xml.includes('Category="windows.fileTypeAssociation"') || !xml.includes('<uap:FileType>.obk</uap:FileType>')) {
    throw new Error('The dev MSIX does not associate .obk files.');
  }
  if (!xml.includes('Name="runFullTrust"')) {
    throw new Error('The dev MSIX does not declare runFullTrust.');
  }
  if (/requireAdministrator/i.test(xml)) {
    throw new Error('The dev MSIX must not request administrator rights.');
  }
  const assets = manifestAssetPaths(xml);
  const expected = Object.keys(MSIX_ASSETS);
  const missing = expected.filter((file) => !assets.includes(file));
  const extra = assets.filter((file) => !expected.includes(file));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(`MSIX asset list does not match the manifest. Missing: ${missing.join(', ') || 'none'}. Extra: ${extra.join(', ') || 'none'}.`);
  }
  return identity;
}
