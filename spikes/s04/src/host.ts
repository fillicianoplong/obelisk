import { app, BrowserWindow, protocol, session, type WebContents } from 'electron';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { readAppContentSecurityPolicy } from './app-csp.js';
import {
  findDiagram,
  findFormula,
  flowchartReadable,
  formulaReadable,
  type LoggedRequest,
  type PageReport,
} from './judge.js';
import {
  hashAttributePolicy,
  hashElementPolicy,
  blobStylesheetPolicy,
  noncePolicy,
  POLICY_SPECS,
  policyHeader,
} from './policies.js';

interface PageRun {
  id: string;
  mode: string;
  policy: string;
  layout: string | null;
  report: PageReport | null;
  error: string | null;
  requests: LoggedRequest[];
}

function flag(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) {
    throw new Error(`missing ${name}`);
  }
  return value;
}

function repoRoot(): string {
  return path.resolve(__dirname, '..', '..', '..');
}

function spikeRoot(): string {
  return path.resolve(__dirname, '..');
}

const MIME: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.otf': 'font/otf',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function resolveUnder(root: string, requestUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'app:' || url.hostname !== 'obelisk') {
    return null;
  }
  const segments = decodeURIComponent(url.pathname).replace(/^\/+/, '').split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    return null;
  }
  const candidate = path.resolve(root, ...segments);
  const relative = path.relative(root, candidate);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return null;
  }
  return candidate;
}

function shorten(raw: string): string {
  if (raw.startsWith('data:')) {
    return `data:${raw.slice(5, 48)} (${raw.length} chars)`;
  }
  return raw.length > 300 ? `${raw.slice(0, 300)}…` : raw;
}

let activePolicy = '';
const requests: LoggedRequest[] = [];
let preloadLine: string | null = null;

function installProtocol(root: string): void {
  protocol.handle('app', async (request) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405 });
    }
    const file = resolveUnder(root, request.url);
    if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
    const headers: Record<string, string> = {
      'Content-Type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
    };
    if (path.basename(file) === 'index.html') {
      headers['Content-Security-Policy'] = activePolicy;
    }
    requests.push({
      url: shorten(request.url),
      method: request.method,
      resourceType: 'app',
      cancelled: false,
    });
    const data =
      request.method === 'HEAD' ? null : new Uint8Array(await fs.promises.readFile(file));
    return new Response(data, { status: 200, headers });
  });
}

function installSession(): void {
  const ses = session.defaultSession;
  // Do not intercept app: here. Electron can deadlock when onBeforeRequest
  // filters a scheme served by protocol.handle. app: is recorded in the handler.
  ses.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*', 'file://*/*', 'ftp://*/*'] },
    (details, callback) => {
      requests.push({
        url: shorten(details.url),
        method: details.method,
        resourceType: details.resourceType,
        cancelled: true,
      });
      console.log(`S04_REQ block ${details.resourceType} ${shorten(details.url)}`);
      callback({ cancel: true });
    },
  );
  ses.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false);
  });
  ses.setPermissionCheckHandler(() => false);
  ses.setDevicePermissionHandler(() => false);
}

function installGuards(): void {
  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', (event) => {
      event.preventDefault();
    });
    contents.on('will-redirect', (event) => {
      event.preventDefault();
    });
    contents.on('will-frame-navigate', (event) => {
      event.preventDefault();
    });
    contents.on('will-attach-webview', (event) => {
      event.preventDefault();
    });
  });
}

function waitForDone(contents: WebContents, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      contents.removeListener('console-message', onMessage);
      reject(new Error('Timed out waiting for the renderer report.'));
    }, timeoutMs);
    const onMessage = (details: { message: string }) => {
      logConsole(details);
      if (details.message.startsWith('S04_PRELOAD ')) {
        preloadLine = details.message.slice('S04_PRELOAD '.length);
      }
      if (details.message.startsWith('S04_DONE')) {
        clearTimeout(timer);
        contents.removeListener('console-message', onMessage);
        resolve();
      }
    };
    contents.on('console-message', onMessage);
  });
}

