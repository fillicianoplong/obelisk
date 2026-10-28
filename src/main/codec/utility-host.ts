import path from 'node:path';
import { app, utilityProcess, type UtilityProcess } from 'electron';
import type { DecodeResult } from './decode.js';

// FormatCodec runs here, not in the renderer and not on the main thread's
// inflate. Spike S-08: Electron 45 does not OS-sandbox this process. The
// checks are the defence. serviceName matches that spike.

const SERVICE_NAME = 'obk-decode';
const CHECK_TIMEOUT_MS = 120_000;

function childEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') {
      env[key] = value;
    }
  }
  env.NODE_PATH = path.resolve(__dirname, '../../..', 'node_modules');
  return env;
}

interface ArchiveResponse {
  id: number;
  result: DecodeResult;
}

function isResponse(value: unknown): value is ArchiveResponse {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as { id?: unknown; result?: unknown };
  return typeof record.id === 'number' && typeof record.result === 'object' && record.result !== null;
}

export function readInUtilityProcess(filePath: string): Promise<DecodeResult> {
  return new Promise((resolve, reject) => {
    let child: UtilityProcess;
    try {
      child = utilityProcess.fork(path.join(__dirname, 'utility-child.js'), [], {
        serviceName: SERVICE_NAME,
        stdio: 'pipe',
        env: childEnv(),
      });
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    let settled = false;
    const id = 1;
    const timer = setTimeout(() => {
      finish(() => {
        reject(new Error('The file check did not finish.'));
      });
    }, CHECK_TIMEOUT_MS);

    function finish(done: () => void): void {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      child.kill();
      done();
    }

    child.once('spawn', () => {
      child.postMessage({ id, filePath });
    });
    child.on('message', (message: unknown) => {
      if (!isResponse(message) || message.id !== id) {
        finish(() => {
          reject(new Error('The file check returned a response this request did not ask for.'));
        });
        return;
      }
      finish(() => {
        resolve(message.result);
      });
    });
    child.once('exit', (code) => {
      finish(() => {
        reject(new Error(`The file check stopped (${code ?? 'no code'}).`));
      });
    });
  });
}

// Launching this file under Electron, with --archive <path>, runs the check
// in the utility process and prints one result line. The app window does not open.
function requestedArchive(): string | null {
  const index = process.argv.indexOf('--archive');
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value || value.startsWith('-')) {
    return null;
  }
  return value;
}

const archiveFile = requestedArchive();
if (archiveFile) {
  const filePath = archiveFile;
  app.whenReady().then(() => {
    readInUtilityProcess(filePath).then((result) => {
      process.stdout.write(`OBELISK_ARCHIVE_RESULT ${JSON.stringify(result)}\n`, () => {
        app.exit(0);
      });
    }).catch((error: unknown) => {
      console.error(error instanceof Error ? error.stack ?? error.message : String(error));
      app.exit(1);
    });
  }).catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    app.exit(1);
  });
}
