import { app, BrowserWindow, ipcMain, type WebContents } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

interface Metric {
  pid: number;
  type: string;
  serviceName: string | null;
  name: string | null;
  sandboxed: boolean | null;
  integrityLevel: string | null;
}

const preferences = {
  preload: '',
  contextIsolation: true,
  nodeIntegration: false,
  nodeIntegrationInWorker: false,
  nodeIntegrationInSubFrames: false,
  sandbox: true,
  webviewTag: false,
  webSecurity: true,
  backgroundThrottling: false,
};

function flag(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) {
    throw new Error(`missing ${name}`);
  }
  return value;
}

function linuxFile(pid: number, name: string): string | null {
  if (process.platform !== 'linux') {
    return null;
  }
  try {
    return fs.readFileSync(`/proc/${pid}/${name}`, 'utf8');
  } catch {
    return null;
  }
}

function metrics(): Metric[] {
  return app.getAppMetrics().map((metric) => ({
    pid: metric.pid,
    type: metric.type,
    serviceName: metric.serviceName ?? null,
    name: metric.name ?? null,
    sandboxed: typeof metric.sandboxed === 'boolean' ? metric.sandboxed : null,
    integrityLevel: metric.integrityLevel ?? null,
  }));
}

void app.whenReady().then(() => {
  const jobs = JSON.parse(fs.readFileSync(flag('--jobs'), 'utf8')) as { jobs: unknown[] };
  const reportPath = flag('--report');
  const html = path.join(__dirname, 'page.html');
  preferences.preload = path.join(__dirname, 'preload.js');
  let cursor = 0;
  const results: unknown[] = [];
  let pageProbe: unknown = null;
  let preloadProbe: unknown = null;
  let finished = false;

  const write = (error: string | null, code: number): void => {
    if (finished) {
      return;
    }
    finished = true;
    const rendererPid = window?.webContents.getOSProcessId() ?? null;
    const status = rendererPid === null ? null : linuxFile(rendererPid, 'status');
    const command = rendererPid === null ? null : linuxFile(rendererPid, 'cmdline');
    const report = {
      error,
      argv: process.argv,
      execArgv: process.execArgv,
      noSandboxFlag: process.argv.includes('--no-sandbox'),
      electron: process.versions.electron ?? null,
      chrome: process.versions.chrome ?? null,
      node: process.versions.node ?? null,
      platform: process.platform,
      osRelease: os.release(),
      osVersion: os.version(),
      preferences,
      pageProbe,
      preloadProbe,
      metrics: metrics(),
      rendererPid,
      rendererStatus: status,
      rendererCommand: command ? command.split('\0').filter((part) => part.length > 0) : null,
      results,
    };
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    app.exit(code);
  };

  ipcMain.handle('spike:next', () => {
    if (cursor >= jobs.jobs.length) {
      return null;
    }
    const job = jobs.jobs[cursor];
    cursor += 1;
    return job;
  });
  ipcMain.handle('spike:result', (_event, result: unknown) => {
    results.push(result);
    return true;
  });
  ipcMain.handle('spike:done', (_event, payload: { pageProbe?: unknown; preloadProbe?: unknown }) => {
    pageProbe = payload.pageProbe ?? null;
    preloadProbe = payload.preloadProbe ?? null;
    write(null, 0);
    return true;
  });

  const window = new BrowserWindow({
    show: false,
    width: 480,
    height: 360,
    webPreferences: preferences,
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => {
    event.preventDefault();
  });
  window.webContents.on('console-message', (details, _level, message) => {
    const text = typeof message === 'string' && message.length > 0 ? message : details.message;
    console.log(`renderer ${text}`);
  });
  window.webContents.on('render-process-gone', (_event, details) => {
    write(`renderer gone: ${details.reason}`, 1);
  });
  window.webContents.on('did-fail-load', (_event, code, description) => {
    write(`load failed: ${code} ${description}`, 1);
  });
  const contents: WebContents = window.webContents;
  void contents.loadFile(html).catch((error: unknown) => {
    write(error instanceof Error ? error.message : String(error), 1);
  });
  setTimeout(() => {
    write('timed out', 1);
  }, 8 * 60 * 1000);
});
