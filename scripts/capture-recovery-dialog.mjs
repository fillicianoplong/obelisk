#!/usr/bin/env node
// Captures the recovery dialog at a 1280×800 viewport (window content only).

import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { minimalDocument, paragraph, textRun } from './make-hostile-fixtures/documents.mjs';
import {
  closeElectron,
  debuggerTargets,
  evaluate,
  freePort,
  launchWithSandboxFallback,
  openCdp,
  repoRoot,
  sleep,
  waitFor,
} from '../tests/integration/electron-launch.mjs';
import { decodeObk } from '../dist/main/codec/decode.js';
import { createRecoveryService } from '../dist/main/recovery/service.js';
import { PREFERENCES_FILE } from '../dist/main/preferences/constants.js';
import { electronBinary } from '../tests/integration/electron-launch.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.env.OBELISK_RECOVERY_SHOTS ?? '/opt/cursor/artifacts';
const WIDTH = 1280;
const HEIGHT = 800;

async function seedUserData(userDataDir, items, theme) {
  await rm(userDataDir, { recursive: true, force: true });
  await mkdir(userDataDir, { recursive: true });
  const service = createRecoveryService({
    userDataDir,
    privateAppData: [userDataDir],
    readObk: decodeObk,
    writer: '0.1.72.0',
  });
  for (const item of items) {
    const document = minimalDocument([paragraph(3, [textRun(item.text)])]);
    const put = await service.put({ recoveryId: null, document, firstLine: item.text });
    if (put.status !== 'ok') {
      throw new Error(`recovery:put failed for ${item.text}`);
    }
  }
  await writeFile(
    path.join(userDataDir, PREFERENCES_FILE),
    `${JSON.stringify({
      version: 1,
      theme,
      spelling: true,
      defaultFont: 'Liberation Serif',
      defaultSize: 12,
      restoreTabs: false,
      showPageEdges: true,
      zoom: 100,
      view: 'pages',
    })}\n`,
  );
}

async function openPage(port, session) {
  const page = (await debuggerTargets(port)).find(
    (target) => target.type === 'page' && target.webSocketDebuggerUrl,
  );
  if (!page) {
    return null;
  }
  session.client?.close();
  session.client = openCdp(page.webSocketDebuggerUrl);
  return session.client;
}

async function captureShot(session, port, file) {
  await openPage(port, session);
  await session.client.send('Emulation.setDeviceMetricsOverride', {
    width: WIDTH,
    height: HEIGHT,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await waitFor(
    session.child,
    async () => {
      const ready = await evaluate(session.client, 'Boolean(document.querySelector("[data-recovery-prompt]"))');
      return ready ? true : null;
    },
    25_000,
  );
  await sleep(200);
  const shot = await session.client.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
  });
  const buffer = Buffer.from(shot.data, 'base64');
  await writeFile(file, buffer);
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  console.log(`Wrote ${file} (${width}x${height})`);
}

async function runCapture(label, theme, items, fileName) {
  const userDataDir = await mkdtemp(path.join(tmpdir(), `obelisk-recovery-${label}-`));
  await seedUserData(userDataDir, items, theme);
  const port = await freePort();
  const session = { child: undefined, client: undefined };
  session.child = await launchWithSandboxFallback({
    binary: electronBinary(),
    cwd: repoRoot,
    args: [
      '.',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      `--window-size=${WIDTH},${HEIGHT}`,
    ],
    env: process.env,
    ready: (child) => waitFor(child, () => openPage(port, session).then((c) => (c ? true : null)), 25_000),
  });
  try {
    const destination = path.join(outDir, fileName);
    const capturePath = path.join(userDataDir, fileName);
    await captureShot(session, port, capturePath);
    await copyFile(capturePath, destination);
    console.log(`Copied to ${destination}`);
  } finally {
    await closeElectron(session);
    await rm(userDataDir, { recursive: true, force: true });
  }
}

const twoItems = [
  { text: 'Essay draft — intro paragraph' },
  { text: 'Lab notes for week four' },
];
const oneItem = [{ text: 'Essay draft — intro paragraph' }];

await runCapture('light-2', 'light', twoItems, 'recovery-prompt-light-2items.png');
await runCapture('dark-2', 'dark', twoItems, 'recovery-prompt-dark-2items.png');
await runCapture('light-1', 'light', oneItem, 'recovery-prompt-light-1item.png');