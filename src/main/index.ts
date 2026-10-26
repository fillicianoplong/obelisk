import { app, BrowserWindow, Menu, nativeTheme, systemPreferences } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { APP_NAME } from '../shared/app-info.js';
import { THEME_CHANGED_CHANNEL, themeLaunchArgument, type ThemeSetting } from '../shared/theme.js';
import { SMOKE_MARKER_FILE } from './security/app-data.js';
import { APP_START_URL } from './security/app-path.js';
import { installAppProtocol, registerAppScheme } from './security/app-protocol.js';
import { installContentsGuards } from './security/navigation.js';
import { installSessionSecurity } from './security/session.js';
import { configureWritablePaths } from './security/writable-paths.js';
import { installIpc } from './ipc/install.js';
import { readThemeSetting } from './settings.js';
import { secureWebPreferences } from './security/window-options.js';
import { readSystemCaptionColors } from './window/caption.js';
import { installThemeIpc } from './window/install-theme-ipc.js';
import { applyMinimumWindowSize, defaultWindowSize, minimumWindowSize } from './window/minimum.js';
import { activateThemeSource, frameForNativeTheme, watchThemeFrame } from './window/theme.js';

function reportSecurity(line: string): void {
  if (process.env.OBELISK_SECURITY_REPORT === '1') {
    console.log(line);
  }
}

const WINDOW_ICON_FILE = 'obelisk.ico';

function windowIconPath(): string | null {
  if (process.platform !== 'win32') {
    return null;
  }
  const packaged = path.join(process.resourcesPath, WINDOW_ICON_FILE);
  if (fs.existsSync(packaged)) {
    return packaged;
  }
  const dev = path.join(app.getAppPath(), 'packaging', 'icons', WINDOW_ICON_FILE);
  if (fs.existsSync(dev)) {
    return dev;
  }
  return null;
}

function readContrastColors() {
  return readSystemCaptionColors(process.platform, (name) => systemPreferences.getColor(name));
}

function createWindow(theme: ThemeSetting): void {
  // Before the window exists, so the first frame is already the chosen theme.
  activateThemeSource(nativeTheme, theme);
  const frame = frameForNativeTheme(nativeTheme, readContrastColors);
  const webPreferences = {
    ...secureWebPreferences(path.join(__dirname, '../preload/index.js')),
    additionalArguments: [themeLaunchArgument(theme)],
  };
  reportSecurity(
    `OBELISK_WINDOW_OPTIONS ${JSON.stringify({
      contextIsolation: webPreferences.contextIsolation,
      nodeIntegration: webPreferences.nodeIntegration,
      sandbox: webPreferences.sandbox,
      webviewTag: webPreferences.webviewTag,
    })}`,
  );

  // The .ico path lets Windows load the 16 px frame at 100%, 20 px at 125%,
  // and 24 px at 150%. One file is used on both light and dark taskbars.
  const windowIcon = windowIconPath();
  const windowsFrame =
    process.platform === 'win32'
      ? {
          titleBarStyle: 'hidden' as const,
          titleBarOverlay: {
            color: frame.overlayColor,
            symbolColor: frame.symbolColor,
            height: frame.titleBarHeight,
          },
        }
      : {};
  const size = defaultWindowSize();
  const minimum = minimumWindowSize();
  const window = new BrowserWindow({
    width: size.width,
    height: size.height,
    minWidth: minimum.width,
    minHeight: minimum.height,
    title: APP_NAME,
    backgroundColor: frame.backgroundColor,
    ...windowsFrame,
    ...(windowIcon ? { icon: windowIcon } : {}),
    webPreferences,
  });
  applyMinimumWindowSize(window);

  window.webContents.on('console-message', (details) => {
    if (details.message.startsWith('OBELISK_PRELOAD ')) {
      reportSecurity(details.message);
    }
  });

  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error(`Renderer failed to load (${errorCode}): ${errorDescription} ${validatedURL}`);
  });

  watchThemeFrame({
    nativeTheme,
    window,
    platform: process.platform,
    readContrast: readContrastColors,
    theme,
    notify(message) {
      if (window.isDestroyed()) {
        return;
      }
      window.webContents.send(THEME_CHANGED_CHANNEL, message);
    },
  });

  void window.loadURL(APP_START_URL);
}

function startApp(): void {
  const theme = readThemeSetting(userData);
  installContentsGuards();
  installIpc();
  installThemeIpc(() => theme);

  void app.whenReady().then(() => {
    installSessionSecurity({
      onBlocked: (url) => {
        reportSecurity(`OBELISK_REQUEST_BLOCKED ${url}`);
      },
      onPermission: (kind) => {
        reportSecurity(`OBELISK_PERMISSION_DENIED ${kind}`);
      },
    });
    installAppProtocol(path.join(__dirname, '../renderer'));
    createWindow(theme);
  }).catch((error: unknown) => {
    console.error(error);
    app.exit(1);
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
}

registerAppScheme();
app.setName(APP_NAME);
Menu.setApplicationMenu(null);

const userData = configureWritablePaths();
if (process.env.OBELISK_PACKAGED_SMOKE === '1') {
  const marker = [
    `userData=${app.getPath('userData')}`,
    `exe=${app.getPath('exe')}`,
    `cwd=${process.cwd()}`,
  ].join('\n');
  fs.writeFileSync(path.join(userData, SMOKE_MARKER_FILE), `${marker}\n`);
  app.exit(0);
} else {
  startApp();
}
