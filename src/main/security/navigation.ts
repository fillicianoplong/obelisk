import { app, type WebContents } from 'electron';

function blockNavigation(event: { preventDefault: () => void }): void {
  event.preventDefault();
}

export function attachContentsGuards(contents: WebContents): void {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (event) => {
    blockNavigation(event);
  });
  contents.on('will-redirect', (event) => {
    blockNavigation(event);
  });
  contents.on('will-frame-navigate', (event) => {
    blockNavigation(event);
  });
  contents.on('will-attach-webview', (event) => {
    blockNavigation(event);
  });
}

export function installContentsGuards(): void {
  app.on('web-contents-created', (_event, contents) => {
    attachContentsGuards(contents);
  });
}
