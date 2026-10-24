import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { CONTENT_SECURITY_POLICY } from '../../dist/main/security/csp.js';
import {
  closeElectron,
  debuggerTargets,
  electronBinary,
  freePort,
  launchWithSandboxFallback,
  waitFor,
} from '../electron-launch.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

function reported(output, prefix) {
  const match = output.match(new RegExp(`${prefix} (\\{.*\\})`));
  assert.ok(match, `missing ${prefix} in output:\n${output}`);
  return JSON.parse(match[1]);
}

function blockedUrls(output) {
  return [...output.matchAll(/OBELISK_REQUEST_BLOCKED (\S+)/g)].map((match) => match[1]);
}

function cdp(wsUrl) {
  const Socket = globalThis.WebSocket;
  if (typeof Socket !== 'function') {
    throw new Error('This Node version has no WebSocket client.');
  }
  const ws = new Socket(wsUrl);
  let nextId = 1;
  const pending = new Map();

  ws.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    const resolver = pending.get(message.id);
    if (!resolver) {
      return;
    }
    pending.delete(message.id);
    if (message.error) {
      resolver.reject(new Error(JSON.stringify(message.error)));
      return;
    }
    resolver.resolve(message.result);
  });

  const opened = new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', () => reject(new Error('DevTools socket failed.')));
  });

  return {
    async send(method, params = {}) {
      await opened;
      const id = nextId;
      nextId += 1;
      const result = new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
      });
      ws.send(JSON.stringify({ id, method, params }));
      return result;
    },
    close() {
      ws.close();
    },
  };
}

async function evaluate(client, expression) {
  const result = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(JSON.stringify(result.exceptionDetails));
  }
  return result.result.value;
}

