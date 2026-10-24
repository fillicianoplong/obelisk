import { protocol } from 'electron';
import { readAppFile } from './app-files.js';
import { APP_SCHEME } from './app-path.js';
import { CONTENT_SECURITY_POLICY } from './csp.js';

const SECURITY_HEADERS = {
  'Content-Security-Policy': CONTENT_SECURITY_POLICY,
  'X-Content-Type-Options': 'nosniff',
};

export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
        bypassCSP: false,
        allowServiceWorkers: false,
      },
    },
  ]);
}

export function installAppProtocol(root: string): void {
  protocol.handle(APP_SCHEME, async (request) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', {
        status: 405,
        headers: { ...SECURITY_HEADERS, Allow: 'GET, HEAD' },
      });
    }

    const file = await readAppFile(root, request.url);
    if (file === null) {
      return new Response('Not found', {
        status: 404,
        headers: { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }

    return new Response(request.method === 'HEAD' ? null : new Uint8Array(file.data), {
      status: 200,
      headers: { ...SECURITY_HEADERS, 'Content-Type': file.mime },
    });
  });
}
