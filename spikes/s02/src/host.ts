import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  protocol,
  screen,
  session,
  type Event as ElectronEvent,
  type IpcMainInvokeEvent,
  type NativeImage,
  type Rectangle,
  type WebContents,
  type WebPreferences,
} from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { probeActivation, type ActivationProbe } from './activation';
import { findExisting, manifestProblems, readmeProblems, readText, rendererProblems } from './checks';
import { expectSecond as expectSecondLaunch } from './mode';
import { fileArguments, samePath } from './paths';

const PAGE_URL = 's02://page/renderer.html';
const PAGE_COLOR = '#F4F1EA';
const PAGE_CSP = [
  "default-src 'none'",
  'script-src s02:',
  'style-src s02:',
  'font-src s02:',
  'img-src s02: data: blob:',
  "connect-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');
const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': PAGE_CSP,
  'X-Content-Type-Options': 'nosniff',
};
const PAGE_FILES: Readonly<Record<string, string>> = {
  'renderer.html': 'text/html; charset=utf-8',
  'renderer.css': 'text/css; charset=utf-8',
  'renderer.js': 'text/javascript; charset=utf-8',
};

type Source = 'cold-start' | 'second-instance' | 'open-file' | 'open-url';

interface ActivationRecord {
  at: string;
  source: Source;
  argv: string[];
  cwd: string;
  workingDirectory: string | null;
  additionalData: unknown;
  paths: string[];
}

interface CheckRow {
  id: string;
  pass: boolean;
  detail: string;
}

interface LockPayload {
  spike: 's02';
  pid: number;
  at: string;
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: 's02',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
      bypassCSP: false,
      allowServiceWorkers: false,
    },
  },
]);

// The name is part of the single-instance key. Both processes set it before the lock.
app.setName('Obelisk Spike S-02');
Menu.setApplicationMenu(null);

const lockPayload: LockPayload = { spike: 's02', pid: process.pid, at: new Date().toISOString() };
const gotLock = app.requestSingleInstanceLock(lockPayload);
const coldStart: ActivationRecord = {
  at: lockPayload.at,
  source: 'cold-start',
  argv: process.argv.slice(),
  cwd: process.cwd(),
  workingDirectory: process.cwd(),
  additionalData: lockPayload,
  paths: fileArguments(process.argv),
};

let outputDir = '';
let reportPath = '';
let outputReady = false;
let mainWindow: BrowserWindow | null = null;
let windowsOpened = 0;
let finished = false;
let expectTimer: NodeJS.Timeout | null = null;
let walkthroughCapture: { ok: true; bytes: number } | { ok: false; error: string } | null = null;
let walkthroughPainted: boolean | null = null;
let probe: ActivationProbe | null = null;
const activations: ActivationRecord[] = [];
const checks: CheckRow[] = [];
const pageEvents: string[] = [];
const wantSecond = expectSecondLaunch(process.env, process.argv);

function flag(name: string): string | null {
  const at = process.argv.indexOf(name);
  if (at < 0) return null;
  const value = process.argv[at + 1];
  if (!value || value.startsWith('--')) return null;
  return value;
}

function earlyOutputDir(): string | null {
  const flagged = flag('--output');
  if (flagged) return path.resolve(flagged);
  if (process.env.OBELISK_S02_OUTPUT) return path.resolve(process.env.OBELISK_S02_OUTPUT);
  return null;
}

function cloneData(value: unknown): unknown {
  if (value === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(value)) as unknown;
  } catch {
    return String(value);
  }
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const body = `${JSON.stringify(value, null, 2)}\n`;
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, body);
  try {
    fs.renameSync(tmp, file);
  } catch {
    fs.writeFileSync(file, body);
    fs.rmSync(tmp, { force: true });
  }
}

function writeProcessStamp(lock: boolean): void {
  const dir = outputDir || earlyOutputDir();
  if (!dir) return;
  const body = {
    pid: process.pid,
    gotLock: lock,
    at: new Date().toISOString(),
    argv: process.argv.slice(),
    cwd: process.cwd(),
    execPath: process.execPath,
    paths: fileArguments(process.argv),
  };
  writeJson(path.join(dir, `process-${process.pid}.json`), body);
  if (!lock) writeJson(path.join(dir, 'second-process.json'), body);
}

