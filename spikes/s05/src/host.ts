import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, screen, session, type IpcMainInvokeEvent, type NativeImage, type Rectangle, type SaveDialogOptions, type WebContents, type WebPreferences } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildOptions,
  CASES,
  filterLabel,
  optionErrors,
  parentLabel,
  pathLabel,
  propertiesLabel,
  readmeErrors,
  stepsText,
  validateCases,
  type BuiltSaveOptions,
  type ParentKind,
  type SaveCase,
} from './cases';
import { changedNames, directorySnap, fixtureBodyChanged, selfTest, snap, writeFixtures, type FileSnap } from './files';
import { isManualRun } from './mode';

const PROMPTS = ['stayed', 'closed-by-itself', 'did-not-appear', 'could-not-tell'] as const;
const CLICKS = ['replace', 'cancel', 'no-prompt-button'] as const;

type PromptAnswer = (typeof PROMPTS)[number];
type ClickAnswer = (typeof CLICKS)[number];
type Phase = 'ready' | 'asking' | 'done' | 'blocked';

interface Observation {
  prompt: PromptAnswer;
  clicked: ClickAnswer;
  note: string;
}

interface PendingDialog {
  item: SaveCase;
  options: BuiltSaveOptions;
  before: Record<string, FileSnap>;
  fixtureBefore: FileSnap;
  result: { canceled: boolean; filePath: string } | null;
  error: string | null;
  after: Record<string, FileSnap>;
  fixtureAfter: FileSnap;
}

interface CaseLog {
  id: string;
  title: string;
  decidesFr12: boolean;
  options: BuiltSaveOptions;
  observation: Observation;
  canceled: boolean | null;
  filePath: string;
  error: string | null;
  fixtureBefore: FileSnap;
  fixtureAfter: FileSnap;
  fixtureChanged: boolean;
  returnedExists: boolean;
  sameAsFixture: boolean;
  returnedInFixtureDir: boolean;
  existedBefore: boolean;
  otherChanges: string[];
  returnedSnap: FileSnap | null;
}

interface CheckRow {
  id: string;
  pass: boolean;
  detail: string;
}

