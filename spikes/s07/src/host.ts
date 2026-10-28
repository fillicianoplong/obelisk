import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  protocol,
  screen,
  session,
  type IpcMainInvokeEvent,
  type NativeImage,
  type Rectangle,
  type WebContents,
} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { phaseFrom, type Phase } from './mode';
import { sha256, signaturePlaintext } from './payload';
import type { CaptureNote, CheckRow, SpikeReport } from './report';
import { decryptSample, encryptSample, probeSample, type CryptoResult } from './safe';

const PAGE_URL = 's07://page/renderer.html';
const PAGE_COLOR = '#F4F1EA';
const PAGE_CSP = [
  "default-src 'none'",
  'script-src s07:',
  'style-src s07:',
  'font-src s07:',
  'img-src s07: data: blob:',
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
const CIPHER_NAME = 'cipher.bin';
const USER_CIPHER_NAME = 'signature.sig';

protocol.registerSchemesAsPrivileged([
  {
    scheme: 's07',
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

app.setName('Obelisk Spike S-07');
Menu.setApplicationMenu(null);

interface ViewState {
  phase: string;
  headline: string;
  doing: string;
  electronVersion: string;
  packaged: boolean;
  windowsStore: boolean;
  rows: Array<{ name: string; value: string }>;
  reportPath: string;
  banner: string;
  manual: boolean;
}

let outputDir = '';
let reportPath = '';
let phase: Phase = 'manual';
let doing = 'Opening the window.';
let rows: Array<{ name: string; value: string }> = [];
let walkthroughCapture: CaptureNote | null = null;
let walkthroughPainted: boolean | null = null;
let finished = false;
let finalExitOk: boolean | null = null;
const checks: CheckRow[] = [];
const pageEvents: string[] = [];

function windowsStore(): boolean {
  const record = process as NodeJS.Process & { windowsStore?: boolean };
  return record.windowsStore === true;
}

function expectedElectron(): string {
  const fromEnv = process.env.OBELISK_S07_EXPECT_ELECTRON;
  if (fromEnv) return fromEnv.trim();
  const buildFile = path.join(__dirname, 'build.json');
  try {
    const built = JSON.parse(fs.readFileSync(buildFile, 'utf8')) as { electron?: string };
    if (built.electron) return built.electron;
  } catch {
    // Unpackaged launches read the repo package.json below.
  }
  const candidates = [
    path.resolve(__dirname, '..', '..', '..', 'package.json'),
    path.resolve(__dirname, '..', '..', 'package.json'),
  ];
  for (const file of candidates) {
    try {
      const pkg = JSON.parse(fs.readFileSync(file, 'utf8')) as { devDependencies?: { electron?: string } };
      if (pkg.devDependencies?.electron) return pkg.devDependencies.electron;
    } catch {
      continue;
    }
  }
  return '45.0.0';
}

function resolveOutput(): string {
  const at = process.argv.indexOf('--output');
  const fromArg = at >= 0 ? process.argv[at + 1] : undefined;
  if (fromArg) return path.resolve(fromArg);
  const fromEnv = process.env.OBELISK_S07_OUTPUT;
  if (fromEnv) return path.resolve(fromEnv);
  return path.join(app.getPath('documents'), 'Obelisk-Spike-S07', 'reports');
}

function addCheck(id: string, pass: boolean, detail: string): void {
  checks.push({ id, pass, detail });
  console.log(`S07 ${pass ? 'pass' : 'fail'} ${id}: ${detail}`);
}

function checksPass(): boolean {
  return checks.length > 0 && checks.every((item) => item.pass);
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
    rows,
    reportPath,
    banner: 'This is Obelisk Spike S-07. It is not Obelisk.Dev.',
    manual: phase === 'manual',
  };
}

function setRows(result: CryptoResult | null, extra: Array<{ name: string; value: string }>): void {
  const base = result
    ? [
      { name: 'isEncryptionAvailable', value: String(result.encryptionAvailable) },
      { name: 'isAsyncEncryptionAvailable', value: String(result.asyncEncryptionAvailable) },
      { name: 'sessionEncryption', value: String(result.sessionEncryption) },
      { name: 'plaintextMatch', value: String(result.plaintextMatch) },
      { name: 'shouldReEncrypt', value: String(result.shouldReEncrypt) },
      { name: 'temporarilyUnavailable', value: String(result.temporarilyUnavailable) },
      { name: 'encryptError', value: result.encryptError ?? '' },
      { name: 'decryptError', value: result.decryptError ?? '' },
      { name: 'leaks', value: result.leaks.join(', ') },
    ]
    : [];
  rows = [...base, ...extra];
}

function notePage(line: string): void {
  pageEvents.push(line);
  console.error(line);
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
  protocol.handle('s07', (request) => {
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

function attachDiagnostics(contents: WebContents): void {
  contents.on('preload-error', (_event, preloadPath, error) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    notePage(`S07 preload error ${preloadPath}: ${message}`);
  });
  contents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    if (!isMainFrame) return;
    notePage(`S07 load failed code=${code} ${description} ${url}`);
  });
  contents.on('render-process-gone', (_event, details) => {
    notePage(`S07 renderer gone reason=${details.reason} exit=${details.exitCode}`);
  });
  contents.on('did-finish-load', () => {
    console.log(`S07 page loaded ${contents.getURL()}`);
  });
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

function createWindow(): BrowserWindow {
  const area = screen.getPrimaryDisplay().workAreaSize;
  const windowsFrame = process.platform === 'win32'
    ? {
      titleBarStyle: 'hidden' as const,
      titleBarOverlay: { color: PAGE_COLOR, symbolColor: '#1C1917', height: 32 },
    }
    : {};
  const win = new BrowserWindow({
    width: Math.min(1040, Math.max(720, area.width - 48)),
    height: Math.min(900, Math.max(640, area.height - 48)),
    title: 'Spike S-07',
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
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  attachDiagnostics(win.webContents);
  attachDevTools(win);
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
    await new Promise((resolve) => setTimeout(resolve, 50));
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
  console.log(`S07 window bounds ${boundsText(bounds)}`);
  console.log(`S07 content bounds ${boundsText(content)}`);
  console.log(`S07 content size width=${contentWidth} height=${contentHeight} background=${win.getBackgroundColor()} offscreen=${String(win.webContents.isOffscreen())}`);
  console.log(`S07 display scale=${display.scaleFactor}`);
  const text = await pageText(win).catch(() => '');
  console.log(`S07 document chars=${text.length}`);
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

async function capture(win: BrowserWindow, fileName: string): Promise<CaptureNote> {
  let lastError = 'capturePage did not run';
  const file = path.join(outputDir, fileName);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 200 : 400));
    try {
      const image = await win.capturePage();
      const png = image.toPNG();
      if (png.length < 100) {
        lastError = 'capturePage returned an empty image';
        continue;
      }
      fs.writeFileSync(file, png);
      if (fileName === 'walkthrough.png') walkthroughPainted = frameLooksLikePage(image);
      console.log(`S07 capturePage wrote ${file} (${png.length} bytes).`);
      return { ok: true, bytes: png.length };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      console.log(`S07 capture retry ${attempt + 1}: ${lastError}`);
    }
  }
  return { ok: false, error: lastError };
}

function cipherPath(): string {
  return path.join(outputDir, CIPHER_NAME);
}

function userCipherPath(): string {
  return path.join(app.getPath('userData'), USER_CIPHER_NAME);
}

function readCipher(file: string): Buffer | null {
  if (!fs.existsSync(file)) return null;
  return fs.readFileSync(file);
}

function writeCipher(file: string, bytes: Buffer): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
}

function localStateInfo(): { path: string; exists: boolean; bytes: number } {
  const file = path.join(app.getPath('userData'), 'Local State');
  try {
    const info = fs.statSync(file);
    const exists = info.isFile();
    return { path: file, exists, bytes: exists ? info.size : 0 };
  } catch {
    return { path: file, exists: false, bytes: 0 };
  }
}

function folderListing(dir: string): string {
  try {
    const names = fs.readdirSync(dir);
    return names.length === 0 ? 'empty' : names.slice(0, 12).join(', ');
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

async function waitForLocalState(timeoutMs: number): Promise<{ path: string; exists: boolean; bytes: number }> {
  const started = Date.now();
  let info = localStateInfo();
  while (!info.exists && Date.now() - started < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    info = localStateInfo();
  }
  return info;
}

function persist(
  ok: boolean,
  result: CryptoResult | null,
  restart: boolean | null,
  cipherUnchanged: boolean | null,
  stateFile: { path: string; exists: boolean; bytes: number },
): void {
  const outputCipher = readCipher(cipherPath());
  const userCipher = readCipher(userCipherPath());
  const report: SpikeReport = {
    spike: 'S-07',
    phase,
    ok,
    packaged: app.isPackaged,
    windowsStore: windowsStore(),
    electron: {
      version: process.versions.electron ?? '',
      chrome: process.versions.chrome ?? '',
      node: process.versions.node ?? '',
    },
    expectedElectron: expectedElectron(),
    userData: app.getPath('userData'),
    localState: stateFile.path,
    localStateExists: stateFile.exists,
    localStateBytes: stateFile.bytes,
    encryptionAvailable: result?.encryptionAvailable ?? null,
    asyncEncryptionAvailable: result?.asyncEncryptionAvailable ?? null,
    deprecationWarnings: result?.deprecationWarnings ?? [],
    syncRoundTrip: result?.syncRoundTrip ?? null,
    syncError: result?.syncError ?? null,
    sessionEncryption: result?.sessionEncryption ?? null,
    plaintextMatch: result?.plaintextMatch ?? null,
    shouldReEncrypt: result?.shouldReEncrypt ?? null,
    secondShouldReEncrypt: result?.secondShouldReEncrypt ?? null,
    encryptError: result?.encryptError ?? null,
    decryptError: result?.decryptError ?? null,
    temporarilyUnavailable: result?.temporarilyUnavailable ?? false,
    unencryptedDecryptError: result?.unencryptedDecryptError ?? null,
    leaks: result?.leaks ?? [],
    cipherSha256: outputCipher ? sha256(outputCipher) : null,
    userDataCipherSha256: userCipher ? sha256(userCipher) : null,
    plainSha256: sha256(Buffer.from(signaturePlaintext(), 'utf8')),
    restart,
    cipherUnchanged,
    checks,
    walkthroughPng: walkthroughCapture,
    walkthroughPainted,
    reportPath,
    argv: process.argv.slice(),
    pageEvents: pageEvents.slice(-12),
  };
  fs.mkdirSync(outputDir, { recursive: true });
  const body = `${JSON.stringify(report, null, 2)}\n`;
  fs.writeFileSync(reportPath, body);
  fs.writeFileSync(path.join(outputDir, 'spike-report.json'), body);
}

function hashFile(file: string): string | null {
  const bytes = readCipher(file);
  return bytes ? sha256(bytes) : null;
}

async function runPhase(): Promise<{ result: CryptoResult; restart: boolean | null; cipherUnchanged: boolean | null }> {
  if (phase === 'decrypt') {
    const stored = readCipher(cipherPath());
    const userStored = readCipher(userCipherPath());
    if (!stored) {
      const result = await probeSample(null);
      result.sessionEncryption = false;
      result.plaintextMatch = null;
      addCheck('restart', true, 'No ciphertext file. The encrypt launch did not store one.');
      setRows(result, [{ name: 'restart', value: 'skipped' }]);
      return { result, restart: null, cipherUnchanged: true };
    }
    if (!userStored) {
      const result = await decryptSample(stored);
      addCheck('restart', false, 'signature.sig is missing from userData.');
      setRows(result, [{ name: 'restart', value: 'no' }]);
      return { result, restart: false, cipherUnchanged: true };
    }
    const beforeOutput = sha256(stored);
    const beforeUser = sha256(userStored);
    const result = await decryptSample(stored);
    const userResult = await decryptSample(userStored);
    const unchanged = hashFile(cipherPath()) === beforeOutput && hashFile(userCipherPath()) === beforeUser;
    const match = result.plaintextMatch === true && userResult.plaintextMatch === true && result.leaks.length === 0;
    if (result.shouldReEncrypt === null) result.shouldReEncrypt = userResult.shouldReEncrypt;
    addCheck('restart', match, match
      ? 'The ciphertext decrypted to the same signature after the process restarted.'
      : `Restart decrypt failed. output=${String(result.plaintextMatch)} userData=${String(userResult.plaintextMatch)} ${result.decryptError ?? ''}`);
    addCheck('cipher-unchanged', unchanged, unchanged ? 'Decrypt left the ciphertext files in place.' : 'Decrypt changed a ciphertext file.');
    if (result.shouldReEncrypt === true && result.reencrypted) {
      writeCipher(path.join(outputDir, 'reencrypted.bin'), result.reencrypted);
    }
    addCheck(
      'should-reencrypt-recorded',
      typeof result.shouldReEncrypt === 'boolean',
      `shouldReEncrypt=${String(result.shouldReEncrypt)}`,
    );
    setRows(result, [
      { name: 'restart', value: match ? 'yes' : 'no' },
      { name: 'userDataMatch', value: String(userResult.plaintextMatch) },
    ]);
    return { result, restart: match, cipherUnchanged: unchanged };
  }

  if (phase === 'probe') {
    const beforeOutput = hashFile(cipherPath());
    const beforeUser = hashFile(userCipherPath());
    const stored = readCipher(cipherPath());
    const result = await probeSample(stored);
    const afterOutput = hashFile(cipherPath());
    const afterUser = hashFile(userCipherPath());
    const unchanged = beforeOutput === afterOutput && beforeUser === afterUser;
    addCheck('cipher-unchanged', unchanged, unchanged ? 'The probe did not write or delete a ciphertext.' : 'The probe changed a ciphertext file.');
    addCheck(
      'availability-recorded',
      typeof result.encryptionAvailable === 'boolean' && typeof result.asyncEncryptionAvailable === 'boolean',
      `isEncryptionAvailable=${String(result.encryptionAvailable)} isAsyncEncryptionAvailable=${String(result.asyncEncryptionAvailable)}`,
    );
    setRows(result, [{ name: 'cipherUnchanged', value: unchanged ? 'yes' : 'no' }]);
    return { result, restart: null, cipherUnchanged: unchanged };
  }

  const result = await encryptSample();
  if (result.cipher && result.sessionEncryption) {
    writeCipher(cipherPath(), result.cipher);
    writeCipher(userCipherPath(), result.cipher);
  }
  const roundTripOk = result.sessionEncryption === true && result.plaintextMatch === true && result.leaks.length === 0;
  if (roundTripOk) {
    addCheck('round-trip', true, 'encryptStringAsync and decryptStringAsync returned the signature, and the ciphertext has no readable name or PNG.');
  } else if (result.cipher && result.plaintextMatch === false) {
    addCheck('round-trip', false, `The decrypt did not match. ${result.decryptError ?? result.encryptError ?? ''}`);
  } else if (result.leaks.length > 0) {
    addCheck('round-trip', false, `The ciphertext still holds ${result.leaks.join(', ')}.`);
  } else {
    addCheck('round-trip', true, `Encryption did not complete. ${result.encryptError ?? result.decryptError ?? 'no error text'}`);
  }
  addCheck(
    'availability-recorded',
    typeof result.encryptionAvailable === 'boolean' && typeof result.asyncEncryptionAvailable === 'boolean',
    `isEncryptionAvailable=${String(result.encryptionAvailable)} isAsyncEncryptionAvailable=${String(result.asyncEncryptionAvailable)}`,
  );
  if (result.sessionEncryption) {
    addCheck(
      'should-reencrypt-recorded',
      typeof result.shouldReEncrypt === 'boolean',
      `shouldReEncrypt=${String(result.shouldReEncrypt)}`,
    );
  }
  setRows(result, [{ name: 'restart', value: 'not this process' }]);
  return { result, restart: null, cipherUnchanged: null };
}

function wireIpc(): void {
  ipcMain.handle('s07:get-state', () => viewState());
  ipcMain.handle('s07:close', async (event: IpcMainInvokeEvent) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) win.close();
    return viewState();
  });
}

async function openWindow(): Promise<BrowserWindow> {
  console.log(`S07 opening the window at ${PAGE_URL}`);
  const win = createWindow();
  try {
    await win.loadURL(PAGE_URL);
  } catch (error) {
    notePage(`S07 loadURL rejected: ${error instanceof Error ? error.message : String(error)}`);
  }
  return win;
}

function leave(code: number): void {
  finalExitOk = code === 0;
  setTimeout(() => {
    app.exit(code);
  }, 400);
}

async function run(): Promise<void> {
  phase = phaseFrom(process.env, process.argv);
  outputDir = resolveOutput();
  reportPath = path.join(outputDir, `report-${phase}.json`);
  fs.mkdirSync(outputDir, { recursive: true });
  console.log(`S07 phase=${phase} packaged=${String(app.isPackaged)} windowsStore=${String(windowsStore())} output=${outputDir}`);
  console.log(`S07 argv ${process.argv.join(' | ')}`);
  const expected = expectedElectron();
  addCheck(
    'electron-version',
    process.versions.electron === expected,
    `Electron ${process.versions.electron ?? 'missing'}, expected ${expected}.`,
  );
  if (app.isPackaged) {
    addCheck('windows-store', windowsStore(), windowsStore()
      ? 'process.windowsStore is true.'
      : 'process.windowsStore is not true.');
  }
  publishPageFiles();
  installPageSecurity();
  installPageProtocol();
  wireIpc();
  const win = await openWindow();
  const opened = await waitForText(win, 'Spike S-07', 8000);
  addCheck('window-text', opened.includes('Spike S-07'), opened.includes('Spike S-07')
    ? 'The window showed Spike S-07.'
    : `The window did not show Spike S-07. snippet=${opened.slice(0, 300)}`);
  await logSurface(win);
  await waitForText(win, 'Electron', 8000);
  walkthroughCapture = await capture(win, 'walkthrough.png');

  let result: CryptoResult | null = null;
  let restart: boolean | null = null;
  let cipherUnchanged: boolean | null = null;
  try {
    const outcome = await runPhase();
    result = outcome.result;
    restart = outcome.restart;
    cipherUnchanged = outcome.cipherUnchanged;
  } catch (error) {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    notePage(`S07 run failed: ${message}`);
    addCheck('safe-storage', false, message.split('\n')[0] ?? message);
  }

  doing = 'The run is written down.';
  if (!win.isDestroyed()) await waitForText(win, 'written down', 8000);
  const again = await capture(win, 'walkthrough.png');
  if (again.ok) walkthroughCapture = again;
  addCheck(
    'page-painted',
    walkthroughPainted === true,
    walkthroughPainted === true
      ? 'The window showed the light page background.'
      : walkthroughCapture?.ok
        ? 'capturePage returned an image that was not the light page.'
        : `capturePage failed. ${walkthroughCapture?.error ?? ''}`,
  );
  // Chromium commits Local State on a timer, and again when the process exits.
  // The encrypt launch can finish before the file is on disk. The restart is a
  // new process, so by then the file has to be there.
  const waitForKey = ((phase === 'encrypt' || phase === 'manual') && result?.sessionEncryption === true)
    || (phase === 'decrypt' && restart === true);
  const stateFile = waitForKey ? await waitForLocalState(15000) : localStateInfo();
  const mustExistNow = phase === 'decrypt' && restart === true;
  const stateDetail = stateFile.exists
    ? `Local State is ${stateFile.bytes} bytes at ${stateFile.path}.`
    : `Local State was not on disk yet at ${stateFile.path}. Folder: ${folderListing(path.dirname(stateFile.path))}.`;
  addCheck('local-state', !mustExistNow || stateFile.exists, stateDetail);

  finished = true;
  const ok = checksPass();
  persist(ok, result, restart, cipherUnchanged, stateFile);
  console.log(`S07 report ${reportPath} ok=${String(ok)} phase=${phase} packaged=${String(app.isPackaged)}`);
  if (phase === 'manual') return;
  leave(ok ? 0 : 1);
}

app.on('window-all-closed', () => {
  if (finished && phase === 'manual') app.exit(finalExitOk === false ? 1 : 0);
});

app.whenReady().then(() => {
  run().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    try {
      if (outputDir) persist(false, null, null, null, localStateInfo());
    } catch {
      // The report is best-effort once the run has already failed.
    }
    app.exit(1);
  });
});
