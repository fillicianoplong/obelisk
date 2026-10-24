// The product window installs this same request filter and also sends the CSP.
// CSP rejects fetch inside the renderer, so this harness leaves the policy off
// and the http(s) requests reach main, where the filter cancels them.
import { app, BrowserWindow, session } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installRequestFilter } from '../../../dist/main/security/session.js';
import { secureWebPreferences } from '../../../dist/main/security/window-options.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const page = `<!DOCTYPE html>
<html lang="en">
  <body>
    <script>
      const urls = [
        'http://example.invalid/filter-probe',
        'https://example.invalid/filter-probe',
      ];
      Promise.all(urls.map(async (url) => {
        try {
          await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(2000) });
          return { url, blocked: false, name: '' };
        } catch (error) {
          return {
            url,
            blocked: true,
            name: error instanceof Error ? error.name : 'Error',
          };
        }
      })).then((result) => {
        console.log('OBELISK_FILTER_RESULT ' + JSON.stringify(result));
      });
    </script>
  </body>
</html>`;

app.once('ready', () => {
  installRequestFilter(session.defaultSession, {
    onBlocked(url) {
      console.log(`OBELISK_REQUEST_BLOCKED ${url}`);
    },
  });

  const window = new BrowserWindow({
    show: false,
    webPreferences: secureWebPreferences(path.join(root, 'dist/preload/index.js')),
  });

  window.webContents.on('console-message', (details) => {
    console.log(details.message);
  });
  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error(`Filter probe failed to load (${errorCode}): ${errorDescription} ${validatedURL}`);
  });

  void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page)}`);
});

setTimeout(() => {
  console.error('OBELISK_FILTER_TIMEOUT');
  app.exit(1);
}, 15_000);