function findRepoRoot(): string | null {
  const candidate = path.resolve(__dirname, '..', '..', '..');
  if (
    fs.existsSync(path.join(candidate, 'package.json'))
    && fs.existsSync(path.join(candidate, 'spikes', 's02', 'AppxManifest.xml'))
  ) {
    return candidate;
  }
  return null;
}

function expectedElectron(): string | null {
  const buildFile = path.join(__dirname, 'build.json');
  const buildText = readText(buildFile);
  if (buildText) {
    try {
      const parsed = JSON.parse(buildText) as { electron?: string };
      if (parsed.electron) return parsed.electron;
    } catch {
      return null;
    }
  }
  const repo = findRepoRoot();
  if (!repo) return null;
  const text = readText(path.join(repo, 'package.json'));
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as { devDependencies?: { electron?: string } };
    return parsed.devDependencies?.electron ?? null;
  } catch {
    return null;
  }
}

function commitFromBuild(): string | null {
  const buildText = readText(path.join(__dirname, 'build.json'));
  if (buildText) {
    try {
      const parsed = JSON.parse(buildText) as { commit?: string };
      if (parsed.commit) return parsed.commit;
    } catch {
      return null;
    }
  }
  return null;
}

function addCheck(id: string, pass: boolean, detail: string): void {
  const existing = checks.find((row) => row.id === id);
  if (existing) {
    existing.pass = pass;
    existing.detail = detail;
  } else {
    checks.push({ id, pass, detail });
  }
  console.log(`S02 ${pass ? 'pass' : 'fail'} ${id}: ${detail}`);
}

function checksPass(): boolean {
  return checks.every((row) => row.pass);
}

function receivedPaths(): Array<{ at: string; source: Source; path: string }> {
  const rows: Array<{ at: string; source: Source; path: string }> = [];
  for (const item of [coldStart, ...activations]) {
    for (const filePath of item.paths) rows.push({ at: item.at, source: item.source, path: filePath });
  }
  return rows;
}

function dataText(value: unknown): string {
  try {
    return JSON.stringify(value ?? null, null, 2);
  } catch {
    return String(value);
  }
}

function viewOf(item: ActivationRecord): Record<string, unknown> {
  return {
    at: item.at,
    source: item.source,
    argv: item.argv,
    cwd: item.cwd,
    workingDirectory: item.workingDirectory,
    additionalDataText: dataText(item.additionalData),
    paths: item.paths,
  };
}

function viewState(): Record<string, unknown> {
  return {
    electronVersion: process.versions.electron ?? 'unknown',
    packaged: app.isPackaged,
    windowsStore: probe?.windowsStore ?? null,
    gotLock,
    windowsOpened,
    pid: process.pid,
    reportPath,
    coldStart: viewOf(coldStart),
    activations: [coldStart, ...activations].map(viewOf),
    receivedPaths: receivedPaths(),
    probeText: probe?.detail ?? '',
    checkErrors: checks.filter((row) => !row.pass).map((row) => `${row.id}: ${row.detail}`),
  };
}

function reportBody(status: 'running' | 'check' | 'manual'): Record<string, unknown> {
  const expected = expectedElectron();
  const running = process.versions.electron ?? null;
  return {
    spike: 'S-02',
    ok: status === 'check' ? checksPass() : null,
    mode: status === 'manual' ? 'manual' : status === 'check' ? 'check' : 'running',
    listening: outputReady,
    packageName: 'Obelisk.SpikeS02',
    fileType: '.s02obk',
    startedAt: lockPayload.at,
    updatedAt: new Date().toISOString(),
    pid: process.pid,
    gotLock,
    windowsOpened,
    electron: {
      version: running,
      chrome: process.versions.chrome ?? null,
      node: process.versions.node ?? null,
      expected,
    },
    versionMatchesApp: expected !== null && running === expected,
    platform: process.platform,
    arch: process.arch,
    osRelease: os.release(),
    osVersion: os.version(),
    windowsStore: probe?.windowsStore ?? null,
    isPackaged: app.isPackaged,
    execPath: process.execPath,
    cwd: process.cwd(),
    commit: commitFromBuild(),
    coldStart,
    secondInstances: activations.filter((item) => item.source === 'second-instance'),
    activations,
    receivedPaths: receivedPaths(),
    activationProbe: probe,
    checks,
    walkthroughPng: Boolean(outputDir) && fs.existsSync(path.join(outputDir, 'walkthrough.png')),
    walkthroughCapture,
    walkthroughPainted,
    reportPath,
    outputDir,
  };
}

