// Links reference: http, https, and mailto only, up to 2,048 characters.
// file:, javascript:, and network paths are refused. The numbers match
// LINK_SCHEMES and LINK_MAX_CHARS in the format limits.

const LINK_MAX_CHARS = 2048;
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

export const LINK_SCHEME_MESSAGE = 'Link scheme is not allowed.';
export const LINK_ADDRESS_MESSAGE = 'Link address is not allowed.';

export type LinkScheme = 'http' | 'https' | 'mailto';

export type LinkRefusal = 'empty' | 'length' | 'scheme' | 'network' | 'invalid';

export type ClassifiedLink =
  | { ok: true; scheme: LinkScheme; address: string; href: string }
  | { ok: false; reason: LinkRefusal };

export function linkRefusalMessage(reason: LinkRefusal): string {
  return reason === 'scheme' ? LINK_SCHEME_MESSAGE : LINK_ADDRESS_MESSAGE;
}

function hasControlOrSpace(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x20 || code === 0x7f) {
      return true;
    }
  }
  return false;
}

function schemeName(protocol: string): LinkScheme | null {
  if (protocol === 'http:') {
    return 'http';
  }
  if (protocol === 'https:') {
    return 'https';
  }
  if (protocol === 'mailto:') {
    return 'mailto';
  }
  return null;
}

// Length is checked by the caller. This rejects schemes, network paths, and
// addresses the URL parser would quietly rewrite into a different target.
function inspectLink(address: string): ClassifiedLink {
  if (address.length === 0) {
    return { ok: false, reason: 'empty' };
  }
  if (address.includes('\\') || address.startsWith('//') || address.startsWith('\\\\')) {
    return { ok: false, reason: 'network' };
  }

  let url: URL | null = null;
  try {
    url = new URL(address);
  } catch {
    // A network path or other non-URL stays refused below.
  }

  if (hasControlOrSpace(address)) {
    if (url !== null && schemeName(url.protocol) === null) {
      return { ok: false, reason: 'scheme' };
    }
    return { ok: false, reason: 'invalid' };
  }
  if (url === null) {
    return { ok: false, reason: 'invalid' };
  }

  const scheme = schemeName(url.protocol);
  if (scheme === null) {
    return { ok: false, reason: 'scheme' };
  }

  const lower = address.toLowerCase();
  if (scheme === 'http' || scheme === 'https') {
    const prefix = `${scheme}://`;
    if (!lower.startsWith(prefix)) {
      return { ok: false, reason: 'invalid' };
    }
    // http:/// and http://// are network-path forms the parser rewrites.
    if (lower.startsWith(`${prefix}/`)) {
      return { ok: false, reason: 'network' };
    }
    if (url.hostname.length === 0) {
      return { ok: false, reason: 'invalid' };
    }
  } else if (!lower.startsWith('mailto:') || url.pathname.length === 0) {
    return { ok: false, reason: 'invalid' };
  }

  return { ok: true, scheme, address, href: url.href };
}

export function classifyLinkAddress(address: string): ClassifiedLink {
  if (typeof address !== 'string' || address.length === 0) {
    return { ok: false, reason: 'empty' };
  }
  if (address.length > LINK_MAX_CHARS) {
    return { ok: false, reason: 'length' };
  }
  return inspectLink(address);
}

export { ALLOWED_PROTOCOLS, LINK_MAX_CHARS };
