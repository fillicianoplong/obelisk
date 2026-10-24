import { APP_HOST, APP_PAGE_PATH, APP_SCHEME } from '../../shared/app-page.js';

export function isAppPageSender(senderUrl: string | null | undefined): boolean {
  if (typeof senderUrl !== 'string' || senderUrl.length === 0 || senderUrl.length > 2048) {
    return false;
  }
  if (senderUrl.includes('?') || senderUrl.includes('#')) {
    return false;
  }
  let url: URL;
  try {
    url = new URL(senderUrl);
  } catch {
    return false;
  }
  return (
    url.protocol === `${APP_SCHEME}:` &&
    url.hostname.toLowerCase() === APP_HOST &&
    url.port === '' &&
    url.username === '' &&
    url.password === '' &&
    url.pathname === APP_PAGE_PATH
  );
}