test('the secured window blocks fetch, navigation, popups, webviews, and permissions', { timeout: 90_000 }, async () => {
  const binary = electronBinary();
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'obelisk-security-'));
  const port = await freePort();
  const args = ['.', `--remote-debugging-port=${port}`, `--user-data-dir=${userDataDir}`];
  const probeHtml = await readFile(path.join(here, 'probe.html'), 'utf8');
  const probeScript = probeHtml.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(probeScript, 'probe.html is missing its script');
  let child;
  let client;

  try {
    child = await launchWithSandboxFallback({
      binary,
      args,
      env: { OBELISK_SECURITY_REPORT: '1' },
      ready(running) {
        return waitFor(
          running,
          async () => {
            const pages = (await debuggerTargets(port)).filter((target) => target.type === 'page');
            const pageReady =
              pages.length === 1 &&
              pages[0].title === 'Obelisk' &&
              typeof pages[0].url === 'string' &&
              pages[0].url.startsWith('app://obelisk/index.html');
            const reportedState =
              running.output.includes('OBELISK_WINDOW_OPTIONS') &&
              running.output.includes('OBELISK_PRELOAD');
            return pageReady && reportedState ? pages[0] : null;
          },
          45_000,
        );
      },
    });

    const options = reported(child.output, 'OBELISK_WINDOW_OPTIONS');
    assert.equal(options.contextIsolation, true);
    assert.equal(options.sandbox, true);
    assert.equal(options.nodeIntegration, false);
    assert.equal(options.webviewTag, false);

    const preload = reported(child.output, 'OBELISK_PRELOAD');
    assert.equal(preload.contextIsolated, true);
    assert.equal(preload.nodeRequireFs, false);
    if (!child.spawnargs.includes('--no-sandbox')) {
      assert.equal(preload.sandboxed, true);
    }

    const page = (await debuggerTargets(port)).find((target) => target.type === 'page');
    assert.ok(page?.webSocketDebuggerUrl, 'the page has no DevTools socket');
    client = cdp(page.webSocketDebuggerUrl);
    const probe = await evaluate(client, `${probeScript[1]}\n__runObeliskProbe()`);
    assert.equal(probe.heading, 'Obelisk', JSON.stringify(probe));
    assert.equal(probe.origin, 'app://obelisk');
    assert.equal(probe.secureContext, true);
    assert.equal(probe.href.startsWith('app://obelisk/index.html'), true);
    assert.equal(probe.stayed, true);
    assert.equal(probe.titleStayed, true);
    assert.equal(probe.title, 'Obelisk');
    assert.equal(probe.nodeRequire, 'undefined');
    assert.equal(probe.nodeProcess, 'undefined');
    assert.equal(probe.popupBlocked, true);
    assert.equal(probe.webviewGuest, false);
    assert.equal(probe.inlineRan, false);
    assert.equal(probe.http.blocked, true, JSON.stringify(probe.http));
    assert.equal(probe.https.blocked, true, JSON.stringify(probe.https));
    assert.equal(probe.http.name === 'TimeoutError' || probe.http.name === 'AbortError', false);
    assert.equal(probe.https.name === 'TimeoutError' || probe.https.name === 'AbortError', false);
    assert.equal(probe.camera === 'granted' || probe.camera === 'TimeoutError', false, JSON.stringify(probe));
    assert.equal(probe.cameraPermission, 'denied', JSON.stringify(probe));
    assert.equal(probe.microphonePermission, 'denied', JSON.stringify(probe));
    assert.equal(probe.notifications, 'denied');
    assert.match(child.output, /OBELISK_PERMISSION_DENIED check:media/);
    assert.match(child.output, /OBELISK_PERMISSION_DENIED request:notifications/);

    const policy = probe.violations.find((violation) => violation.originalPolicy)?.originalPolicy ?? '';
    assert.equal(policy.includes("default-src 'none'"), true, JSON.stringify(probe.violations));
    assert.equal(policy.includes('script-src app:'), true, policy);
    assert.equal(policy.includes("connect-src 'none'"), true, policy);
    assert.equal(policy.includes("frame-src 'none'"), true, policy);
    assert.equal(policy.includes("object-src 'none'"), true, policy);
    assert.equal(policy.includes(CONTENT_SECURITY_POLICY), true, policy);
    assert.equal(
      probe.violations.some((violation) => String(violation.directive).includes('script-src')),
      true,
      JSON.stringify(probe.violations),
    );

    const targets = await debuggerTargets(port);
    const pages = targets.filter((target) => target.type === 'page');
    assert.equal(pages.length, 1);
    assert.equal(pages[0].url.startsWith('app://obelisk/index.html'), true);
    assert.equal(
      targets.some((target) => target.type === 'webview' || String(target.url).includes('example.invalid')),
      false,
      JSON.stringify(targets),
    );
  } finally {
    client?.close();
    await closeElectron(child, userDataDir);
  }
});

test('main cancels http and https requests that reach the session', { timeout: 60_000 }, async () => {
  const binary = electronBinary();
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'obelisk-filter-'));
  const harness = path.join(here, 'filter-harness.mjs');
  const args = [harness, `--user-data-dir=${userDataDir}`];
  let child;

  try {
    child = await launchWithSandboxFallback({
      binary,
      args,
      ready(running) {
        return waitFor(
          running,
          () => (running.output.includes('OBELISK_FILTER_RESULT') ? true : null),
          20_000,
        );
      },
    });

    const match = child.output.match(/OBELISK_FILTER_RESULT (\[.*\])/);
    assert.ok(match, child.output);
    const results = JSON.parse(match[1]);
    assert.deepEqual(
      results.map((item) => item.url),
      ['http://example.invalid/filter-probe', 'https://example.invalid/filter-probe'],
    );
    for (const item of results) {
      assert.equal(item.blocked, true, JSON.stringify(item));
      assert.equal(item.name, 'TypeError', JSON.stringify(item));
    }
    const blocked = blockedUrls(child.output);
    assert.equal(blocked.includes('http://example.invalid/filter-probe'), true, child.output);
    assert.equal(blocked.includes('https://example.invalid/filter-probe'), true, child.output);
  } finally {
    await closeElectron(child, userDataDir);
  }
});
