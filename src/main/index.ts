import { app, BrowserWindow, Menu } from 'electron';
import path from 'node:path';
import { APP_NAME } from '../shared/app-info.js';
import { APP_START_URL } from './security/app-path.js';
import { installAppProtocol, registerAppScheme } from './security/app-protocol.js';
import { installContentsGuards } from './security/navigation.js';
import { installSessionSecurity } from './security/session.js';
import { installIpc } from './ipc/install.js';
import { secureWebPreferences } from './security/window-options.js';

const WINDOW_WIDTH = 1280;
const WINDOW_HEIGHT = 800;

registerAppScheme();
installContentsGuards();
installIpc();

app.setName(APP_NAME);
Menu.setApplicationMenu(null);

function reportSecurity(line: string): void {
  if (process.env.OBELISK_SECURITY_REPORT === '1') {
    console.log(line);
  }
}

function createWindow(): void {
  const webPreferences = secureWebPreferences(path.join(__dirname, '../preload/index.js'));
  reportSecurity(
    `OBELISK_WINDOW_OPTIONS ${JSON.stringify({
      contextIsolation: webPreferences.contextIsolation,
      nodeIntegration: webPreferences.nodeIntegration,
      sandbox: webPreferences.sandbox,
      webviewTag: webPreferences.webviewTag,
    })}`,
  );

  const window = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    title: APP_NAME,
    backgroundColor: '#e7e2d8',
    webPreferences,
  });

  window.webContents.on('console-message', (details) => {
    if (details.message.startsWith('OBELISK_PRELOAD ')) {
      reportSecurity(details.message);
    }
  });

  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error(`Renderer failed to load (${errorCode}): ${errorDescription} ${validatedURL}`);
  });

  void window.loadURL(APP_START_URL);
}

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
  createWindow();
}).catch((error: unknown) => {
  console.error(error);
  app.exit(1);
});

app.on('window-all-closed', () => {
  app.quit();
});
