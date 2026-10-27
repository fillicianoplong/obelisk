import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, screen, session, type IpcMainInvokeEvent, type NativeImage, type Rectangle, type WebContents } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { CASES, caseIdsFor, readmeErrors } from './cases';
import { runMode, type RunMode } from './mode';
import { CLAIM_FILE, delay, FOLDER_NAME, REPORT_FILE } from './paths';
import { casesDecideOk, runCases, type CaseLog, type PathSnapshot } from './runner';
import { PAYLOAD_LEN, selfTest } from './write-atomic';

const PAGE_URL = 's01://page/renderer.html';
const PAGE_COLOR = '#F4F1EA';
const PAGE_CSP = [
  "default-src 'none'",
  "script-src s01:",
  "style-src s01:",
  "font-src s01:",
  "img-src s01: data: blob:",
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
  'renderer.js.map': 'application/json',
};

protocol.registerSchemesAsPrivileged([
  {
    scheme: 's01',
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

interface CheckRow {
  id: string;
  pass: boolean;
  detail: string;
}

interface CaseRow {
  id: string;
  title: string;
  status: string;
  detail: string;
}

interface ViewState {
  phase: 'starting' | 'need-folder' | 'running' | 'done';
  headline: string;
  doing: string;
  electronVersion: string;
  packaged: boolean;
  windowsStore: boolean;
  mode: RunMode;
  paths: Array<{ name: string; value: string }>;
  cases: CaseRow[];
  currentId: string | null;
  reportPath: string;
  confirmCommand: string;
  banner: string;
}

const checks: CheckRow[] = [];
const pageEvents: string[] = [];
let outputDir = '';
let reportPath = '';
let mainWindow: BrowserWindow | null = null;
let phase: ViewState['phase'] = 'starting';
let doing = 'Opening the window.';
let currentId: string | null = null;
let mode: RunMode = 'check';
let pathSnapshot: PathSnapshot | null = null;
let caseRows: CaseRow[] = [];
let finished: CaseLog[] = [];
let walkthroughCapture: { ok: true; bytes: number } | { ok: false; error: string } | null = null;
let walkthroughPainted: boolean | null = null;
let resultsCapture: { ok: true; bytes: number } | { ok: false; error: string } | null = null;
let folderWait: (() => void) | null = null;
let secondFolder: string | null = null;
let folderResolved = false;
let confirmCommand = '';
let finalExitOk: boolean | null = null;

function windowsStore(): boolean {
  const record = process as NodeJS.Process & { windowsStore?: boolean };
  return record.windowsStore === true;
}

function expectedElectron(): string {
  const candidates = [
    path.resolve(__dirname, '..', '..', '..', 'package.json'),
    path.resolve(__dirname, '..', '..', 'package.json'),
  ];
  for (const file of candidates) {
    try {
      const pkg = JSON.parse(fs.readFileSync(file, 'utf8')) as { devDependencies?: { electron?: string } };
      const version = pkg.devDependencies?.electron;
      if (version) return version;
    } catch {
      continue;
    }
  }
  return '45.0.0';
}

function addCheck(id: string, pass: boolean, detail: string): void {
  checks.push({ id, pass, detail });
  console.log(`S01 ${pass ? 'pass' : 'fail'} ${id}: ${detail}`);
}

function checksPass(): boolean {
  return checks.every((item) => item.pass);
}

function resolveOutput(): string {
  const fromArg = argValue('--output');
  if (fromArg) return path.resolve(fromArg);
  const fromEnv = process.env.OBELISK_S01_OUTPUT;
  if (fromEnv) return path.resolve(fromEnv);
  return path.join(app.getPath('documents'), FOLDER_NAME, 'output');
}

function argValue(name: string): string | null {
  const at = process.argv.indexOf(name);
  if (at < 0) return null;
  return process.argv[at + 1] ?? null;
}

function snapshotPaths(): PathSnapshot {
  const home = app.getPath('home');
  return {
    userData: app.getPath('userData'),
    documents: app.getPath('documents'),
    desktop: app.getPath('desktop'),
    appData: app.getPath('appData'),
    temp: app.getPath('temp'),
    exe: app.getPath('exe'),
    home,
    localAppData: process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'),
  };
}

function pathRows(): Array<{ name: string; value: string }> {
  if (!pathSnapshot) return [];
  return [
    { name: 'userData', value: pathSnapshot.userData },
    { name: 'documents', value: pathSnapshot.documents },
    { name: 'desktop', value: pathSnapshot.desktop },
    { name: 'appData', value: pathSnapshot.appData },
    { name: 'localAppData', value: pathSnapshot.localAppData },
    { name: 'temp', value: pathSnapshot.temp },
    { name: 'exe', value: pathSnapshot.exe },
    { name: 'execPath', value: process.execPath },
    { name: 'cwd', value: process.cwd() },
  ];
}

function statusFor(log: CaseLog | undefined, pending: boolean): string {
  if (!log) return pending ? 'pending' : 'skipped';
  if (!log.ran) return 'skipped';
  if (log.pass === true) return 'pass';
  if (log.pass === false) return 'fail';
  if (log.needsOutside) return 'outside';
  return 'recorded';
}

function viewState(): ViewState {
  const packaged = app.isPackaged;
  return {
    phase,
    headline: packaged ? 'Packaged MSIX' : 'Unpackaged',
    doing,
    electronVersion: process.versions.electron ?? '',
    packaged,
    windowsStore: windowsStore(),
    mode,
    paths: pathRows(),
    cases: caseRows,
    currentId,
    reportPath,
    confirmCommand,
    banner: packaged
      ? 'This is Obelisk Spike S-01. It is not Obelisk.Dev.'
      : 'This window is not the MSIX package. It does not answer redirection.',
  };
}

function notePage(message: string): void {
  pageEvents.push(message);
  console.log(message);
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
    if (!existing.includes(PAGE_CSP)) {
      responseHeaders['Content-Security-Policy'] = [...existing, PAGE_CSP];
    }
    callback({ responseHeaders });
  });
}

function installPageProtocol(): void {
  protocol.handle('s01', (request) => {
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
    const name = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const type = PAGE_FILES[name];
    if (!type || name.includes('..') || name.includes('\\')) {
      return pageResponse(404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
    }
    const filePath = path.join(__dirname, name);
    if (!fs.existsSync(filePath)) {
      return pageResponse(404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
    }
    const data = fs.readFileSync(filePath);
    return pageResponse(200, request.method === 'HEAD' ? null : new Uint8Array(data), { 'Content-Type': type });
  });
}

function publishPageFiles(): void {
  for (const name of ['renderer.html', 'renderer.css']) {
    const beside = path.join(__dirname, name);
    if (fs.existsSync(beside)) continue;
    const fromSrc = path.resolve(__dirname, '..', 'src', name);
    if (fs.existsSync(fromSrc)) fs.copyFileSync(fromSrc, beside);
  }
}

function assertSender(event: IpcMainInvokeEvent): void {
  if (!mainWindow || event.sender !== mainWindow.webContents) {
    throw new Error('Unknown frame.');
  }
}

function chooseFolder(folder: string): void {
  if (folderResolved) return;
  folderResolved = true;
  secondFolder = folder;
  phase = 'running';
  doing = `Second folder: ${folder}`;
  folderWait?.();
  folderWait = null;
}

function wireIpc(): void {
  ipcMain.handle('s01:get-state', (event) => {
    // The page polls until the window closes. A late call has no frame, and throwing only prints stderr.
    if (!mainWindow || mainWindow.isDestroyed()) return viewState();
    assertSender(event);
    return viewState();
  });
  ipcMain.handle('s01:use-desktop', (event) => {
    assertSender(event);
    if (phase === 'need-folder') chooseFolder(app.getPath('desktop'));
    return viewState();
  });
  ipcMain.handle('s01:pick-folder', async (event) => {
    assertSender(event);
    if (phase !== 'need-folder' || !mainWindow) return viewState();
    const picked = await dialog.showOpenDialog(mainWindow, {
      title: 'Second folder for spike S-01',
      properties: ['openDirectory'],
    });
    if (!picked.canceled && picked.filePaths[0]) chooseFolder(picked.filePaths[0]);
    return viewState();
  });
  ipcMain.handle('s01:close', (event) => {
    assertSender(event);
    if (phase === 'done') mainWindow?.close();
    return viewState();
  });
}

function runStaticChecks(electronVersion: string): void {
  const running = process.versions.electron ?? '';
  addCheck(
    'electron-version',
    running === electronVersion,
    running === electronVersion
      ? `Running Electron ${running} (Chrome ${process.versions.chrome ?? 'unknown'}, Node ${process.versions.node ?? 'unknown'}, uv ${process.versions.uv ?? 'unknown'}).`
      : `Running Electron ${running || 'unknown'}, expected ${electronVersion}.`,
  );
  const watcher = path.join(__dirname, 'watch-replace.ps1');
  let watcherText = '';
  try {
    watcherText = fs.readFileSync(watcher, 'utf8');
  } catch {
    // The packaged layout and the unpackaged dist both copy this script next to the host.
  }
  addCheck(
    'watcher-script',
    watcherText.includes(`$PayloadLength = ${PAYLOAD_LEN}`) && watcherText.includes('OBK1') && watcherText.includes('END1'),
    watcherText
      ? 'watch-replace.ps1 uses the same payload length and markers as writeAtomic.'
      : 'watch-replace.ps1 is not next to the host.',
  );
  if (!app.isPackaged) {
    const readmePath = path.resolve(__dirname, '..', 'README.md');
    const readme = fs.existsSync(readmePath) ? fs.readFileSync(readmePath, 'utf8') : '';
    const notes = readmeErrors(readme, electronVersion);
    addCheck('readme', notes.length === 0, notes.length === 0 ? 'The README names every case and leaves the manual boxes empty.' : notes.join(' '));
    const rendererPath = path.resolve(__dirname, '..', 'src', 'renderer.ts');
    const renderer = fs.existsSync(rendererPath) ? fs.readFileSync(rendererPath, 'utf8') : '';
    const importsNode = /from\s+['"]electron['"]|from\s+['"]node:|require\s*\(\s*['"]electron['"]|require\s*\(\s*['"]node:/.test(renderer);
    addCheck(
      'renderer-imports',
      renderer.length > 0 && !importsNode,
      importsNode || renderer.length === 0
        ? 'The page is missing or it imports Node or Electron.'
        : 'The page does not import Node or Electron.',
    );
  }
}

function windowBounds(): { width: number; height: number } {
  const area = screen.getPrimaryDisplay().workAreaSize;
  return {
    width: Math.min(1040, Math.max(720, area.width - 48)),
    height: Math.min(980, Math.max(640, area.height - 48)),
  };
}

function attachDevTools(win: BrowserWindow): void {
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.key !== 'F12' || win.isDestroyed()) return;
    event.preventDefault();
    if (win.webContents.isDevToolsOpened()) win.webContents.closeDevTools();
    else win.webContents.openDevTools({ mode: 'detach' });
  });
  if (process.argv.includes('--devtools')) win.webContents.openDevTools({ mode: 'detach' });
}

function attachDiagnostics(contents: WebContents): void {
  contents.on('preload-error', (_event, preloadPath, error) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    notePage(`S01 preload error ${preloadPath}: ${message}`);
  });
  contents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    notePage(`S01 load failed main=${String(isMainFrame)} code=${code} ${description} ${url}`);
  });
  contents.on('render-process-gone', (_event, details) => {
    notePage(`S01 renderer gone reason=${details.reason} exit=${details.exitCode}`);
  });
  contents.on('console-message', (details) => {
    if (details.level !== 'error' && details.level !== 'warning') return;
    notePage(`S01 console ${details.level}: ${details.message} (${details.sourceId}:${details.lineNumber})`);
  });
  contents.on('did-finish-load', () => {
    console.log(`S01 page loaded ${contents.getURL()}`);
  });
}

