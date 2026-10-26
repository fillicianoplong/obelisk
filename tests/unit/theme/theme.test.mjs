import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { APP_PAGE_URL } from '../../../dist/shared/app-page.js';
import { IPC_CHANNELS } from '../../../dist/shared/ipc/index.js';
import {
  THEME_CHANGED_CHANNEL,
  THEME_GET_CHANNEL,
  applyDataTheme,
  dataThemeAttribute,
  parseThemeChangedMessage,
  parseThemeGetOk,
  themeLaunchArgument,
  themeSettingFromArguments,
  themeSourceFor,
} from '../../../dist/shared/theme.js';
import {
  THEME_SETTINGS_FILE,
  readThemeSetting,
  themeSettingFromJson,
  themeSettingsPath,
} from '../../../dist/main/settings.js';
import { frameColorsFor, shellFrameColors } from '../../../dist/main/shell-theme.js';
import {
  CONTRAST_CAPTION_BACKGROUND,
  CONTRAST_CAPTION_SYMBOL,
  contrastCaptionColors,
  normalizeCaptionColor,
} from '../../../dist/main/window/caption.js';
import { dispatchThemeGet } from '../../../dist/main/window/theme-ipc.js';
import {
  activateThemeSource,
  applyFrame,
  contrastThemeActive,
  frameForNativeTheme,
  watchThemeFrame,
} from '../../../dist/main/window/theme.js';
import { createThemeApi, installThemeBridge, THEME_BRIDGE_KEY } from '../../../dist/preload/theme.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

test('a theme setting maps to themeSource and data-theme', () => {
  assert.deepEqual(
    ['light', 'dark', 'system'].map((theme) => [theme, themeSourceFor(theme), dataThemeAttribute(theme)]),
    [
      ['light', 'light', 'light'],
      ['dark', 'dark', 'dark'],
      ['system', 'system', null],
    ],
  );

  const rootElement = { dataset: {} };
  applyDataTheme(rootElement, 'dark');
  assert.equal(rootElement.dataset.theme, 'dark');
  applyDataTheme(rootElement, 'light');
  assert.equal(rootElement.dataset.theme, 'light');
  applyDataTheme(rootElement, 'system');
  assert.equal(rootElement.dataset.theme, undefined);

  assert.equal(themeLaunchArgument('dark'), '--obelisk-theme=dark');
  assert.equal(themeSettingFromArguments(['--obelisk-theme=light']), 'light');
  assert.equal(themeSettingFromArguments(['--obelisk-theme=nope', '--obelisk-theme=dark']), 'dark');
  assert.equal(themeSettingFromArguments(['--obelisk-theme=match-windows']), 'system');
  assert.equal(themeSettingFromArguments([]), 'system');

  assert.equal(IPC_CHANNELS.includes(THEME_GET_CHANNEL), false);
  assert.equal(IPC_CHANNELS.includes(THEME_CHANGED_CHANNEL), false);
});

test('settings.json is the only theme file, and a bad file means system', async () => {
  assert.equal(themeSettingFromJson('{ "theme": "dark", "spelling": true }\n'), 'dark');
  assert.equal(themeSettingFromJson('\uFEFF{ "theme": "light" }'), 'light');
  assert.equal(themeSettingFromJson('{ "theme": "system" }'), 'system');
  assert.equal(themeSettingFromJson('{ "theme": "match-windows" }'), 'system');
  assert.equal(themeSettingFromJson('{ "theme": 1 }'), 'system');
  assert.equal(themeSettingFromJson('{}'), 'system');
  assert.equal(themeSettingFromJson('not json'), 'system');
  assert.equal(themeSettingFromJson('[]'), 'system');

  const directory = await mkdtemp(path.join(tmpdir(), 'obelisk-theme-'));
  assert.equal(themeSettingsPath(directory), path.join(directory, THEME_SETTINGS_FILE));
  assert.equal(readThemeSetting(directory), 'system');
  await writeFile(path.join(directory, THEME_SETTINGS_FILE), '{ "theme": "light" }\n');
  assert.equal(readThemeSetting(directory), 'light');
  await writeFile(path.join(directory, THEME_SETTINGS_FILE), '{');
  assert.equal(readThemeSetting(directory), 'system');
});

