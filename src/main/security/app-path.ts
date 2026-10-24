import path from 'node:path';

export const APP_SCHEME = 'app';
export const APP_HOST = 'obelisk';
export const APP_START_URL = 'app://obelisk/index.html';

const MIME_TYPES: Readonly<Record<string, string>> = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.mjs': 'text/javascript; charset=utf-8',
  '.otf': 'font/otf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function isInsideRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  if (relative === '' || path.isAbsolute(relative)) {
    return false;
  }
  return !relative.split(path.sep).includes('..');
}

export function mimeTypeFor(filePath: string): string | null {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] ?? null;
}

export function resolveAppFile(root: string, requestUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return null;
  }

  if (url.protocol !== `${APP_SCHEME}:` || url.hostname.toLowerCase() !== APP_HOST) {
    return null;
  }
  if (url.username !== '' || url.password !== '') {
    return null;
  }
  if (url.pathname === '' || url.pathname.endsWith('/')) {
    return null;
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  if (decoded.includes('\0') || decoded.includes('\\')) {
    return null;
  }

  const stripped = decoded.replace(/^\/+/, '');
  if (
    stripped === '' ||
    path.posix.isAbsolute(stripped) ||
    path.win32.isAbsolute(stripped)
  ) {
    return null;
  }

  const segments = stripped.split('/');
  if (
    segments.some(
      (segment) =>
        segment === '' || segment === '.' || segment === '..' || segment.includes(':'),
    )
  ) {
    return null;
  }

  const rootResolved = path.resolve(root);
  const candidate = path.resolve(rootResolved, ...segments);
  if (!isInsideRoot(rootResolved, candidate)) {
    return null;
  }
  return candidate;
}