function createWindow(): BrowserWindow {
  const bounds = windowBounds();
  const windowsFrame = process.platform === 'win32'
    ? {
      titleBarStyle: 'hidden' as const,
      titleBarOverlay: {
        color: PAGE_COLOR,
        symbolColor: '#1C1917',
        height: 32,
      },
    }
    : {};
  const win = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    title: 'Spike S-01',
    backgroundColor: PAGE_COLOR,
    ...windowsFrame,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
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
    },
  });
  mainWindow = win;
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  attachDiagnostics(win.webContents);
  attachDevTools(win);
  win.on('closed', () => {
    mainWindow = null;
    if (finalExitOk === null) {
      persist(false);
      finalExitOk = false;
    }
    console.log(finalExitOk ? 'S-01 finished.' : 'S-01 closed before the run finished.');
    app.exit(finalExitOk ? 0 : 1);
  });
  return win;
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
    await delay(50);
  }
  return last;
}

function boundsText(rect: Rectangle): string {
  return `x=${rect.x} y=${rect.y} width=${rect.width} height=${rect.height}`;
}

async function logSurface(win: BrowserWindow): Promise<void> {
  if (win.isDestroyed()) return;
  win.show();
  const bounds = win.getBounds();
  const content = win.getContentBounds();
  const [contentWidth, contentHeight] = win.getContentSize();
  const display = screen.getDisplayMatching(bounds);
  console.log(`S01 window bounds ${boundsText(bounds)}`);
  console.log(`S01 content bounds ${boundsText(content)}`);
  console.log(`S01 content size width=${contentWidth} height=${contentHeight} background=${win.getBackgroundColor()} offscreen=${String(win.webContents.isOffscreen())}`);
  console.log(`S01 display scale=${display.scaleFactor}`);
  const text = await pageText(win).catch(() => '');
  console.log(`S01 document chars=${text.length}`);
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

async function capture(win: BrowserWindow, fileName: string): Promise<{ ok: true; bytes: number } | { ok: false; error: string }> {
  let lastError = 'capturePage did not run';
  const file = path.join(outputDir, fileName);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await delay(attempt === 0 ? 200 : 400);
    try {
      const image = await win.capturePage();
      const png = image.toPNG();
      if (png.length < 100) {
        lastError = 'capturePage returned an empty image';
        continue;
      }
      fs.writeFileSync(file, png);
      if (fileName === 'walkthrough.png') walkthroughPainted = frameLooksLikePage(image);
      console.log(`S01 capturePage wrote ${file} (${png.length} bytes).`);
      return { ok: true, bytes: png.length };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      console.log(`S01 capture retry ${attempt + 1}: ${lastError}`);
    }
  }
  return { ok: false, error: lastError };
}

