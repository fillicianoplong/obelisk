// Captures a 1280 by 800 window at 100%, 125%, 150%, 175%, and 200%
// device scale, plus the 640 by 400 minimum, in Light and Dark.
// Fails when a region clips or overlaps. Screenshots stay in tests/visual/output.

import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ensureElectronBinary } from '../../scripts/electron-binary.mjs';
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
} from '../integration/electron-launch.mjs';
import { collectLayoutSource, formatProblems, judgeLayout } from './layout-check.mjs';

const root = repoRoot;
const outputDir = process.env.OBELISK_VISUAL_OUT
  ? path.resolve(process.env.OBELISK_VISUAL_OUT)
  : path.join(root, 'tests', 'visual', 'output');

const THEMES = ['light', 'dark'];
const SCALES = [1, 1.25, 1.5, 1.75, 2];
const SCALE_WIDTH = 1280;
const SCALE_HEIGHT = 800;
const TAB_COUNT = 8;
const READY_TIMEOUT_MS = 20_000;

const COLLECT = `(${collectLayoutSource})()`;

function percentLabel(scale) {
  return String(Math.round(scale * 100));
}

function pngSize(buffer) {
  if (buffer.length < 24 || buffer.toString('ascii', 1, 4) !== 'PNG') {
    return null;
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

async function openPage(port, session) {
  const page = (await debuggerTargets(port)).find(
    (target) => target.type === 'page' && target.webSocketDebuggerUrl,
  );
  if (!page) {
    return null;
  }
  if (!session.client || session.client.url !== page.webSocketDebuggerUrl) {
    session.client?.close();
    session.client = openCdp(page.webSocketDebuggerUrl);
  }
  return session.client;
}

async function readLayout(client) {
  return evaluate(client, COLLECT);
}

async function waitForLayout(child, port, session) {
  return waitFor(
    child,
    async () => {
      const client = await openPage(port, session);
      if (!client) {
        return null;
      }
      const layout = await readLayout(client);
      if (!layout?.ready) {
        return null;
      }
      return layout;
    },
    READY_TIMEOUT_MS,
  );
}

async function setViewport(client, width, height, scale) {
  await client.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: scale,
    mobile: false,
  });
  await sleep(50);
}

async function capture(client, file) {
  const shot = await client.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
  });
  const buffer = Buffer.from(shot.data, 'base64');
  await writeFile(file, buffer);
  return pngSize(buffer);
}

async function addTabs(client, total) {
  for (let guard = 0; guard < 20; guard += 1) {
    const count = await evaluate(client, 'document.querySelectorAll(\'[role="tab"]\').length');
    if (count >= total) {
      return count;
    }
    await evaluate(client, 'document.querySelector(".tab-new").click()');
    await sleep(40);
  }
  throw new Error(`The window did not open ${total} tabs.`);
}

function screenshotProblem(size, width, height, scale) {
  if (!size) {
    return 'the screenshot is not a PNG';
  }
  const expectedWidth = Math.round(width * scale);
  const expectedHeight = Math.round(height * scale);
  if (Math.abs(size.width - expectedWidth) > 2 || Math.abs(size.height - expectedHeight) > 2) {
    return `the screenshot is ${size.width} by ${size.height}, not ${expectedWidth} by ${expectedHeight}`;
  }
  return null;
}

async function checkShot(session, options) {
  const client = session.client;
  await setViewport(client, options.width, options.height, options.scale);
  const layout = await waitFor(
    session.child,
    async () => {
      const next = await readLayout(client);
      if (!next?.ready) {
        return null;
      }
      if (Math.abs(next.innerWidth - options.width) > 1 || Math.abs(next.innerHeight - options.height) > 1) {
        return null;
      }
      if (options.expect?.tabsScroll === true && next.tabs?.activeInside !== true) {
        return null;
      }
      return next;
    },
    READY_TIMEOUT_MS,
  );
  const file = path.join(outputDir, options.file);
  const size = await capture(client, file);
  layout.expect = options.expect;
  const problems = judgeLayout(layout);
  const shot = screenshotProblem(size, options.width, options.height, options.scale);
  if (shot) {
    problems.push({ region: 'window', message: shot });
  }
  const label = `${options.file} (${size ? `${size.width}x${size.height}` : 'unreadable'})`;
  if (problems.length === 0) {
    console.log(`${label}: ok`);
  } else {
    console.log(`${label}:\n${formatProblems(problems)}`);
  }
  return problems;
}

