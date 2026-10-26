export interface FocusTargetParts {
  id: string;
  region: string | null;
  classes: readonly string[];
  tabId: string | null;
}

export function focusTargetKey(parts: FocusTargetParts): string | null {
  if (parts.id !== '') {
    return `id:${parts.id}`;
  }
  if (parts.classes.includes('tab-new')) {
    return 'tab-new';
  }
  if (parts.classes.includes('status-save')) {
    return 'status-save';
  }
  if (parts.classes.includes('tab-close') && parts.tabId !== null && parts.tabId !== '') {
    return `close:${parts.tabId}`;
  }
  if (parts.region !== null && parts.region !== '') {
    return `region:${parts.region}`;
  }
  return null;
}