test('contrast caption colors replace the Slate frame and update live', () => {
  const light = shellFrameColors(false);
  const dark = shellFrameColors(true);
  const contrast = frameColorsFor({
    highContrast: true,
    dark: true,
    contrast: { background: '#000000', symbol: '#FFFFFF' },
  });
  assert.equal(contrast.backgroundColor, '#000000');
  assert.equal(contrast.overlayColor, '#000000');
  assert.equal(contrast.symbolColor, '#FFFFFF');
  assert.equal(contrast.titleBarHeight, light.titleBarHeight);
  assert.deepEqual(
    frameColorsFor({ highContrast: true, dark: true, contrast: null }),
    dark,
  );
  assert.deepEqual(frameColorsFor({ highContrast: false, dark: false, contrast: { background: '#000000', symbol: '#FFFFFF' } }), light);

  assert.equal(normalizeCaptionColor('#aabbcc'), '#AABBCC');
  assert.equal(normalizeCaptionColor('rgb(1, 2, 3)'), '#010203');
  assert.equal(normalizeCaptionColor('not-a-color'), null);
  const colors = contrastCaptionColors((name) => (name === CONTRAST_CAPTION_BACKGROUND ? '#112233' : '#445566'));
  assert.deepEqual(colors, { background: '#112233', symbol: '#445566' });
  assert.equal(CONTRAST_CAPTION_BACKGROUND, '3d-face');
  assert.equal(CONTRAST_CAPTION_SYMBOL, 'button-text');
  assert.equal(contrastCaptionColors(() => { throw new Error('unavailable'); }), null);

  const native = {
    themeSource: 'system',
    shouldUseDarkColors: false,
    shouldUseHighContrastColors: false,
    inForcedColorsMode: false,
  };
  activateThemeSource(native, 'dark');
  assert.equal(native.themeSource, 'dark');
  native.shouldUseDarkColors = true;
  assert.equal(contrastThemeActive(native), false);
  assert.equal(frameForNativeTheme(native, () => ({ background: '#000000', symbol: '#FFFFFF' })).overlayColor, dark.overlayColor);

  native.shouldUseHighContrastColors = true;
  let reads = 0;
  const contrasted = frameForNativeTheme(native, () => {
    reads += 1;
    return { background: '#010101', symbol: '#FEFEFE' };
  });
  assert.equal(reads, 1);
  assert.equal(contrasted.overlayColor, '#010101');
  assert.equal(contrasted.symbolColor, '#FEFEFE');
  native.shouldUseHighContrastColors = false;
  native.inForcedColorsMode = true;
  assert.equal(contrastThemeActive(native), true);

  const calls = [];
  const window = {
    destroyed: false,
    isDestroyed() {
      return this.destroyed;
    },
    setBackgroundColor(color) {
      calls.push(['background', color]);
    },
    setTitleBarOverlay(options) {
      calls.push(['overlay', options]);
    },
    on(event, listener) {
      calls.push(['window-on', event]);
      this.closed = listener;
    },
  };
  const events = new Map();
  const source = {
    shouldUseDarkColors: true,
    shouldUseHighContrastColors: false,
    inForcedColorsMode: false,
    on(event, listener) {
      events.set(event, listener);
    },
    off(event, listener) {
      if (events.get(event) === listener) {
        events.delete(event);
      }
    },
  };
  const messages = [];
  watchThemeFrame({
    nativeTheme: source,
    window,
    platform: 'win32',
    readContrast: () => ({ background: '#000000', symbol: '#FFFFFF' }),
    theme: 'system',
    notify(message) {
      messages.push(message);
    },
  });
  source.shouldUseHighContrastColors = true;
  events.get('updated')();
  assert.deepEqual(
    calls.filter((call) => call[0] === 'background'),
    [['background', '#000000']],
  );
  assert.deepEqual(
    calls.filter((call) => call[0] === 'overlay'),
    [['overlay', { color: '#000000', symbolColor: '#FFFFFF' }]],
  );
  assert.deepEqual(messages, [{ theme: 'system' }]);

  calls.length = 0;
  applyFrame(window, shellFrameColors(false), 'linux');
  assert.deepEqual(calls, [['background', light.backgroundColor]]);

  window.closed();
  assert.equal(events.has('updated'), false);
});