async function windowOuterSize(client) {
  return evaluate(client, '({ width: window.outerWidth, height: window.outerHeight, innerWidth: window.innerWidth, innerHeight: window.innerHeight })');
}

async function checkMinimumClamp(session) {
  await session.client.send('Emulation.clearDeviceMetricsOverride').catch(() => {});
  const before = await windowOuterSize(session.client);
  await evaluate(session.client, 'window.resizeTo(200, 200)');
  await sleep(150);
  const size = await windowOuterSize(session.client);
  console.log(
    `minimum clamp: requested 200 by 200, window is ${size.width} by ${size.height} (${size.innerWidth} by ${size.innerHeight} inside)`,
  );
  const problems = [];
  if (size.width < 640 || size.height < 400) {
    problems.push({
      region: 'window',
      message: `the window shrank to ${size.width} by ${size.height}, under 640 by 400`,
    });
  }
  // A window frame can add a few pixels around the 640 by 400 minimum.
  if (size.width > 640 + 48 || size.height > 400 + 48) {
    problems.push({
      region: 'window',
      message: `the window stayed at ${size.width} by ${size.height} instead of the 640 by 400 minimum`,
    });
  }
  await evaluate(
    session.client,
    `window.resizeTo(${Math.max(before.width, 1280)}, ${Math.max(before.height, 800)})`,
  );
  await sleep(50);
  return problems;
}

async function runTheme(theme, minimum) {
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'obelisk-scale-'));
  await writeFile(path.join(userDataDir, 'settings.json'), `${JSON.stringify({ theme })}\n`);
  const port = await freePort();
  const session = { userDataDir, client: undefined, child: undefined };
  const binary = ensureElectronBinary(root);
  const args = [
    '--force-device-scale-factor=1',
    '.',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
  ];
  const problems = [];
  try {
    session.child = await launchWithSandboxFallback({
      binary,
      args,
      ready(running) {
        return waitForLayout(running, port, session);
      },
    });
    await session.client.send('Page.enable').catch(() => {});
    try {
      const clamp = await checkMinimumClamp(session);
      if (clamp.length > 0) {
        console.log(formatProblems(clamp));
      }
      problems.push(...clamp);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`window: the minimum size could not be checked (${message})`);
      problems.push({ region: 'window', message: `the minimum size could not be checked (${message})` });
    }

    for (const scale of SCALES) {
      problems.push(...await checkShot(session, {
        width: SCALE_WIDTH,
        height: SCALE_HEIGHT,
        scale,
        file: `scale-${percentLabel(scale)}-${theme}.png`,
        expect: {
          viewport: { width: SCALE_WIDTH, height: SCALE_HEIGHT },
          deviceScaleFactor: scale,
          statusViewShown: true,
        },
      }));
    }

    await addTabs(session.client, TAB_COUNT);
    problems.push(...await checkShot(session, {
      width: minimum.width,
      height: minimum.height,
      scale: 1,
      file: `min-size-${theme}.png`,
      expect: {
        viewport: { width: minimum.width, height: minimum.height },
        deviceScaleFactor: 1,
        statusViewHidden: true,
        pageScrolls: true,
        tabsScroll: true,
        tabMin: 96,
      },
    }));
  } finally {
    session.client?.close();
    await closeElectron(session.child, userDataDir);
  }
  return problems;
}

const built = path.join(root, 'dist', 'main', 'index.js');
try {
  await mkdir(outputDir, { recursive: true });
  const minimumModule = await import(pathToFileURL(path.join(root, 'dist', 'main', 'window', 'minimum.js')).href);
  const minimum = minimumModule.minimumWindowSize();
  if (minimum.width !== 640 || minimum.height !== 400) {
    throw new Error(`The minimum window is ${minimum.width} by ${minimum.height}, not 640 by 400.`);
  }
  const { access } = await import('node:fs/promises');
  try {
    await access(built);
  } catch {
    throw new Error('Build the app before the scale check.');
  }
  ensureElectronBinary(root);

  const problems = [];
  for (const theme of THEMES) {
    console.log(`Theme: ${theme}`);
    problems.push(...await runTheme(theme, minimum));
  }
  if (problems.length > 0) {
    console.error(`${problems.length} scale check${problems.length === 1 ? '' : 's'} failed.`);
    process.exit(1);
  }
  console.log(`Screenshots: ${outputDir}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
