import { readdirSync } from 'node:fs';
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
