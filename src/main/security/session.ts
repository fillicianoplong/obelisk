import { session, type Session } from 'electron';
import { CONTENT_SECURITY_POLICY } from './csp.js';
import { isAllowedRequestUrl } from './request-policy.js';

const REPORTED_PERMISSIONS = new Set([
  'camera',
  'display-capture',
  'media',
  'microphone',
  'notifications',
]);

export interface SessionSecurityHandlers {
  onBlocked?: (url: string) => void;
  onPermission?: (kind: string) => void;
}

function notePermission(
  handlers: SessionSecurityHandlers,
  kind: 'request' | 'check',
  permission: string,
): void {
  if (REPORTED_PERMISSIONS.has(permission)) {
    handlers.onPermission?.(`${kind}:${permission}`);
  }
}

function headerList(headers: Record<string, string[]>, name: string): string[] {
  const values: string[] = [];
  for (const [key, headerValues] of Object.entries(headers)) {
    if (key.toLowerCase() === name) {
      values.push(...headerValues);
    }
  }
  return values;
}

export function installRequestFilter(ses: Session, handlers: SessionSecurityHandlers): void {
  ses.webRequest.onBeforeRequest((details, callback) => {
    const allowed = isAllowedRequestUrl(details.url);
    if (!allowed) {
      handlers.onBlocked?.(details.url);
    }
    callback({ cancel: !allowed });
  });
}

export function installContentSecurityPolicy(ses: Session): void {
  ses.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders: Record<string, string[]> = { ...details.responseHeaders };
    const existing = headerList(responseHeaders, 'content-security-policy');
    if (!existing.includes(CONTENT_SECURITY_POLICY)) {
      responseHeaders['Content-Security-Policy'] = [...existing, CONTENT_SECURITY_POLICY];
    }
    callback({ responseHeaders });
  });
}

export function installPermissionDenials(ses: Session, handlers: SessionSecurityHandlers): void {
  ses.setPermissionRequestHandler((_contents, permission, callback) => {
    notePermission(handlers, 'request', permission);
    callback(false);
  });
  ses.setPermissionCheckHandler((_contents, permission) => {
    notePermission(handlers, 'check', permission);
    return false;
  });
  ses.setDevicePermissionHandler(() => false);
  ses.setDisplayMediaRequestHandler((_request, callback) => {
    handlers.onPermission?.('request:display-capture');
    callback(null);
  });
}

export function installSessionSecurity(handlers: SessionSecurityHandlers = {}): void {
  const ses = session.defaultSession;
  installRequestFilter(ses, handlers);
  installContentSecurityPolicy(ses);
  installPermissionDenials(ses, handlers);
}