function persist(status: 'running' | 'check' | 'manual'): void {
  if (!outputDir || !reportPath) return;
  writeJson(reportPath, reportBody(status));
}

function secondSatisfied(): boolean {
  const expected = process.env.OBELISK_S02_SECOND_FILE;
  if (!expected) return activations.some((item) => item.source === 'second-instance');
  return activations.some((item) => (
    item.source === 'second-instance'
    && (item.argv.some((arg) => samePath(arg, expected)) || item.paths.some((filePath) => samePath(filePath, expected)))
  ));
}

function noteActivation(record: ActivationRecord): void {
  activations.push(record);
  console.log(`S02 ${record.source} paths=${record.paths.join(' | ') || '(none)'} workingDirectory=${record.workingDirectory ?? ''}`);
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
  if (!outputReady || finished) return;
  if (wantSecond) {
    if (secondSatisfied()) setTimeout(() => finishCheck(), 50);
    return;
  }
  persist('running');
}

function onSecondInstance(
  _event: ElectronEvent,
  argv: string[],
  workingDirectory: string,
  additionalData: unknown,
): void {
  noteActivation({
    at: new Date().toISOString(),
    source: 'second-instance',
    argv: argv.slice(),
    cwd: process.cwd(),
    workingDirectory,
    additionalData: cloneData(additionalData),
    paths: fileArguments(argv),
  });
}

function finishCheck(): void {
  if (finished) return;
  finished = true;
  if (expectTimer) clearTimeout(expectTimer);
  if (wantSecond) {
    const pass = secondSatisfied();
    const expected = process.env.OBELISK_S02_SECOND_FILE ?? 'a file';
    addCheck(
      'second-instance',
      pass,
      pass
        ? `The second launch reached this process with ${expected}.`
        : `The second launch did not reach this process. Expected ${expected}.`,
    );
  }
  persist('check');
  console.log(`S02 report ${reportPath} ok=${String(checksPass())}`);
  app.exit(checksPass() ? 0 : 1);
}

function pagePreferences(preload: string): WebPreferences {
  return {
    preload,
    contextIsolation: true,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    nodeIntegrationInSubFrames: false,
    sandbox: true,
    webviewTag: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
    experimentalFeatures: false,
    navigateOnDragDrop: false,
    enableWebSQL: false,
  };
}

function windowBounds(): { width: number; height: number } {
  const area = screen.getPrimaryDisplay().workAreaSize;
  return {
    width: Math.min(1040, Math.max(720, area.width - 48)),
    height: Math.min(900, Math.max(640, area.height - 48)),
  };
}

function notePage(line: string): void {
  pageEvents.push(line);
  console.error(line);
}

function attachDiagnostics(contents: WebContents): void {
  contents.on('preload-error', (_event, preloadPath, error) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    notePage(`S02 preload error ${preloadPath}: ${message}`);
  });
  contents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    notePage(`S02 load failed main=${String(isMainFrame)} code=${code} ${description} ${url}`);
  });
  contents.on('render-process-gone', (_event, details) => {
    notePage(`S02 renderer gone reason=${details.reason} exit=${details.exitCode}`);
  });
  contents.on('console-message', (details) => {
    if (details.level !== 'error' && details.level !== 'warning') return;
    notePage(`S02 console ${details.level}: ${details.message} (${details.sourceId}:${details.lineNumber})`);
  });
  contents.on('did-finish-load', () => {
    console.log(`S02 page loaded ${contents.getURL()}`);
  });
}