test('theme:get is allow-listed, and theme:changed is checked before use', async () => {
  const refused = dispatchThemeGet({ senderUrl: 'https://example.invalid/', channel: THEME_GET_CHANNEL, args: [] }, 'dark');
  assert.equal(refused.code, 'SENDER_NOT_ALLOWED');
  const unknown = dispatchThemeGet({ senderUrl: APP_PAGE_URL, channel: 'theme:set', args: [] }, 'dark');
  assert.equal(unknown.code, 'UNKNOWN_CHANNEL');
  const changed = dispatchThemeGet({ senderUrl: APP_PAGE_URL, channel: THEME_CHANGED_CHANNEL, args: [] }, 'dark');
  assert.equal(changed.code, 'UNKNOWN_CHANNEL');
  const extra = dispatchThemeGet({ senderUrl: APP_PAGE_URL, channel: THEME_GET_CHANNEL, args: [{ theme: 'dark' }] }, 'light');
  assert.equal(extra.code, 'INVALID_ARGUMENT');
  assert.deepEqual(dispatchThemeGet({ senderUrl: APP_PAGE_URL, channel: THEME_GET_CHANNEL, args: [] }, 'dark'), {
    status: 'ok',
    theme: 'dark',
  });

  assert.equal(parseThemeChangedMessage({ theme: 'light' }), 'light');
  assert.equal(parseThemeChangedMessage({ theme: 'light', extra: true }), null);
  assert.equal(parseThemeChangedMessage({ theme: 'nope' }), null);
  assert.equal(parseThemeGetOk({ status: 'ok', theme: 'system' }), 'system');
  assert.equal(parseThemeGetOk({ status: 'ok', theme: 'system', extra: 1 }), null);

  const seen = [];
  const subscriptions = [];
  const ipc = {
    invoke(channel, ...args) {
      seen.push({ channel, args });
      return Promise.resolve({ status: 'ok', theme: 'dark' });
    },
    on(channel, listener) {
      subscriptions.push({ channel, listener });
    },
    removeListener(channel, listener) {
      subscriptions.push({ removed: true, channel, listener });
    },
  };
  const rootElement = { dataset: { theme: 'light' } };
  let exposed;
  installThemeBridge(
    {
      exposeInMainWorld(apiKey, api) {
        exposed = { apiKey, api };
      },
    },
    ipc,
    ['--obelisk-theme=dark'],
    rootElement,
  );
  assert.equal(rootElement.dataset.theme, 'dark');
  assert.equal(exposed.apiKey, THEME_BRIDGE_KEY);
  assert.deepEqual(Object.keys(exposed.api).sort(), ['get', 'onChanged']);
  const result = await exposed.api.get();
  assert.deepEqual(result, { status: 'ok', theme: 'dark' });
  assert.deepEqual(seen, [{ channel: 'theme:get', args: [] }]);

  const themes = [];
  const stop = exposed.api.onChanged((theme) => {
    themes.push(theme);
  });
  subscriptions[0].listener({ sender: 'raw' }, { theme: 'system' });
  subscriptions[0].listener({ sender: 'raw' }, { theme: 'system', extra: true });
  assert.deepEqual(themes, ['system']);
  assert.equal(subscriptions[0].channel, 'theme:changed');
  stop();
  assert.equal(subscriptions.at(-1).removed, true);

  const api = createThemeApi({
    ...ipc,
    invoke() {
      return Promise.resolve({ theme: 'dark' });
    },
  });
  const invalid = await api.get();
  assert.equal(invalid.status, 'error');
  assert.equal(invalid.code, 'INVALID_ARGUMENT');
  assert.throws(() => api.onChanged(null), TypeError);

  const preloadSource = await readFile(path.join(root, 'src/preload/theme.ts'), 'utf8');
  const preloadIndex = await readFile(path.join(root, 'src/preload/index.ts'), 'utf8');
  assert.equal(preloadSource.includes('sendSync'), false);
  assert.equal(preloadSource.includes('.send('), false);
  assert.equal(preloadIndex.includes('sendSync'), false);
  assert.match(preloadIndex, /installThemeBridge\(/);
});
