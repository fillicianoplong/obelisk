import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { isInsideDirectory, resolveAppDataDir } from './app-data.js';

function ensureDir(directory: string): void {
  fs.mkdirSync(directory, { recursive: true });
}

// NFR-26: preferences, session, signatures, and recovery copies stay in app
// data. The MSIX install folder is read-only, and a relative write would
// otherwise land in that folder because Windows starts the process there.
export function configureWritablePaths(): string {
  const userData = resolveAppDataDir(
    app.getPath('appData'),
    app.commandLine.getSwitchValue('user-data-dir'),
    process.cwd(),
  );
  const installDir = path.dirname(app.getPath('exe'));
  if (isInsideDirectory(installDir, userData)) {
    throw new Error(`Refusing to use app data inside the install folder (${userData}).`);
  }

  const logsDir = path.join(userData, 'logs');
  const crashDir = path.join(userData, 'crashes');
  const sessionDir = path.join(userData, 'session');
  const cacheDir = path.join(userData, 'cache');
  ensureDir(userData);
  ensureDir(logsDir);
  ensureDir(crashDir);
  ensureDir(sessionDir);
  ensureDir(cacheDir);

  app.setPath('userData', userData);
  app.setPath('sessionData', sessionDir);
  app.setPath('crashDumps', crashDir);
  app.setAppLogsPath(logsDir);
  app.commandLine.appendSwitch('disk-cache-dir', cacheDir);
  process.chdir(userData);
  return userData;
}
