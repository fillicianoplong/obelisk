import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

// Electron 45 has no postinstall. Importing the electron package downloads the
// binary on first use. The test runner starts files in parallel, so two of
// those imports extract the same executable at once and Windows fails the
// spawn with EBUSY. Install and check the binary once here, and do not import
// the electron package from a test file.

export function electronPackageRoot(root) {
  return path.join(root, 'node_modules', 'electron');
}

export function missingElectronBinaryMessage(detail) {
  const why =
    'Electron 45 has no postinstall, so npm ci does not download it. ' +
    'The test runner runs node node_modules/electron/install.js once before any Electron test.';
  const lead = 'The Electron binary is missing.';
  return detail ? `${lead} ${detail} ${why}` : `${lead} ${why}`;
}

export function readElectronExecutablePath(root) {
  const pathFile = path.join(electronPackageRoot(root), 'path.txt');
  let relative;
  try {
    relative = readFileSync(pathFile, 'utf8').trim();
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
  if (!relative) {
    return null;
  }
  return path.join(electronPackageRoot(root), 'dist', relative);
}

export function existingElectronBinary(root) {
  const binary = readElectronExecutablePath(root);
  if (!binary) {
    return null;
  }
  try {
    if (!statSync(binary).isFile()) {
      return null;
    }
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
  return binary;
}

export function ensureElectronBinary(root) {
  const installScript = path.join(electronPackageRoot(root), 'install.js');
  let installStat;
  try {
    installStat = statSync(installScript);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(
        missingElectronBinaryMessage(
          'node_modules/electron/install.js is not in this install, so the binary cannot be downloaded.',
        ),
        { cause: error },
      );
    }
    throw error;
  }
  if (!installStat.isFile()) {
    throw new Error(
      missingElectronBinaryMessage(
        'node_modules/electron/install.js is not in this install, so the binary cannot be downloaded.',
      ),
    );
  }

  const result = spawnSync(process.execPath, [installScript], {
    cwd: root,
    stdio: 'inherit',
  });
  if (result.error) {
    throw new Error(
      missingElectronBinaryMessage(
        `Failed to run node node_modules/electron/install.js: ${result.error.message}`,
      ),
    );
  }
  if (result.signal) {
    throw new Error(
      missingElectronBinaryMessage(
        `node node_modules/electron/install.js was killed by ${result.signal}.`,
      ),
    );
  }
  if (result.status !== 0) {
    throw new Error(
      missingElectronBinaryMessage(
        `node node_modules/electron/install.js exited ${result.status ?? 1}.`,
      ),
    );
  }

  const binary = existingElectronBinary(root);
  if (!binary) {
    throw new Error(
      missingElectronBinaryMessage(
        'node node_modules/electron/install.js finished without writing the executable named in node_modules/electron/path.txt.',
      ),
    );
  }
  return binary;
}
