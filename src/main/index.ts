import { app, BrowserWindow, Menu, nativeTheme, session, systemPreferences } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { APP_NAME } from '../shared/app-info.js';
import { THEME_CHANGED_CHANNEL, themeLaunchArgument, type ThemeSetting } from '../shared/theme.js';
import { openLaunchPaths, sendFileActivated } from './file/activation.js';
import { sessionPathsForLaunch } from './ipc/session.js';
import { launchPathsFromArgv } from './file/launchPaths.js';
import type { FileService } from './file/service.js';
import { SMOKE_MARKER_FILE } from './security/app-data.js';
import { APP_START_URL } from './security/app-path.js';
import { installAppProtocol, registerAppScheme } from './security/app-protocol.js';
import { installContentsGuards } from './security/navigation.js';
import { installSessionSecurity, installSpellChecker } from './security/session.js';
import { spellContextFromMenuParams } from './security/spellcheck.js';
import { configureWritablePaths } from './security/writable-paths.js';
import { readPackageIoRequest, runPackagedIoCheck } from './file/packageIo.js';
import { removeStaleTempFiles } from './file/writeAtomic.js';
import { readInUtilityProcess } from './codec/utility-host.js';
import { installIpc } from './ipc/install.js';
import { preferencesStore } from './preferences/store.js';
import { applyThemeToApp } from './theme-apply.js';
import { viewLaunchArgument, type AppDocumentView } from '../shared/document-view.js';
import { zoomLaunchArgument, type ZoomPreset } from '../shared/zoom.js';
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

let mainWindow: BrowserWindow | null = null;

function deliverLaunchPaths(files: FileService, paths: readonly string[]): void {
  const window = mainWindow;
  if (window === null || window.isDestroyed()) {
    return;
  }
  void openLaunchPaths(files, paths, (result) => {
    sendFileActivated(window, result);
  });
}

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

function createWindow(theme: ThemeSetting, zoom: ZoomPreset, view: AppDocumentView): void {
  // Before the window exists, so the first frame is already the chosen theme.
  activateThemeSource(nativeTheme, theme);
  const frame = frameForNativeTheme(nativeTheme, readContrastColors);
  const webPreferences = {
    ...secureWebPreferences(path.join(__dirname, '../preload/index.js')),
    additionalArguments: [themeLaunchArgument(theme), zoomLaunchArgument(zoom), viewLaunchArgument(view)],
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
  // The document zoom is the status-bar presets. Chromium's own zoom stays at 1.
  void window.webContents.setVisualZoomLevelLimits(1, 1);
  window.webContents.on('zoom-changed', () => {
    if (window.isDestroyed() || window.webContents.getZoomFactor() === 1) {
      return;
    }
    window.webContents.setZoomFactor(1);
  });
  mainWindow = window;
  window.on('closed', () => {
    if (mainWindow === window) {
      mainWindow = null;
    }
  });

  window.webContents.on('context-menu', (event, params) => {
    event.preventDefault();
    if (window.isDestroyed()) {
      return;
    }
    window.webContents.send('spell:context', spellContextFromMenuParams(params));
  });

  window.webContents.on('console-message', (details) => {
    if (details.message.startsWith('OBELISK_PRELOAD ')) {
      reportSecurity(details.message);
    }
  });

  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error(`Renderer failed to load (${errorCode}): ${errorDescription} ${validatedURL}`);
  });

  window.webContents.on('render-process-gone', (_event, details) => {
    console.error(
      `Renderer process gone: reason=${details.reason} exitCode=${details.exitCode}`,
    );
  });

  window.webContents.on('unresponsive', () => {
    console.error('Renderer became unresponsive');
  });

  window.webContents.on('responsive', () => {
    console.error('Renderer became responsive again');
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
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
    return;
  }

  const store = preferencesStore(userData);
  const theme = store.readThemeSetting();
  const zoom = store.readZoom();
  const view = store.readView();
  installContentsGuards();
  const files = installIpc(undefined, {
    onThemeChanged: (next) => {
      applyThemeToApp(nativeTheme, next, process.platform);
    },
  });
  installThemeIpc(() => preferencesStore(userData).readThemeSetting());
  const coldLaunchPaths = launchPathsFromArgv(process.argv);

  app.on('second-instance', (_event, argv) => {
    const window = mainWindow;
    if (window !== null && !window.isDestroyed()) {
      if (window.isMinimized()) {
        window.restore();
      }
      window.focus();
    }
    deliverLaunchPaths(files, launchPathsFromArgv(argv));
  });

  void app.whenReady().then(() => {
    installSessionSecurity({
      onBlocked: (url) => {
        reportSecurity(`OBELISK_REQUEST_BLOCKED ${url}`);
      },
      onPermission: (kind) => {
        reportSecurity(`OBELISK_PERMISSION_DENIED ${kind}`);
      },
    });
    installSpellChecker(session.defaultSession);
    installAppProtocol(path.join(__dirname, '../renderer'));
    createWindow(theme, zoom, view);
    const window = mainWindow;
    if (window !== null) {
      window.webContents.once('did-finish-load', () => {
        const sessionPaths = sessionPathsForLaunch(userData);
        const launchPaths = sessionPaths.length === 0
          ? coldLaunchPaths
          : [...sessionPaths, ...coldLaunchPaths.filter((entry) => !sessionPaths.includes(entry))];
        deliverLaunchPaths(files, launchPaths);
      });
    }
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
// Leftover temp files in app data. A document folder is cleaned on the next save there.
void removeStaleTempFiles(userData).catch((error: unknown) => {
  console.error(error);
});
if (process.env.OBELISK_PACKAGE_IO === '1') {
  const request = readPackageIoRequest(process.env);
  if (!request.ok) {
    console.error(request.message);
    app.exit(1);
  } else {
    const ioRequest = request.request;
    void app.whenReady().then(async () => {
      try {
        await runPackagedIoCheck(ioRequest, readInUtilityProcess);
        console.log(`OBELISK_PACKAGE_IO_OK open=${ioRequest.openText} save=${ioRequest.saveText}`);
        app.exit(0);
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        app.exit(1);
      }
    }).catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      app.exit(1);
    });
  }
} else if (process.env.OBELISK_PACKAGED_SMOKE === '1') {
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