function attachDevTools(win: BrowserWindow): void {
  win.webContents.on('before-input-event', (_event, input) => {
    if (input.type !== 'keyDown' || input.key !== 'F12' || win.isDestroyed()) return;
    _event.preventDefault();
    if (win.webContents.isDevToolsOpened()) win.webContents.closeDevTools();
    else win.webContents.openDevTools({ mode: 'detach' });
  });
  if (process.argv.includes('--devtools')) win.webContents.openDevTools({ mode: 'detach' });
}

function publishPageFiles(): void {
  const srcDir = path.resolve(__dirname, '..', 'src');
  for (const name of ['renderer.html', 'renderer.css']) {
    const from = path.join(srcDir, name);
    const to = path.join(__dirname, name);
    if (fs.existsSync(from) && path.resolve(from) !== path.resolve(to)) fs.copyFileSync(from, to);
    if (!fs.existsSync(to)) throw new Error(`Missing page file ${name}.`);
  }
}

function pageResponse(status: number, body: string | Uint8Array | null, headers: Record<string, string>): Response {
  return new Response(body as BodyInit | null, {
    status,
    headers: { ...SECURITY_HEADERS, ...headers },
  });
}

function installPageSecurity(): void {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders: Record<string, string[]> = { ...details.responseHeaders };
    const existing: string[] = [];
    for (const [key, values] of Object.entries(responseHeaders)) {
      if (key.toLowerCase() === 'content-security-policy' && values) existing.push(...values);
    }
    if (!existing.includes(PAGE_CSP)) responseHeaders['Content-Security-Policy'] = [...existing, PAGE_CSP];
    callback({ responseHeaders });
  });
}

function installPageProtocol(): void {
  protocol.handle('s02', (request) => {
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return pageResponse(400, 'Bad URL', { 'Content-Type': 'text/plain; charset=utf-8' });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return pageResponse(405, 'Method not allowed', {
        'Content-Type': 'text/plain; charset=utf-8',
        Allow: 'GET, HEAD',
      });
    }
    if (url.hostname !== 'page' || url.username !== '' || url.password !== '') {
      return pageResponse(404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
    }
    const name = url.pathname.replace(/^\/+/, '');
    const type = PAGE_FILES[name];
    if (!type || name.includes('..') || name.includes('\\')) {
      return pageResponse(404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
    }
    const filePath = path.join(__dirname, name);
    if (!fs.existsSync(filePath)) return pageResponse(404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
    const data = fs.readFileSync(filePath);
    return pageResponse(200, request.method === 'HEAD' ? null : new Uint8Array(data), { 'Content-Type': type });
  });
}

function createWindow(): BrowserWindow {
  const bounds = windowBounds();
  const windowsFrame = process.platform === 'win32'
    ? {
        titleBarStyle: 'hidden' as const,
        titleBarOverlay: { color: PAGE_COLOR, symbolColor: '#1C1917', height: 32 },
      }
    : {};
  const win = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    title: 'Spike S-02',
    backgroundColor: PAGE_COLOR,
    ...windowsFrame,
    webPreferences: pagePreferences(path.join(__dirname, 'preload.js')),
  });
  windowsOpened += 1;
  mainWindow = win;
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  attachDiagnostics(win.webContents);
  attachDevTools(win);
  win.on('close', (event) => {
    if (wantSecond && !finished) event.preventDefault();
  });
  win.on('closed', () => {
    mainWindow = null;
    if (finished) return;
    finished = true;
    persist('manual');
    console.log('S02 window closed.');
    app.exit(0);
  });
  return win;
}

function boundsText(rect: Rectangle): string {
  return `x=${rect.x} y=${rect.y} width=${rect.width} height=${rect.height}`;
}

async function pageText(win: BrowserWindow): Promise<string> {
  if (win.isDestroyed()) return '';
  return String(await win.webContents.executeJavaScript('document.body ? document.body.innerText : ""'));
}

