import { ipcError } from '../../shared/ipc/errors.js';
import type { LinkOpenResult } from '../../shared/ipc/types.js';
import {
  classifyLinkAddress,
  linkConfirmPrompt,
  linkRefusalMessage,
} from '../../shared/links/address.js';

export interface LinkOpenPort {
  confirm(address: string): Promise<boolean>;
  openExternal(href: string): Promise<void>;
}

function refused(reason: 'scheme' | 'address', message: string): LinkOpenResult {
  return { status: 'refused', reason, message };
}

// Shows the address that will be handed to the operating system, then opens
// only that allowlisted href. Obelisk does not fetch the address itself.
export async function openConfirmedLink(
  address: string,
  port: LinkOpenPort,
): Promise<LinkOpenResult> {
  const checked = classifyLinkAddress(address);
  if (!checked.ok) {
    const reason = checked.reason === 'scheme' ? 'scheme' : 'address';
    return refused(reason, linkRefusalMessage(checked.reason));
  }

  const prompt = linkConfirmPrompt(checked.href);
  const allowed = await port.confirm(prompt.message);
  if (!allowed) {
    return { status: 'cancelled' };
  }

  const again = classifyLinkAddress(checked.href);
  if (!again.ok || again.href !== checked.href || again.scheme !== checked.scheme) {
    return refused('scheme', linkRefusalMessage('scheme'));
  }

  try {
    await port.openExternal(again.href);
  } catch {
    return ipcError('EACCES', 'The address could not be opened.');
  }
  return { status: 'ok' };
}
