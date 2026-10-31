import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { APP_PAGE_URL } from '../../../dist/shared/app-page.js';
import {
  IPC_CHANNELS,
  IPC_ERROR_RETRYABLE,
  IPC_EVENT_CHANNEL,
  IPC_INVOKE_CHANNELS,
} from '../../../dist/shared/ipc/index.js';
import { bindIpcHandlers } from '../../../dist/main/ipc/bind.js';
import { createStubHandlers } from '../../../dist/main/ipc/handlers.js';
import { createIpcRegistry } from '../../../dist/main/ipc/registry.js';
import { isAppPageSender } from '../../../dist/main/ipc/sender.js';
import { createObeliskApi, exposeObeliskApi, OBELISK_BRIDGE_KEY } from '../../../dist/preload/bridge.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function documentMessage() {
  return {
    view: 'pages',
    page: { paper: 'Letter' },
    header: {},
    footer: {},
    blocks: [],
  };
}

function saveRequest(overrides = {}) {
  return {
    handle: 'tab-1',
    document: documentMessage(),
    revision: 3,
    expectedStat: null,
    replaceConfirmed: false,
    ...overrides,
  };
}

function notImplemented(channel) {
  return {
    status: 'error',
    code: 'NOT_IMPLEMENTED',
    message: `${channel} is not available yet.`,
    retryable: false,
  };
}