function outsideReportPath(): string {
  return path.join(outputDir, 'outside-report.json');
}

function buildConfirmCommand(): string {
  const claim = path.join(outputDir, CLAIM_FILE);
  const script = 'C:\\dev\\obelisk\\spikes\\s01\\confirm-outside.ps1';
  return `powershell -NoProfile -ExecutionPolicy Bypass -File ${script} -Claim "${claim}" -Report "${outsideReportPath()}"`;
}

function persist(ok: boolean): void {
  const report = {
    spike: 'S-01',
    mode,
    packaged: app.isPackaged,
    windowsStore: windowsStore(),
    ok,
    electron: {
      version: process.versions.electron ?? '',
      chrome: process.versions.chrome ?? '',
      node: process.versions.node ?? '',
      uv: process.versions.uv ?? '',
    },
    paths: pathSnapshot,
    secondFolder,
    cases: finished,
    checks,
    walkthroughPng: walkthroughCapture,
    walkthroughPainted,
    resultsPng: resultsCapture,
    outside: app.isPackaged
      ? 'Pending. confirm-outside.ps1 is a separate process and is not a child of this package.'
      : 'Not applicable. This process is not the MSIX package.',
    manualOnly: [
      'Windows 11 Home 10.0.26300 on this PC',
      'A second folder he picks, including a OneDrive-synced folder',
    ],
    reportPath,
    confirmCommand,
    pageEvents: pageEvents.slice(-12),
  };
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

function updateRow(id: string, status: string, detail: string): void {
  caseRows = caseRows.map((row) => (row.id === id ? { ...row, status, detail } : row));
}

async function showCase(win: BrowserWindow, caseId: string, text: string): Promise<void> {
  currentId = caseId;
  doing = text;
  phase = 'running';
  const row = caseRows.find((item) => item.id === caseId);
  if (row && row.status === 'pending') updateRow(caseId, 'running', text);
  if (win.isDestroyed()) return;
  const seen = await waitForText(win, `case: ${caseId}`, 8000);
  if (!seen.includes(`case: ${caseId}`)) {
    notePage(`S01 page did not show case: ${caseId}. snippet=${seen.slice(0, 240)}`);
  }
}

async function finishCase(win: BrowserWindow, log: CaseLog): Promise<void> {
  finished.push(log);
  const status = statusFor(log, false);
  updateRow(log.id, status, log.detail);
  doing = log.detail;
  currentId = log.id;
  if (!win.isDestroyed()) await waitForText(win, log.id, 4000);
  await delay(400);
}

function seedRows(): void {
  const planned = new Set(caseIdsFor(mode, app.isPackaged));
  caseRows = CASES.map((item) => ({
    id: item.id,
    title: item.title,
    status: planned.has(item.id) ? 'pending' : 'skipped',
    detail: planned.has(item.id) ? '' : 'Not this run. The packaged app runs this case.',
  }));
  currentId = caseIdsFor(mode, app.isPackaged)[0] ?? null;
}

async function openWindow(): Promise<BrowserWindow> {
  console.log(`S01 opening the window at ${PAGE_URL}`);
  const win = createWindow();
  try {
    await win.loadURL(PAGE_URL);
  } catch (error) {
    notePage(`S01 loadURL rejected: ${error instanceof Error ? error.message : String(error)}`);
  }
  return win;
}

async function run(): Promise<void> {
  mode = runMode(process.env, process.argv, app.isPackaged);
  console.log(`S01 mode=${mode} packaged=${String(app.isPackaged)} windowsStore=${String(windowsStore())}`);
  outputDir = resolveOutput();
  reportPath = path.resolve(argValue('--report') ?? path.join(outputDir, REPORT_FILE));
  fs.mkdirSync(outputDir, { recursive: true });
  pathSnapshot = snapshotPaths();
  secondFolder = process.env.OBELISK_S01_SECOND ? path.resolve(process.env.OBELISK_S01_SECOND) : null;
  if (!secondFolder && mode === 'auto') secondFolder = app.getPath('desktop');
  confirmCommand = buildConfirmCommand();
  publishPageFiles();
  installPageSecurity();
  installPageProtocol();
  const electronVersion = expectedElectron();
  runStaticChecks(electronVersion);
  const selfDir = path.join(outputDir, 'self-test');
  fs.mkdirSync(selfDir, { recursive: true });
  const self = await selfTest(selfDir);
  addCheck('write-atomic-shape', self.pass, self.detail);
  seedRows();
  wireIpc();
  Menu.setApplicationMenu(null);
  const win = await openWindow();
  const opened = await waitForText(win, 'Spike S-01', 8000);
  if (!opened.includes('Spike S-01')) {
    addCheck('window-text', false, `The window did not show Spike S-01. snippet=${opened.slice(0, 300)} events=${pageEvents.slice(-4).join(' | ')}`);
  } else {
    addCheck('window-text', true, 'The window showed Spike S-01.');
  }
  await logSurface(win);

  if (mode === 'manual' && app.isPackaged && !secondFolder) {
    phase = 'need-folder';
    doing = 'Pick the second folder. Desktop, or a OneDrive-synced folder.';
    currentId = null;
    await waitForText(win, 'Pick the second folder', 8000);
    walkthroughCapture = await capture(win, 'walkthrough.png');
    await new Promise<void>((resolve) => {
      folderWait = resolve;
    });
  }

  phase = 'running';
  if (currentId) doing = 'Starting the first case.';
  if (!win.isDestroyed() && currentId) {
    await waitForText(win, `case: ${currentId}`, 8000);
  }
  if (!walkthroughCapture) walkthroughCapture = await capture(win, 'walkthrough.png');
  addCheck(
    'page-painted',
    walkthroughPainted !== false,
    walkthroughPainted === true
      ? 'The window showed the light page background.'
      : walkthroughPainted === false
        ? 'The window was a dark frame. The case text was in the page, but it was not visible.'
        : 'capturePage did not return an image. The case text was already in the page.',
  );

  const ids = caseIdsFor(mode, app.isPackaged);
  let outcomeOk = false;
  try {
    if (!pathSnapshot) throw new Error('Paths were not read.');
    const outcome = await runCases({
      mode,
      packaged: app.isPackaged,
      outputDir,
      scriptDir: __dirname,
      paths: pathSnapshot,
      secondFolder,
      hooks: {
        show: (caseId, text) => showCase(win, caseId, text),
        finish: (log) => finishCase(win, log),
      },
    }, ids);
    finished = outcome.cases;
    outcomeOk = casesDecideOk(outcome.cases);
  } catch (error) {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    notePage(`S01 run failed: ${message}`);
  }

  const caseCheckOk = finished.length === ids.length && finished.every((item) => item.pass !== false);
  addCheck(
    'cases',
    caseCheckOk,
    caseCheckOk
      ? `${finished.length} cases finished without a failed result. Outside Get-Item is still separate when the case says so.`
      : `Case results: ${finished.map((item) => `${item.id}=${String(item.pass)}`).join(', ') || 'none'}.`,
  );
  phase = 'done';
  currentId = null;
  doing = app.isPackaged
    ? 'The packaged run is written down. Get-Item from outside the package is the redirection check.'
    : 'The unpackaged run is written down. It does not answer MSIX redirection.';
  if (!win.isDestroyed()) await waitForText(win, 'written down', 8000);
  resultsCapture = await capture(win, 'results.png');
  finalExitOk = outcomeOk && checksPass();
  persist(finalExitOk);
  console.log(`S01 report ${reportPath} ok=${String(finalExitOk)} packaged=${String(app.isPackaged)} mode=${mode}`);
  console.log('S01 press F12 to open DevTools. npm start -- --devtools opens them at launch.');
  if (mode === 'manual') return;
  app.exit(finalExitOk ? 0 : 1);
}

app.on('window-all-closed', () => {
  console.log('S01 windows closed.');
});

app.whenReady().then(() => {
  run().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    try {
      if (outputDir) persist(false);
    } catch {
      // The report is best-effort once the run has already failed.
    }
    app.exit(1);
  });
});