const MODAL_HTML = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>S-05 modal parent</title></head>
<body><p>This window owns the Save dialog for this case. Use the Save dialog, not this window.</p></body>
</html>
`;

const spikeRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(spikeRoot, '..', '..');
const PAGE_URL = 's05://page/renderer.html';
const PAGE_COLOR = '#F4F1EA';
const PAGE_CSP = [
  "default-src 'none'",
  "script-src s05:",
  "style-src s05:",
  "font-src s05:",
  "img-src s05: data: blob:",
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
  'modal.html': 'text/html; charset=utf-8',
};

// Same privileges as the app: scheme, registered before ready. bypassCSP stays false.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 's05',
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

let outputDir = '';
let reportPath = '';
let fixtureDir = '';
let mainWindow: BrowserWindow | null = null;
let phase: Phase = 'ready';
let index = 0;
let dialogOpen = false;
let dialogsOpened = 0;
let busy = false;
let formError: string | null = null;
let pending: PendingDialog | null = null;
let manualComplete = false;
let finalExitOk: boolean | null = null;
const checks: CheckRow[] = [];
const logs: CaseLog[] = [];
let walkthroughCapture: { ok: true; bytes: number } | { ok: false; error: string } | null = null;
let walkthroughPainted: boolean | null = null;
let saveDialogMode: 'native' | 'stub' = 'native';
let stubbedDialogs = 0;
const pageEvents: string[] = [];

function flag(name: string): string {
  const at = process.argv.indexOf(name);
  const value = at >= 0 ? process.argv[at + 1] : undefined;
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

function appElectronVersion(): string {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
    devDependencies?: { electron?: string };
  };
  const version = pkg.devDependencies?.electron;
  if (!version) throw new Error('The app package.json has no electron devDependency.');
  return version;
}

function addCheck(id: string, pass: boolean, detail: string): void {
  checks.push({ id, pass, detail });
  console.log(`S05 ${pass ? 'pass' : 'fail'} ${id}: ${detail}`);
}

function isPrompt(value: unknown): value is PromptAnswer {
  return typeof value === 'string' && (PROMPTS as readonly string[]).includes(value);
}

function isClick(value: unknown): value is ClickAnswer {
  return typeof value === 'string' && (CLICKS as readonly string[]).includes(value);
}

function parseObservation(body: unknown): Observation | null {
  if (!body || typeof body !== 'object') return null;
  const record = body as Record<string, unknown>;
  if (!isPrompt(record.prompt) || !isClick(record.clicked)) return null;
  const note = typeof record.note === 'string' ? record.note.slice(0, 2000) : '';
  return { prompt: record.prompt, clicked: record.clicked, note };
}

function pathsEqual(left: string, right: string): boolean {
  if (!left || !right) return false;
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function insideDir(filePath: string, dir: string): boolean {
  if (!filePath) return false;
  const relative = path.relative(path.resolve(dir), path.resolve(filePath));
  return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function windowBounds(): { width: number; height: number } {
  const area = screen.getPrimaryDisplay().workAreaSize;
  return {
    width: Math.min(1040, Math.max(720, area.width - 48)),
    height: Math.min(980, Math.max(640, area.height - 48)),
  };
}

function pagePreferences(preload: string | null): WebPreferences {
  return {
    ...(preload ? { preload } : {}),
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

function dialogOptions(built: BuiltSaveOptions): SaveDialogOptions {
  const options: SaveDialogOptions = {
    title: built.title,
    defaultPath: built.defaultPath,
  };
  if (built.filters) options.filters = built.filters;
  if (built.properties) options.properties = built.properties;
  return options;
}

function currentCase(): SaveCase | null {
  return CASES[index] ?? null;
}

function caseView(item: SaveCase): Record<string, unknown> {
  const file = snap(path.join(fixtureDir, item.fileName));
  return {
    id: item.id,
    title: item.title,
    purpose: item.purpose,
    summary: item.summary,
    steps: item.steps,
    watch: item.watch,
    decidesFr12: item.decidesFr12,
    parentText: parentLabel(item.parent),
    filterText: filterLabel(item.filter),
    pathText: pathLabel(item),
    propertiesText: propertiesLabel(item),
    fileName: item.fileName,
    fileExists: file.exists,
    fileBytes: file.size,
    fileSha256: file.sha256,
    typeText: item.typeText ?? null,
  };
}

function dialogView(): Record<string, unknown> | null {
  if (!pending) return null;
  const filePath = pending.result?.filePath ?? '';
  const fixturePath = path.join(fixtureDir, pending.item.fileName);
  const otherChanges = changedNames(pending.before, pending.after).filter((name) => name !== pending?.item.fileName);
  return {
    canceled: pending.result ? pending.result.canceled : null,
    filePath,
    error: pending.error,
    fixtureChanged: fixtureBodyChanged(pending.fixtureBefore, pending.fixtureAfter),
    hashBefore: pending.fixtureBefore.sha256,
    hashAfter: pending.fixtureAfter.sha256,
    returnedExists: Boolean(filePath) && fs.existsSync(filePath),
    sameAsFixture: pathsEqual(filePath, fixturePath),
    otherChanges,
  };
}

function viewState(): Record<string, unknown> {
  const item = phase === 'done' || phase === 'blocked' ? null : currentCase();
  return {
    phase,
    index,
    total: CASES.length,
    electronVersion: process.versions.electron ?? 'unknown',
    platform: process.platform,
    fixtureDir,
    reportPath,
    formError,
    checkErrors: checks.filter((row) => !row.pass).map((row) => `${row.id}: ${row.detail}`),
    manualComplete,
    caseView: item ? caseView(item) : null,
    dialogView: dialogView(),
    progress: logs.map((row) => ({
      id: row.id,
      prompt: row.observation.prompt,
      clicked: row.observation.clicked,
      canceled: row.canceled,
      filePath: row.filePath,
      fixtureChanged: row.fixtureChanged,
    })),
  };
}

function checksPass(): boolean {
  return checks.every((row) => row.pass);
}

function persist(status: 'running' | 'complete' | 'abandoned' | 'check'): void {
  const complete = status === 'complete';
  const ok = status === 'check'
    ? checksPass() && dialogsOpened === 0
    : complete && checksPass();
  const expected = appElectronVersion();
  const body = {
    ok,
    mode: status === 'check' ? 'check' : 'manual',
    dialogsOpened,
    manualComplete: complete,
    electron: {
      version: process.versions.electron ?? null,
      chrome: process.versions.chrome ?? null,
      node: process.versions.node ?? null,
      expected,
    },
    versionMatchesApp: process.versions.electron === expected,
    platform: process.platform,
    arch: process.arch,
    osRelease: os.release(),
    osVersion: os.version(),
    fixtureDir,
    checks,
    cases: CASES.map((item) => ({
      id: item.id,
      title: item.title,
      decidesFr12: item.decidesFr12,
      parent: item.parent,
      filter: item.filter,
      defaultPath: item.defaultPath,
      fileName: item.fileName,
      typeText: item.typeText ?? null,
      properties: item.properties ?? null,
      summary: item.summary,
    })),
    manual: status === 'check' ? null : logs,
    walkthroughPng: fs.existsSync(path.join(outputDir, 'walkthrough.png')),
    walkthroughCapture,
    walkthroughPainted,
  };
  fs.writeFileSync(reportPath, `${JSON.stringify(body, null, 2)}\n`);
  if (status !== 'running') finalExitOk = ok;
}

function assertSender(event: IpcMainInvokeEvent): void {
  if (!mainWindow || event.sender !== mainWindow.webContents) {
    throw new Error('Unknown frame.');
  }
}

async function showCaseDialog(parent: ParentKind, options: SaveDialogOptions): Promise<{ canceled: boolean; filePath: string }> {
  if (parent === 'none') return dialog.showSaveDialog(options);
  if (!mainWindow) throw new Error('The main window is not open.');
  if (parent === 'main') return dialog.showSaveDialog(mainWindow, options);
  const modal = new BrowserWindow({
    parent: mainWindow,
    modal: true,
    width: 520,
    height: 180,
    title: 'S-05 modal parent',
    backgroundColor: PAGE_COLOR,
    webPreferences: pagePreferences(null),
  });
  try {
    await modal.loadURL('s05://page/modal.html');
    modal.setTitle('S-05 modal parent');
    return await dialog.showSaveDialog(modal, options);
  } finally {
    if (!modal.isDestroyed()) modal.destroy();
  }
}

async function openDialog(): Promise<void> {
  if (busy || phase !== 'ready') return;
  const item = currentCase();
  if (!item) return;
  busy = true;
  formError = null;
  try {
    const built = buildOptions(item, fixtureDir);
    const problems = optionErrors(item, built, fixtureDir);
    const before = directorySnap(fixtureDir);
    const fixtureBefore = snap(path.join(fixtureDir, item.fileName));
    console.log(`\nS-05 ${item.id}: opening the Save dialog.`);
    for (const step of item.steps) console.log(`- ${step}`);
    let result: { canceled: boolean; filePath: string } | null = null;
    let error: string | null = problems.length > 0 ? problems.join(' ') : null;
    if (!error) {
      dialogOpen = true;
      try {
        if (saveDialogMode === 'stub') {
          stubbedDialogs += 1;
          result = { canceled: true, filePath: '' };
        } else {
          dialogsOpened += 1;
          result = await showCaseDialog(item.parent, dialogOptions(built));
        }
      } catch (caught) {
        error = caught instanceof Error ? caught.message : String(caught);
      } finally {
        dialogOpen = false;
      }
    }
    const after = directorySnap(fixtureDir);
    const fixtureAfter = snap(path.join(fixtureDir, item.fileName));
    pending = { item, options: built, before, fixtureBefore, result, error, after, fixtureAfter };
    phase = 'asking';
    const changed = fixtureBodyChanged(fixtureBefore, fixtureAfter);
    console.log(
      `S-05 ${item.id}: canceled=${result ? String(result.canceled) : 'none'} filePath=${result?.filePath ?? ''} fixtureChanged=${String(changed)} error=${error ?? ''}`,
    );
  } finally {
    busy = false;
  }
}

function record(body: unknown): void {
  if (phase !== 'asking' || !pending) {
    formError = 'Open the Save dialog before recording an observation.';
    return;
  }
  const observation = parseObservation(body);
  if (!observation) {
    formError = 'Choose what the prompt did and what you clicked.';
    return;
  }
  const filePath = pending.result?.filePath ?? '';
  const fixturePath = path.join(fixtureDir, pending.item.fileName);
  const returnedInFixtureDir = insideDir(filePath, fixtureDir);
  const base = filePath ? path.basename(filePath) : '';
  const prior = base ? pending.before[base] : undefined;
  const otherChanges = changedNames(pending.before, pending.after).filter((name) => name !== pending?.item.fileName);
  logs.push({
    id: pending.item.id,
    title: pending.item.title,
    decidesFr12: pending.item.decidesFr12,
    options: pending.options,
    observation,
    canceled: pending.result ? pending.result.canceled : null,
    filePath,
    error: pending.error,
    fixtureBefore: pending.fixtureBefore,
    fixtureAfter: pending.fixtureAfter,
    fixtureChanged: fixtureBodyChanged(pending.fixtureBefore, pending.fixtureAfter),
    returnedExists: Boolean(filePath) && fs.existsSync(filePath),
    sameAsFixture: pathsEqual(filePath, fixturePath),
    returnedInFixtureDir,
    existedBefore: Boolean(prior?.exists) && returnedInFixtureDir,
    otherChanges,
    returnedSnap: filePath ? snap(filePath) : null,
  });
  pending = null;
  formError = null;
  index += 1;
  if (index >= CASES.length) {
    phase = 'done';
    manualComplete = true;
    persist('complete');
    console.log(`S-05 manual log written: ${reportPath}`);
    console.log('Pass or fail is not decided here. Write it in spikes/s05/README.md.');
    return;
  }
  phase = 'ready';
  persist('running');
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function notePage(line: string): void {
  pageEvents.push(line);
  console.error(line);
}

function attachDiagnostics(contents: WebContents): void {
  contents.on('preload-error', (_event, preloadPath, error) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    notePage(`S05 preload error ${preloadPath}: ${message}`);
  });
  contents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    notePage(`S05 load failed main=${String(isMainFrame)} code=${code} ${description} ${url}`);
  });
  contents.on('render-process-gone', (_event, details) => {
    notePage(`S05 renderer gone reason=${details.reason} exit=${details.exitCode}`);
  });
  contents.on('console-message', (details) => {
    if (details.level !== 'error' && details.level !== 'warning') return;
    notePage(`S05 console ${details.level}: ${details.message} (${details.sourceId}:${details.lineNumber})`);
  });
  contents.on('did-finish-load', () => {
    console.log(`S05 page loaded ${contents.getURL()}`);
  });
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
  protocol.handle('s05', (request) => {
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
    if (!fs.existsSync(filePath)) {
      return pageResponse(404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
    }
    const data = fs.readFileSync(filePath);
    return pageResponse(200, request.method === 'HEAD' ? null : new Uint8Array(data), { 'Content-Type': type });
  });
}

function publishPageFiles(): void {
  for (const name of ['renderer.html', 'renderer.css']) {
    fs.copyFileSync(path.join(spikeRoot, 'src', name), path.join(__dirname, name));
  }
  fs.writeFileSync(path.join(__dirname, 'modal.html'), MODAL_HTML);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>]/g, (ch) => (ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : '&gt;'));
}

function attachDevTools(win: BrowserWindow): void {
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.key !== 'F12' || win.isDestroyed()) return;
    event.preventDefault();
    if (win.webContents.isDevToolsOpened()) win.webContents.closeDevTools();
    else win.webContents.openDevTools({ mode: 'detach' });
  });
  if (process.argv.includes('--devtools')) {
    win.webContents.openDevTools({ mode: 'detach' });
  }
}

function createWalkthroughWindow(quitOnClose: boolean): BrowserWindow {
  const bounds = windowBounds();
  // Shown at creation, with a six-digit background color, and not resized after show.
  // On Windows the caption is the same hidden title bar and overlay the Obelisk window uses.
  const windowsFrame =
    process.platform === 'win32'
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
    title: 'Spike S-05',
    backgroundColor: PAGE_COLOR,
    ...windowsFrame,
    webPreferences: pagePreferences(path.join(__dirname, 'preload.js')),
  });
  mainWindow = win;
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  attachDiagnostics(win.webContents);
  attachDevTools(win);
  win.on('close', (event) => {
    if (dialogOpen) event.preventDefault();
  });
  win.on('closed', () => {
    mainWindow = null;
    if (!quitOnClose) return;
    if (finalExitOk === null) persist('abandoned');
    console.log(finalExitOk
      ? 'S-05 finished.'
      : 'S-05 closed before the last case. The partial log is in the report.');
    app.exit(finalExitOk ? 0 : 1);
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
    await delay(50);
  }
  return last;
}

async function showFailure(win: BrowserWindow, reason: string): Promise<void> {
  const text = ['Spike S-05 could not show the walkthrough.', reason, ...pageEvents].join('\n');
  console.error(text);
  const html = `<!DOCTYPE html><html><body style="background:#f4f1ea;color:#1c1917;font-family:Segoe UI,sans-serif;white-space:pre-wrap;padding:24px;">${escapeHtml(text)}</body></html>`;
  try {
    if (!win.isDestroyed()) {
      await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      win.show();
    }
  } catch (error) {
    console.error(`S05 could not show the failure page: ${error instanceof Error ? error.message : String(error)}`);
    if (!win.isDestroyed()) win.show();
  }
  await recordSurface(win, isManualRun(process.env, process.argv, process.platform));
}

async function openWalkthrough(quitOnClose: boolean): Promise<BrowserWindow> {
  console.log(`S05 opening the walkthrough at ${PAGE_URL}`);
  const win = createWalkthroughWindow(quitOnClose);
  try {
    await win.loadURL(PAGE_URL);
  } catch (error) {
    notePage(`S05 loadURL rejected: ${error instanceof Error ? error.message : String(error)}`);
  }
  return win;
}

async function exerciseWalkthrough(): Promise<void> {
  saveDialogMode = 'stub';
  const win = await openWalkthrough(false);
  try {
    const version = process.versions.electron ?? '';
    const text = await waitForText(win, 'save-obk-parent-existing', 8000);
    const ready = text.includes('save-obk-parent-existing')
      && text.includes('Click Save')
      && text.includes('parent-existing.obk')
      && version.length > 0
      && text.includes(version);
    if (!ready) {
      await showFailure(win, 'Case 1 did not appear in the walkthrough window.');
      addCheck(
        'walkthrough-renders',
        false,
        `The walkthrough did not render. snippet=${text.slice(0, 400)} events=${pageEvents.slice(-4).join(' | ')}`,
      );
      return;
    }
    await logSurface(win);
    const clicked = await win.webContents.executeJavaScript(`
      (() => {
        const button = document.querySelector('button');
        if (!button) return 'missing';
        button.click();
        return 'clicked';
      })()
    `);
    const after = await waitForText(win, 'What the dialog returned', 4000);
    const showedResult = String(clicked) === 'clicked' && after.includes('What the dialog returned') && after.includes('canceled: yes');
    addCheck(
      'walkthrough-renders',
      showedResult,
      showedResult
        ? 'The walkthrough window shows case save-obk-parent-existing, Click Save, and the Electron version. The stubbed Save dialog returned to that same window.'
        : `The walkthrough window did not finish case 1. click=${String(clicked)} snippet=${after.slice(0, 400)}`,
    );
    addCheck(
      'dialog-stub',
      stubbedDialogs === 1 && dialogsOpened === 0,
      stubbedDialogs === 1 && dialogsOpened === 0
        ? 'The check opened the walkthrough and stubbed showSaveDialog once. The native dialog was not opened.'
        : `Stub calls ${stubbedDialogs}, native dialogs ${dialogsOpened}.`,
    );
    if (showedResult) await captureWalkthrough(win);
    addCheck(
      'page-painted',
      walkthroughPainted !== false,
      walkthroughPainted === true
        ? 'The walkthrough window showed the light page background.'
        : walkthroughPainted === false
          ? 'The walkthrough window was a dark frame. The case text was in the page, but it was not visible.'
          : 'capturePage did not return an image. The case text was already in the page.',
    );
  } catch (error) {
    addCheck('walkthrough-renders', false, error instanceof Error ? error.message : String(error));
  } finally {
    saveDialogMode = 'native';
    if (!win.isDestroyed()) win.destroy();
    mainWindow = null;
  }
}

async function openManualWindow(): Promise<void> {
  saveDialogMode = 'native';
  const win = await openWalkthrough(true);
  if (win.isDestroyed()) return;
  const blocked = phase === 'blocked';
  const text = await waitForText(win, blocked ? 'The checks failed' : 'save-obk-parent-existing', 8000);
  const ready = blocked
    ? text.includes('The checks failed')
    : text.includes('save-obk-parent-existing') && text.includes('Click Save');
  if (!ready) {
    await showFailure(
      win,
      blocked
        ? 'The checks failed, and the window did not show that message.'
        : 'Case 1 did not appear in the walkthrough window.',
    );
    return;
  }
  await recordSurface(win, true);
  if (!blocked) console.log('S05 walkthrough is showing save-obk-parent-existing.');
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
    console.log(`S05 could not read the document: ${error instanceof Error ? error.message : String(error)}`);
  }
  const bounds = win.getBounds();
  const content = win.getContentBounds();
  const [contentWidth, contentHeight] = win.getContentSize();
  const display = screen.getDisplayMatching(bounds);
  console.log(`S05 window bounds ${boundsText(bounds)}`);
  console.log(`S05 content bounds ${boundsText(content)}`);
  console.log(
    `S05 content size width=${contentWidth} height=${contentHeight} background=${win.getBackgroundColor()} offscreen=${String(win.webContents.isOffscreen())} offscreenPainting=${String(win.webContents.isPainting())}`,
  );
  console.log(`S05 display scale=${display.scaleFactor} workArea ${boundsText(display.workArea)}`);
  console.log(`S05 document title="${title}" bodyChars=${bodyChars}`);
  if (contentWidth >= 100 && contentHeight >= 100) return;
  const nextWidth = Math.max(bounds.width, 720);
  const nextHeight = Math.max(bounds.height, 640);
  console.log(`S05 content view is too small (${contentWidth}x${contentHeight}). Setting the content size to ${nextWidth}x${nextHeight}.`);
  win.setContentSize(nextWidth, nextHeight);
  const [fixedWidth, fixedHeight] = win.getContentSize();
  console.log(`S05 content bounds after correction ${boundsText(win.getContentBounds())} size width=${fixedWidth} height=${fixedHeight}`);
}

function printCapture(): void {
  const file = path.join(outputDir, 'walkthrough.png');
  if (walkthroughCapture?.ok) {
    console.log(`S05 capturePage wrote ${file} (${walkthroughCapture.bytes} bytes). painted=${String(walkthroughPainted)}`);
    return;
  }
  const reason = walkthroughCapture?.ok === false ? walkthroughCapture.error : 'no capture';
  console.log(`S05 capturePage did not write ${file}: ${reason}`);
}

async function recordSurface(win: BrowserWindow, persistRunning: boolean): Promise<void> {
  await logSurface(win);
  if (!win.isDestroyed()) {
    win.webContents.invalidate();
    console.log('S05 requested a repaint.');
  }
  await captureWalkthrough(win);
  printCapture();
  console.log('S05 press F12 to open DevTools. npm start -- --devtools opens them at launch.');
  if (persistRunning) persist('running');
}

// capturePage can throw UnknownVizError under xvfb after the page text is already readable.
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
        console.log(`S05 capture retry ${attempt + 1}: ${lastError}`);
        continue;
      }
      fs.writeFileSync(file, png);
      walkthroughCapture = { ok: true, bytes: png.length };
      walkthroughPainted = frameLooksLikePage(image);
      return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      console.log(`S05 capture retry ${attempt + 1}: ${lastError}`);
    }
  }
  walkthroughCapture = { ok: false, error: lastError };
  walkthroughPainted = null;
  console.log(`S05 capture failed: ${lastError}`);
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

function runDataChecks(expected: string): void {
  const running = process.versions.electron ?? '';
  addCheck(
    'electron-version',
    running === expected,
    running === expected
      ? `Running Electron ${running} (Chrome ${process.versions.chrome ?? 'unknown'}, Node ${process.versions.node ?? 'unknown'}), matching the app package.`
      : `Running Electron ${running || 'unknown'}, app package asks for ${expected}.`,
  );
  addCheck(
    'dialog-api',
    typeof dialog.showSaveDialog === 'function' && typeof dialog.showSaveDialogSync === 'function',
    'dialog.showSaveDialog and dialog.showSaveDialogSync are both functions.',
  );
  const caseErrors = validateCases();
  addCheck('case-list', caseErrors.length === 0, caseErrors.length === 0 ? `${CASES.length} cases, in the expected order.` : caseErrors.join(' '));
  const readmePath = path.join(spikeRoot, 'README.md');
  const readme = fs.existsSync(readmePath) ? fs.readFileSync(readmePath, 'utf8') : '';
  const notes = readmeErrors(readme, expected);
  addCheck('readme', notes.length === 0, notes.length === 0 ? 'The README names every case, ticks Pass, and leaves Fail unticked.' : notes.join(' '));
  const rendererPath = path.join(spikeRoot, 'src', 'renderer.ts');
  const renderer = fs.readFileSync(rendererPath, 'utf8');
  const importsNode = /from\s+['"]electron['"]|from\s+['"]node:|require\s*\(\s*['"]electron['"]|require\s*\(\s*['"]node:/.test(renderer);
  addCheck(
    'renderer-imports',
    !importsNode,
    importsNode
      ? 'The walkthrough page imports Node or Electron.'
      : 'The walkthrough page does not import Node or Electron.',
  );
  const hashed = selfTest(path.join(outputDir, 'self-test'));
  addCheck('file-change-detection', hashed.pass, hashed.detail);
  const optionProblems = CASES.flatMap((item) => optionErrors(item, buildOptions(item, fixtureDir), fixtureDir));
  addCheck(
    'save-options',
    optionProblems.length === 0,
    optionProblems.length === 0
      ? 'Every defaultPath is absolute, every fixture file exists, and the filters match the cases.'
      : optionProblems.join(' '),
  );
}

function wireIpc(): void {
  ipcMain.handle('s05:get-state', (event) => {
    assertSender(event);
    return viewState();
  });
  ipcMain.handle('s05:open-dialog', async (event) => {
    assertSender(event);
    try {
      await openDialog();
    } catch (error) {
      formError = error instanceof Error ? error.message : String(error);
      phase = 'asking';
    }
    return viewState();
  });
  ipcMain.handle('s05:record', (event, body: unknown) => {
    assertSender(event);
    try {
      record(body);
    } catch (error) {
      formError = error instanceof Error ? error.message : String(error);
    }
    return viewState();
  });
  ipcMain.handle('s05:close', (event) => {
    assertSender(event);
    if (phase === 'done') mainWindow?.close();
    return viewState();
  });
}

async function run(): Promise<void> {
  outputDir = path.resolve(flag('--output'));
  reportPath = path.resolve(flag('--report'));
  fixtureDir = path.join(outputDir, 'fixtures');
  const manual = isManualRun(process.env, process.argv, process.platform);
  Menu.setApplicationMenu(null);
  installPageSecurity();
  installPageProtocol();
  fs.mkdirSync(outputDir, { recursive: true });
  publishPageFiles();
  fs.writeFileSync(path.join(outputDir, 'modal.html'), MODAL_HTML);
  fs.writeFileSync(path.join(outputDir, 'steps.txt'), stepsText(CASES));
  fs.rmSync(fixtureDir, { recursive: true, force: true });
  writeFixtures(fixtureDir, CASES);
  const expected = appElectronVersion();
  runDataChecks(expected);
  wireIpc();
  if (!manual) {
    await exerciseWalkthrough();
    addCheck(
      'dialogs-not-opened',
      dialogsOpened === 0,
      `showSaveDialog was called ${dialogsOpened} time(s). The check run must not open a Save dialog.`,
    );
    fs.rmSync(fixtureDir, { recursive: true, force: true });
    persist('check');
    console.log(`S05 report ${reportPath} ok=${String(finalExitOk === true)} dialogsOpened=${dialogsOpened}`);
    app.exit(finalExitOk ? 0 : 1);
    return;
  }
  if (!checksPass()) phase = 'blocked';
  persist('running');
  await openManualWindow();
}

app.on('window-all-closed', () => {
  console.log('S05 windows closed.');
});

app.whenReady().then(() => {
  run().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    app.exit(1);
  });
});