async function waitForText(win: BrowserWindow, needle: string, timeoutMs: number): Promise<string> {
  const started = Date.now();
  let last = '';
  while (Date.now() - started < timeoutMs) {
    try {
      last = await pageText(win);
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    if (last.includes(needle)) return last;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return last;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>]/g, (ch) => (ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : '&gt;'));
}

async function showFailure(win: BrowserWindow, reason: string): Promise<void> {
  const text = ['Spike S-02 could not show the window.', reason, ...pageEvents].join('\n');
  console.error(text);
  const html = `<!DOCTYPE html><html><body style="background:#f4f1ea;color:#1c1917;font-family:Segoe UI,sans-serif;white-space:pre-wrap;padding:24px;">${escapeHtml(text)}</body></html>`;
  try {
    if (!win.isDestroyed()) await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  } catch (error) {
    console.error(`S02 could not show the failure page: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function logSurface(win: BrowserWindow): Promise<void> {
  if (win.isDestroyed()) return;
  win.show();
  let title = '';
  let bodyChars = 0;
  try {
    const raw: unknown = await win.webContents.executeJavaScript(
      '({ title: document.title, bodyChars: document.body && document.body.innerText ? document.body.innerText.length : 0 })',
    );
    if (raw && typeof raw === 'object') {
      const record = raw as { title?: unknown; bodyChars?: unknown };
      if (typeof record.title === 'string') title = record.title;
      if (typeof record.bodyChars === 'number') bodyChars = record.bodyChars;
    }
  } catch (error) {
    console.log(`S02 could not read the document: ${error instanceof Error ? error.message : String(error)}`);
  }
  const bounds = win.getBounds();
  const content = win.getContentBounds();
  const [contentWidth, contentHeight] = win.getContentSize();
  const display = screen.getDisplayMatching(bounds);
  console.log(`S02 window bounds ${boundsText(bounds)}`);
  console.log(`S02 content bounds ${boundsText(content)}`);
  console.log(
    `S02 content size width=${contentWidth} height=${contentHeight} background=${win.getBackgroundColor()} offscreen=${String(win.webContents.isOffscreen())} offscreenPainting=${String(win.webContents.isPainting())}`,
  );
  console.log(`S02 display scale=${display.scaleFactor} workArea ${boundsText(display.workArea)}`);
  console.log(`S02 document title="${title}" bodyChars=${bodyChars}`);
  if (contentWidth >= 100 && contentHeight >= 100) return;
  const nextWidth = Math.max(bounds.width, 720);
  const nextHeight = Math.max(bounds.height, 640);
  console.log(`S02 content view is too small (${contentWidth}x${contentHeight}). Setting the content size to ${nextWidth}x${nextHeight}.`);
  win.setContentSize(nextWidth, nextHeight);
}

function frameLooksLikePage(image: NativeImage): boolean {
  const size = image.getSize();
  if (size.width < 80 || size.height < 80) return false;
  const bitmap = image.toBitmap();
  const points = [
    [8, 8],
    [Math.floor(size.width / 2), 24],
    [40, Math.floor(size.height / 3)],
  ];
  let light = 0;
  for (const [x, y] of points) {
    const offset = (y * size.width + x) * 4;
    const blue = bitmap[offset] ?? 0;
    const green = bitmap[offset + 1] ?? 0;
    const red = bitmap[offset + 2] ?? 0;
    if (red > 200 && green > 190 && blue > 180) light += 1;
  }
  return light >= 2;
}

async function captureWalkthrough(win: BrowserWindow): Promise<void> {
  let lastError = 'capturePage did not run';
  const file = path.join(outputDir, 'walkthrough.png');
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 200 : 400));
    try {
      const image = await win.capturePage();
      const png = image.toPNG();
      if (png.length < 100) {
        lastError = 'capturePage returned an empty image';
        console.log(`S02 capture retry ${attempt + 1}: ${lastError}`);
        continue;
      }
      fs.writeFileSync(file, png);
      const stamped = path.join(outputDir, `walkthrough-${Date.now()}.png`);
      try {
        fs.copyFileSync(file, stamped);
      } catch (error) {
        console.log(`S02 could not keep a second copy of the capture: ${error instanceof Error ? error.message : String(error)}`);
      }
      walkthroughCapture = { ok: true, bytes: png.length };
      walkthroughPainted = frameLooksLikePage(image);
      console.log(`S02 capturePage wrote ${file} (${png.length} bytes). painted=${String(walkthroughPainted)}`);
      return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      console.log(`S02 capture retry ${attempt + 1}: ${lastError}`);
    }
  }
  walkthroughCapture = { ok: false, error: lastError };
  walkthroughPainted = null;
  console.log(`S02 capturePage did not write ${file}: ${lastError}`);
}

function runStaticChecks(): void {
  const expected = expectedElectron();
  const running = process.versions.electron ?? '';
  if (expected) {
    addCheck(
      'electron-version',
      running === expected,
      running === expected
        ? `Running Electron ${running} (Chrome ${process.versions.chrome ?? 'unknown'}, Node ${process.versions.node ?? 'unknown'}), matching the app package.`
        : `Running Electron ${running || 'unknown'}, app package asks for ${expected}.`,
    );
  } else {
    addCheck('electron-version', false, 'The Electron version this spike should match was not found.');
  }
  const manifestPath = findExisting([
    path.resolve(__dirname, '..', '..', 'AppxManifest.xml'),
    path.resolve(__dirname, '..', 'AppxManifest.xml'),
  ]);
  const manifest = manifestPath ? readText(manifestPath) : null;
  if (!manifest) {
    addCheck('manifest', false, 'AppxManifest.xml was not found.');
  } else {
    const problems = manifestProblems(manifest);
    addCheck('manifest', problems.length === 0, problems.length === 0 ? `Manifest ${manifestPath} is Obelisk.SpikeS02 with .s02obk.` : problems.join(' '));
  }
  const readmePath = findExisting([path.resolve(__dirname, '..', 'README.md')]);
  const readme = readmePath ? readText(readmePath) : null;
  if (!readme) {
    addCheck('readme', true, 'The README is not in this package. The unpackaged check reads it.');
  } else {
    const problems = readmeProblems(readme);
    addCheck('readme', problems.length === 0, problems.length === 0 ? 'The README has the decision rule and the recorded pass.' : problems.join(' '));
  }
  const rendererPath = findExisting([path.resolve(__dirname, '..', 'src', 'renderer.ts')]);
  const renderer = rendererPath ? readText(rendererPath) : null;
  if (!renderer) {
    addCheck('renderer-imports', true, 'The walkthrough source is not in this package. The unpackaged check reads it.');
  } else {
    const problems = rendererProblems(renderer);
    addCheck('renderer-imports', problems.length === 0, problems.length === 0 ? 'The walkthrough page does not import Node or Electron.' : problems.join(' '));
  }
  addCheck(
    'single-instance',
    gotLock && windowsOpened === 1,
    gotLock && windowsOpened === 1
      ? 'This process holds the lock and opened one window.'
      : `gotLock=${String(gotLock)} windowsOpened=${windowsOpened}`,
  );
  const requirePng = process.platform === 'win32';
  if (requirePng) {
    const capture = walkthroughCapture;
    const pngOk = capture?.ok === true;
    addCheck(
      'walkthrough-png',
      pngOk,
      pngOk ? `capturePage wrote ${capture.bytes} bytes.` : `capturePage did not write walkthrough.png (${capture?.ok === false ? capture.error : 'no capture'}).`,
    );
  }
  addCheck(
    'page-painted',
    walkthroughPainted !== false,
    walkthroughPainted === true
      ? 'The window showed the light page background.'
      : walkthroughPainted === false
        ? 'The window was a dark frame.'
        : 'capturePage did not return an image. The page text was already checked.',
  );
  addCheck(
    'activation-probe',
    probe !== null,
    probe ? probe.detail : 'The activation probe did not run.',
  );
}

function assertSender(event: IpcMainInvokeEvent): void {
  if (!mainWindow || event.sender !== mainWindow.webContents) throw new Error('Unknown frame.');
}

function wireIpc(): void {
  ipcMain.handle('s02:get-state', (event) => {
    assertSender(event);
    return viewState();
  });
}

function archivePreviousReport(): void {
  if (!reportPath || !fs.existsSync(reportPath)) return;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const archived = path.join(path.dirname(reportPath), `spike-report-${stamp}-${process.pid}.json`);
  try {
    fs.renameSync(reportPath, archived);
    console.log(`S02 kept the previous report at ${archived}`);
  } catch (error) {
    console.log(`S02 could not keep the previous report: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function runBody(): Promise<void> {
  outputDir = earlyOutputDir() ?? path.join(app.getPath('documents'), 'Obelisk-Spike-S02', 'reports');
  const flaggedReport = flag('--report');
  reportPath = flaggedReport ? path.resolve(flaggedReport) : path.join(outputDir, 'spike-report.json');
  fs.mkdirSync(outputDir, { recursive: true });
  archivePreviousReport();
  writeProcessStamp(true);
  installPageSecurity();
  installPageProtocol();
  publishPageFiles();
  wireIpc();
  const probePromise = probeActivation(app, outputDir);
  console.log(`S02 opening the window at ${PAGE_URL}`);
  const win = createWindow();
  try {
    await win.loadURL(PAGE_URL);
  } catch (error) {
    notePage(`S02 loadURL rejected: ${error instanceof Error ? error.message : String(error)}`);
  }
  const text = await waitForText(win, 'Cold start', 8000);
  const basenames = coldStart.paths.map((filePath) => path.basename(filePath));
  const showedFiles = basenames.every((name) => text.includes(name));
  const ready = text.includes('Spike S-02') && text.includes('Cold start') && showedFiles;
  if (!ready) await showFailure(win, 'Cold start did not appear in the window.');
  addCheck(
    'walkthrough-renders',
    ready,
    ready
      ? 'The window shows Spike S-02 and Cold start.'
      : `The window did not render. snippet=${text.slice(0, 400)} events=${pageEvents.slice(-4).join(' | ')}`,
  );
  await logSurface(win);
  if (!win.isDestroyed()) win.webContents.invalidate();
  await captureWalkthrough(win);
  console.log('S02 press F12 to open DevTools. npm start -- --devtools opens them at launch.');
  try {
    probe = await probePromise;
  } catch (error) {
    console.error(`S02 probe failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  runStaticChecks();
  outputReady = true;
  if (wantSecond && secondSatisfied()) {
    finishCheck();
    return;
  }
  persist(wantSecond ? 'check' : 'running');
  if (!wantSecond) {
    console.log('S02 window is showing. Close it when the case is written down.');
    return;
  }
  expectTimer = setTimeout(() => {
    console.log('S02 timed out waiting for the second instance.');
    finishCheck();
  }, 90000);
}

if (!gotLock) {
  try {
    writeProcessStamp(false);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
  }
  console.log(`S02 second process pid=${process.pid} did not get the lock.`);
  setTimeout(() => {
    app.exit(0);
  }, 1000);
} else {
  console.log(`S02 cold start pid=${process.pid} argv=${JSON.stringify(process.argv)}`);
  app.on('second-instance', onSecondInstance);
  app.on('open-file', (event, filePath) => {
    event.preventDefault();
    noteActivation({
      at: new Date().toISOString(),
      source: 'open-file',
      argv: [filePath],
      cwd: process.cwd(),
      workingDirectory: null,
      additionalData: null,
      paths: [filePath],
    });
  });
  app.on('open-url', (event, url) => {
    event.preventDefault();
    noteActivation({
      at: new Date().toISOString(),
      source: 'open-url',
      argv: [url],
      cwd: process.cwd(),
      workingDirectory: null,
      additionalData: null,
      paths: [url],
    });
  });
  app.on('window-all-closed', () => {
    console.log('S02 windows closed.');
  });
  app.whenReady().then(() => {
    runBody().catch((error: unknown) => {
      console.error(error instanceof Error ? error.stack ?? error.message : String(error));
      app.exit(1);
    });
  }).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    app.exit(1);
  });
}
