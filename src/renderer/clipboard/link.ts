import { classifyLinkAddress } from '../../shared/links/address.js';

/**
 * http, https, and mailto only, checked by the same address rules as the
 * link dialog and the file format. javascript:, file:, data:, custom schemes,
 * and network paths are dropped. The stored address is the parsed href, and
 * it has to pass the same check again so the editor keeps it as a link.
 */
export function allowedLinkAddress(raw: string): string | null {
  const checked = classifyLinkAddress(raw.trim());
  if (!checked.ok) {
    return null;
  }
  const stored = classifyLinkAddress(checked.href);
  return stored.ok ? stored.address : null;
}