import { app, BrowserWindow, Menu } from 'electron';
import path from 'node:path';
import { APP_NAME } from '../shared/app-info.js';

const WINDOW_WIDTH = 1280;
const WINDOW_HEIGHT = 800;

app.setName(APP_NAME);
Menu.setApplicationMenu(null);

function createWindow(): void {
  const window = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    title: APP_NAME,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
    },
  });

  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    console.error(`Renderer failed to load (${errorCode}): ${errorDescription}`);
  });

  void window.loadFile(path.join(__dirname, '../renderer/index.html'));
}

void app.whenReady().then(() => {
  createWindow();
});

app.on('window-all-closed', () => {
  app.quit();
});