function logConsole(details: { message: string }): void {
  if (details.message.startsWith('S04_')) {
    console.log(details.message.slice(0, 500));
  }
}

async function runPage(
  window: BrowserWindow,
  id: string,
  mode: string,
  policy: string,
  layout: string | null,
  nonce: string | null,
  policyLabel: string,
): Promise<PageRun> {
  requests.length = 0;
  activePolicy = policy;
  const params = new URLSearchParams({ csp: id, mode, policyLabel });
  if (layout) {
    params.set('layout', layout);
  }
  if (nonce) {
    params.set('nonce', nonce);
  }
  const done = waitForDone(window.webContents, mode === 'full' ? 180_000 : 90_000);
  window.webContents.once('did-finish-load', () => {
    console.log(`S04_LOADED ${id}`);
  });
  window.webContents.once('did-fail-load', (_event, code, description, url) => {
    console.log(`S04_FAIL_LOAD ${id} ${code} ${description} ${url}`);
  });
  const loadTimeout = new Promise<never>((_resolve, reject) => {
    setTimeout(() => reject(new Error(`loadURL timed out for ${id}`)), 20_000);
  });
  try {
    await Promise.race([window.loadURL(`app://obelisk/index.html?${params.toString()}`), loadTimeout]);
  } catch (error) {
    console.log(`S04_LOAD_ERROR ${id} ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    await done;
  } catch (error) {
    return {
      id,
      mode,
      policy,
      layout,
      report: null,
      error: error instanceof Error ? error.message : String(error),
      requests: requests.slice(),
    };
  }
  const report = (await window.webContents.executeJavaScript('globalThis.__s04Report')) as PageReport | undefined;
  return {
    id,
    mode,
    policy,
    layout,
    report: report ?? null,
    error: report?.fatal ?? null,
    requests: requests.slice(),
  };
}

function namedPolicy(appPolicy: string, id: string): string {
  const spec = POLICY_SPECS.find((item) => item.id === id);
  if (!spec) {
    throw new Error(`unknown policy ${id}`);
  }
  return policyHeader(appPolicy, spec.styleDirectives);
}

function flowchartStyleText(report: PageReport | null): string[] {
  const diagram = report ? findDiagram(report, 'flowchart') : undefined;
  return (diagram?.styleElements ?? []).map((style) => style.text).filter((text): text is string => Boolean(text));
}

function fractionAttributes(report: PageReport | null): string[] {
  const formula = report ? findFormula(report, 'fraction') : undefined;
  return formula?.styleAttributes ?? [];
}

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text).digest('base64');
}

async function capture(
  window: BrowserWindow,
  file: string,
): Promise<{ width: number; height: number; bytes: number } | { error: string }> {
  let lastError = 'capturePage did not run';
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 250 : 400));
    try {
      const image = await window.webContents.capturePage();
      const png = image.toPNG();
      if (png.length < 100) {
        lastError = 'capturePage returned an empty image';
        console.log(`S04_CAPTURE_RETRY ${attempt + 1} ${lastError}`);
        continue;
      }
      await fs.promises.writeFile(file, png);
      const size = image.getSize();
      return { width: size.width, height: size.height, bytes: png.length };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      console.log(`S04_CAPTURE_RETRY ${attempt + 1} ${lastError}`);
    }
  }
  console.log(`S04_CAPTURE_FAILED ${lastError}`);
  return { error: lastError };
}

function windowOptions() {
  return {
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

async function main(): Promise<void> {
  const reportPath = flag('--report');
  const appPolicy = readAppContentSecurityPolicy(repoRoot());
  const baselinePolicy = namedPolicy(appPolicy, 'baseline');
  if (baselinePolicy !== appPolicy) {
    throw new Error(`The spike baseline does not match the app CSP.\nApp: ${appPolicy}\nSpike: ${baselinePolicy}`);
  }
  const www = path.join(spikeRoot(), 'dist', 'www');
  installProtocol(www);
  installSession();

  const window = new BrowserWindow({
    width: 1040,
    height: 860,
    show: true,
    backgroundColor: '#ffffff',
    webPreferences: {
      ...windowOptions(),
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  const runs: PageRun[] = [];
  const baseline = await runPage(window, 'baseline', 'full', baselinePolicy, null, null, 'style-src app:');
  runs.push(baseline);

  let layoutRetry: string | null = null;
  const baselineDiagrams = baseline.report?.diagrams ?? [];
  const diagramErrors = baselineDiagrams.filter((diagram) => !diagram.ok && diagram.error);
  if (
    baseline.report &&
    baselineDiagrams.length > 0 &&
    diagramErrors.length === baselineDiagrams.filter((diagram) => !diagram.id.startsWith('classdef')).length &&
    diagramErrors.some((diagram) => /elk|worker|layout/i.test(diagram.error ?? ''))
  ) {
    layoutRetry = 'dagre';
    runs.push(await runPage(window, 'baseline-dagre', 'full', baselinePolicy, 'dagre', null, 'style-src app:'));
  }

  const styledSource = [...runs].reverse().find((run) => run.report && flowchartStyleText(run.report).length > 0)?.report ?? null;
  const attributeSource = [...runs].reverse().find((run) => fractionAttributes(run.report).length > 0)?.report ?? null;
  const baselineFacts = baseline.report;
  const flowOk = flowchartReadable(baselineFacts ? findDiagram(baselineFacts, 'flowchart') : undefined);
  const fractionOk = formulaReadable(
    baselineFacts ? (findFormula(baselineFacts, 'fraction') ?? findFormula(baselineFacts, 'fraction-both')) : undefined,
  );

  if (!flowOk || !fractionOk) {
    for (const spec of POLICY_SPECS) {
      if (spec.id === 'baseline') {
        continue;
      }
      runs.push(
        await runPage(
          window,
          spec.id,
          'canary',
          policyHeader(appPolicy, spec.styleDirectives),
          layoutRetry,
          null,
          spec.styleDirectives.join('; '),
        ),
      );
    }
  }

  const nonce = crypto.randomBytes(16).toString('hex');
  if (!flowOk || !fractionOk) {
    runs.push(await runPage(window, 'nonce-inner', 'nonce-inner', noncePolicy(appPolicy, nonce), layoutRetry, nonce, `style nonce ${nonce}`));
    runs.push(
      await runPage(
        window,
        'nonce-reattach',
        'nonce-reattach',
        noncePolicy(appPolicy, nonce),
        layoutRetry,
        nonce,
        `reattached style nonce ${nonce}`,
      ),
    );
  }

  const styleText = flowchartStyleText(styledSource);
  if (styleText.length > 0) {
    const hashes = styleText.map(sha256);
    runs.push(
      await runPage(
        window,
        'hash-elements',
        'canary',
        hashElementPolicy(appPolicy, hashes),
        layoutRetry,
        null,
        `style-src-elem hashes (${hashes.length})`,
      ),
    );
  }

  if (!flowOk || !fractionOk) {
    const elemOnly = policyHeader(appPolicy, ["style-src-elem app: 'unsafe-inline'", "style-src-attr 'none'"]);
    runs.push(await runPage(window, 'rewrite-elem', 'rewrite', elemOnly, layoutRetry, null, "rewritten attributes, style-src-elem 'unsafe-inline'"));
    runs.push(
      await runPage(
        window,
        'rewrite-blob',
        'rewrite-blob',
        blobStylesheetPolicy(appPolicy),
        layoutRetry,
        null,
        'rewritten attributes, style-src-elem app: blob:',
      ),
    );
    runs.push(
      await runPage(
        window,
        'rewrite-nonce',
        'rewrite-nonce',
        noncePolicy(appPolicy, nonce),
        layoutRetry,
        nonce,
        'rewritten attributes, nonce on the stylesheet',
      ),
    );
    runs.push(await runPage(window, 'rewrite-baseline', 'rewrite', baselinePolicy, layoutRetry, null, 'rewritten attributes, style-src app:'));
  }

  const attributes = fractionAttributes(attributeSource);
  if (attributes.length > 0) {
    const hashes = [...new Set(attributes)].map(sha256);
    runs.push(
      await runPage(
        window,
        'hash-attributes',
        'canary',
        hashAttributePolicy(appPolicy, hashes),
        layoutRetry,
        null,
        `style-src-attr hashes (${hashes.length})`,
      ),
    );
  }

  const winner = chooseWinner(runs);
  const winnerPolicy = policyForRun(appPolicy, winner, runs, nonce);
  const gallery = await runPage(window, `${winner}-gallery`, 'gallery', winnerPolicy.policy, layoutRetry, winnerPolicy.nonce, winnerPolicy.label);
  runs.push(gallery);
  const captured = await capture(window, path.join(path.dirname(reportPath), 'sample.png'));
  const screenshot = 'error' in captured ? { width: 0, height: 0, bytes: 0, error: captured.error } : captured;

  const payload = {
    harnessOk: runs.every((run) => run.report && !run.report.fatal) && decisionCheckPassed(runs),
    appPolicy,
    policiesMatch: appPolicy === baselinePolicy,
    windowOptions: windowOptions(),
    preload: preloadLine ? (JSON.parse(preloadLine) as unknown) : null,
    metrics: app.getAppMetrics().map((metric) => ({
      pid: metric.pid,
      type: metric.type,
      name: metric.name,
      serviceName: metric.serviceName,
      sandboxed: metric.sandboxed ?? null,
      integrityLevel: metric.integrityLevel ?? null,
    })),
    host: {
      electron: process.versions.electron ?? null,
      chrome: process.versions.chrome ?? null,
      node: process.versions.node,
      platform: process.platform,
      noSandbox: process.argv.includes('--no-sandbox'),
    },
    layoutRetry,
    runs,
    screenshot: { ...screenshot, policyId: winner, label: winnerPolicy.label },
  };
  await fs.promises.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.promises.writeFile(reportPath, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`S04_HOST_DONE harnessOk=${payload.harnessOk} screenshotPolicy=${winner}`);
  app.exit(payload.harnessOk ? 0 : 1);
}

function decisionCheckPassed(runs: readonly PageRun[]): boolean {
  const run = runs.find((item) => item.id === 'rewrite-nonce');
  return run?.report?.decision?.ok === true;
}

function chooseWinner(runs: readonly PageRun[]): string {
  const order = ['baseline', 'attr-inline', 'elem-inline', 'both-inline', 'style-src-inline', 'nonce-reattach'];
  for (const id of order) {
    const run = runs.find((item) => item.id === id && item.report);
    if (!run?.report) {
      continue;
    }
    const flow = flowchartReadable(findDiagram(run.report, 'flowchart'));
    const fraction = formulaReadable(findFormula(run.report, 'fraction') ?? findFormula(run.report, 'fraction-both'));
    if (flow && fraction) {
      return id;
    }
  }
  return 'style-src-inline';
}

function policyForRun(
  appPolicy: string,
  id: string,
  runs: readonly PageRun[],
  nonce: string,
): { policy: string; nonce: string | null; label: string } {
  if (id === 'nonce-reattach' || id === 'nonce-inner') {
    return { policy: noncePolicy(appPolicy, nonce), nonce, label: `nonce reattach (${id})` };
  }
  const existing = runs.find((run) => run.id === id);
  if (existing) {
    return { policy: existing.policy, nonce: null, label: existing.policy };
  }
  const spec = POLICY_SPECS.find((item) => item.id === id) ?? POLICY_SPECS[POLICY_SPECS.length - 1];
  return {
    policy: policyHeader(appPolicy, spec.styleDirectives),
    nonce: null,
    label: spec.styleDirectives.join('; '),
  };
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
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

installGuards();
app.setName('Obelisk Spike S-04');

app.whenReady().then(() => {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    app.exit(1);
  });
}).catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  app.exit(1);
});