test('the channel list matches the architecture IPC table', async () => {
  const markdown = await readFile(path.join(root, 'docs/ARCHITECTURE.md'), 'utf8');
  const start = markdown.indexOf('### 6.3 IPC surface');
  const end = markdown.indexOf('### 6.4 Security baseline');
  assert.ok(start !== -1 && end > start);
  const section = markdown.slice(start, end);
  const names = [];
  for (const match of section.matchAll(/^\| `([^`]+)` \|/gm)) {
    for (const name of match[1].split(',')) {
      names.push(name.trim());
    }
  }
  assert.deepEqual([...names].sort(), [...IPC_CHANNELS].sort());
  assert.equal(IPC_INVOKE_CHANNELS.length, 17);
  assert.equal(IPC_CHANNELS.includes(IPC_EVENT_CHANNEL), true);
  assert.equal(IPC_INVOKE_CHANNELS.includes(IPC_EVENT_CHANNEL), false);
  assert.equal(IPC_INVOKE_CHANNELS.includes('prefs:get'), true);
  assert.equal(IPC_INVOKE_CHANNELS.includes('prefs:set'), true);
});

test('save error codes use the architecture retryable flags', () => {
  assert.equal(IPC_ERROR_RETRYABLE.ENOSPC, true);
  assert.equal(IPC_ERROR_RETRYABLE.EBUSY_EXHAUSTED, true);
  assert.equal(IPC_ERROR_RETRYABLE.TIMEOUT, true);
  assert.equal(IPC_ERROR_RETRYABLE.EACCES, false);
  assert.equal(IPC_ERROR_RETRYABLE.ENOENT, false);
  assert.equal(IPC_ERROR_RETRYABLE.PATH_NOT_ALLOWED, false);
  assert.equal(IPC_ERROR_RETRYABLE.ENCODE_FAILED, false);
  assert.equal(IPC_ERROR_RETRYABLE.SENDER_NOT_ALLOWED, false);
  assert.equal(IPC_ERROR_RETRYABLE.UNKNOWN_CHANNEL, false);
  assert.equal(IPC_ERROR_RETRYABLE.INVALID_ARGUMENT, false);
});

test('handler modules run under Node without a window', async () => {
  const handlers = createStubHandlers();
  assert.deepEqual(handlers['sig:list'](), notImplemented('sig:list'));

  const registry = createIpcRegistry();
  const result = await registry.dispatch({
    senderUrl: APP_PAGE_URL,
    channel: 'file:open',
    args: [],
  });
  assert.deepEqual(result, notImplemented('file:open'));
});

test('a call from an unknown frame is refused', async () => {
  let calls = 0;
  const registry = createIpcRegistry();
  for (const channel of IPC_INVOKE_CHANNELS) {
    registry.setHandler(channel, () => {
      calls += 1;
      return notImplemented(channel);
    });
  }

  const frames = [
    null,
    '',
    'https://example.invalid/index.html',
    'file:///tmp/index.html',
    'app://evil/index.html',
    'app://obelisk/other.html',
    'app://obelisk/index.html/',
    'app://obelisk/index.html?next=1',
    'app://obelisk/index.html#tab',
    'app://user:pass@obelisk/index.html',
    'app://obelisk:80/index.html',
  ];
  for (const senderUrl of frames) {
    const result = await registry.dispatch({
      senderUrl,
      channel: 'file:open',
      args: [],
    });
    assert.deepEqual(
      result,
      {
        status: 'error',
        code: 'SENDER_NOT_ALLOWED',
        message: 'The call did not come from the app page.',
        retryable: false,
      },
      String(senderUrl),
    );
  }

  const unknownToo = await registry.dispatch({
    senderUrl: 'https://example.invalid/',
    channel: 'file:delete',
    args: [],
  });
  assert.equal(unknownToo.code, 'SENDER_NOT_ALLOWED');
  assert.equal(calls, 0);
  assert.equal(isAppPageSender(APP_PAGE_URL), true);
});

test('an unknown channel is refused', async () => {
  let calls = 0;
  const registry = createIpcRegistry();
  registry.setHandler('file:open', () => {
    calls += 1;
    return notImplemented('file:open');
  });
  const result = await registry.dispatch({
    senderUrl: APP_PAGE_URL,
    channel: 'file:delete',
    args: [],
  });
  assert.deepEqual(result, {
    status: 'error',
    code: 'UNKNOWN_CHANNEL',
    message: 'Unknown channel.',
    retryable: false,
  });
  assert.equal(calls, 0);
});

test('a malformed argument is refused and the handler does nothing', async () => {
  let calls = 0;
  const registry = createIpcRegistry();
  registry.setHandler('file:save', () => {
    calls += 1;
    return notImplemented('file:save');
  });

  const cases = [
    [],
    [saveRequest({ handle: 12 })],
    [saveRequest({ revision: '3' })],
    [saveRequest({ document: 'pages' })],
    [saveRequest({ replaceConfirmed: 'false' })],
    [saveRequest({ expectedStat: { size: 1 } })],
    [saveRequest({ handle: '../secret.obk' })],
    [saveRequest(), { extra: true }],
  ];
  for (const args of cases) {
    const result = await registry.dispatch({
      senderUrl: APP_PAGE_URL,
      channel: 'file:save',
      args,
    });
    assert.equal(result.status, 'error', JSON.stringify(args));
    assert.equal(result.code, 'INVALID_ARGUMENT', JSON.stringify(args));
    assert.equal(result.retryable, false);
  }

  const openWithArg = await registry.dispatch({
    senderUrl: APP_PAGE_URL,
    channel: 'file:open',
    args: [{}],
  });
  assert.equal(openWithArg.code, 'INVALID_ARGUMENT');

  const badTheme = await registry.dispatch({
    senderUrl: APP_PAGE_URL,
    channel: 'prefs:set',
    args: [{ key: 'theme', value: 'blue' }],
  });
  assert.equal(badTheme.code, 'INVALID_ARGUMENT');
  assert.equal(calls, 0);
});

test('a valid call reaches the handler with a copy of the arguments', async () => {
  const registry = createIpcRegistry();
  let received;
  registry.setHandler('file:save', (request) => {
    received = request;
    return notImplemented('file:save');
  });
  const request = saveRequest();
  const result = await registry.dispatch({
    senderUrl: APP_PAGE_URL,
    channel: 'file:save',
    args: [request],
  });
  assert.deepEqual(result, notImplemented('file:save'));
  assert.equal(received.handle, 'tab-1');
  assert.equal(received.revision, 3);
  assert.equal(received.replaceConfirmed, false);
  assert.equal(received.expectedStat, null);
  request.document.page.paper = 'changed';
  assert.equal(received.document.page.paper, 'Letter');
  assert.equal(Object.hasOwn(received, 'path'), false);
});

test('the IPC adapter reads the sender frame and does not pass the event', async () => {
  const registry = createIpcRegistry();
  let received;
  let calls = 0;
  registry.setHandler('file:save', (request) => {
    calls += 1;
    received = request;
    return notImplemented('file:save');
  });
  const listeners = new Map();
  const registered = bindIpcHandlers(
    {
      handle(channel, listener) {
        listeners.set(channel, listener);
      },
    },
    registry,
  );
  assert.deepEqual(registered, [...IPC_INVOKE_CHANNELS]);
  assert.equal(listeners.has('file:activated'), false);
  assert.equal(listeners.has('file:delete'), false);

  const request = saveRequest();
  const refused = await listeners.get('file:save')(
    {
      senderFrame: { url: 'https://example.invalid/' },
      sender: { getURL: () => APP_PAGE_URL, secret: true },
    },
    request,
  );
  assert.equal(refused.code, 'SENDER_NOT_ALLOWED');
  assert.equal(calls, 0);

  const accepted = await listeners.get('file:save')(
    { senderFrame: { url: APP_PAGE_URL }, sender: { secret: true } },
    request,
  );
  assert.equal(accepted.code, 'NOT_IMPLEMENTED');
  assert.equal(calls, 1);
  assert.equal(received.secret, undefined);
  assert.equal(received.sender, undefined);
  assert.equal(received.handle, 'tab-1');
});

test('an IPC trace names the channel and leaves the request out of the log', async () => {
  const previous = process.env.OBELISK_IPC_TRACE;
  process.env.OBELISK_IPC_TRACE = '1';
  const lines = [];
  const original = console.log;
  console.log = (line) => {
    lines.push(line);
  };
  try {
    const registry = createIpcRegistry();
    const listeners = new Map();
    bindIpcHandlers(
      {
        handle(channel, listener) {
          listeners.set(channel, listener);
        },
      },
      registry,
    );
    const request = saveRequest();
    await listeners.get('file:save')(
      { senderFrame: { url: APP_PAGE_URL } },
      request,
    );
    assert.deepEqual(lines, ['OBELISK_IPC file:save']);
    assert.equal(JSON.stringify(lines).includes('tab-1'), false);
  } finally {
    console.log = original;
    if (previous === undefined) {
      delete process.env.OBELISK_IPC_TRACE;
    } else {
      process.env.OBELISK_IPC_TRACE = previous;
    }
  }
});

test('preload exposes only listed channels', async () => {
  const invocations = [];
  const subscriptions = [];
  const ipc = {
    invoke(channel, ...args) {
      invocations.push({ channel, args });
      return Promise.resolve(notImplemented(channel));
    },
    on(channel, listener) {
      subscriptions.push({ channel, listener });
    },
    removeListener(channel, listener) {
      subscriptions.push({ removed: true, channel, listener });
    },
    send() {
      throw new Error('preload must not send');
    },
    sendSync() {
      throw new Error('preload must not send synchronously');
    },
  };
  let exposed;
  exposeObeliskApi(
    {
      exposeInMainWorld(apiKey, api) {
        assert.equal(exposed, undefined);
        exposed = { apiKey, api };
      },
    },
    ipc,
  );
  assert.equal(exposed.apiKey, OBELISK_BRIDGE_KEY);
  assert.deepEqual(Object.keys(exposed.api).sort(), [...IPC_CHANNELS].sort());
  for (const key of ['invoke', 'send', 'sendSync', 'on', 'postMessage', 'ipcRenderer']) {
    assert.equal(Object.hasOwn(exposed.api, key), false, key);
  }

  const api = createObeliskApi(ipc);
  for (const channel of IPC_INVOKE_CHANNELS) {
    const before = invocations.length;
    if (channel === 'file:open' || channel === 'sig:list' || channel === 'recovery:list') {
      await api[channel]();
      assert.equal(invocations.at(-1).channel, channel);
      assert.deepEqual(invocations.at(-1).args, []);
    } else {
      await api[channel]({ probe: channel });
      assert.equal(invocations.at(-1).channel, channel);
      assert.deepEqual(invocations.at(-1).args, [{ probe: channel }]);
    }
    assert.equal(invocations.length, before + 1);
  }
  assert.deepEqual(
    invocations.map((call) => call.channel).sort(),
    [...IPC_INVOKE_CHANNELS].sort(),
  );

  const seen = [];
  const id = api['file:activated'].subscribe((payload) => {
    seen.push(payload);
  });
  assert.equal(typeof id, 'number');
  assert.equal(subscriptions.length, 1);
  assert.equal(subscriptions[0].channel, 'file:activated');
  subscriptions[0].listener({ sender: 'raw-event' }, { status: 'cancelled' });
  subscriptions[0].listener({ sender: 'raw-event' }, { status: 'cancelled' });
  assert.deepEqual(seen, [{ status: 'cancelled' }, { status: 'cancelled' }]);
  api['file:activated'].unsubscribe(id);
  seen.length = 0;
  subscriptions[0].listener({ sender: 'raw-event' }, { status: 'cancelled' });
  assert.deepEqual(seen, []);

  const preloadSource = await readFile(path.join(root, 'src/preload/index.ts'), 'utf8');
  const bridgeSource = await readFile(path.join(root, 'src/preload/bridge.ts'), 'utf8');
  assert.equal(preloadSource.includes('exposeInMainWorld'), false);
  assert.equal(preloadSource.includes('.send'), false);
  assert.equal(preloadSource.includes('sendSync'), false);
  assert.equal(bridgeSource.includes('.send('), false);
  assert.equal(bridgeSource.includes('sendSync'), false);
  assert.equal(bridgeSource.includes('exposeInMainWorld'), true);
});

test('main IPC modules other than the installer do not reference Electron', async () => {
  for (const file of ['registry.js', 'handlers.js', 'sender.js', 'bind.js']) {
    const source = await readFile(path.join(root, 'dist/main/ipc', file), 'utf8');
    assert.equal(source.includes('electron'), false, file);
  }
  const installer = await readFile(path.join(root, 'dist/main/ipc/install.js'), 'utf8');
  assert.equal(installer.includes('electron'), true);

  const preloadBundle = await readFile(path.join(root, 'dist/preload/index.js'), 'utf8');
  assert.equal(preloadBundle.includes('./bridge'), false);
  assert.equal(preloadBundle.includes('../shared'), false);
  assert.match(preloadBundle, /require\(["']electron["']\)/);
  assert.match(preloadBundle, /require\(["']fs["']\)/);
});
