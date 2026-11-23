import { ipcError } from '../../shared/ipc/errors.js';
import type { LinkOpenResult } from '../../shared/ipc/types.js';
import { classifyLinkAddress, linkRefusalMessage } from '../../shared/links/address.js';

export interface LinkOpenPort {
  openExternal(href: string): Promise<void>;
}

function refused(reason: 'scheme' | 'address', message: string): LinkOpenResult {
  return { status: 'refused', reason, message };
}

// Opens only an allowlisted http, https, or mailto href, the same way Word and
// Google Docs open a link right away. Anything else is refused before the
// operating system sees it. Obelisk does not fetch the address itself.
export async function openAllowedLink(
  address: string,
  port: LinkOpenPort,
): Promise<LinkOpenResult> {
  const checked = classifyLinkAddress(address);
  if (!checked.ok) {
    const reason = checked.reason === 'scheme' ? 'scheme' : 'address';
    return refused(reason, linkRefusalMessage(checked.reason));
  }

  try {
    await port.openExternal(checked.href);
  } catch {
    return ipcError('EACCES', 'The address could not be opened.');
  }
  return { status: 'ok' };
}
