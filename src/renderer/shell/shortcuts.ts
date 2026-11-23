export type ShellShortcut = 'new' | 'open' | 'settings' | 'save' | 'save-as';

export type EditShellShortcut = 'edit-find' | 'edit-replace';

export interface ShortcutKey {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  repeat: boolean;
}

// Ctrl+S saves. Ctrl+Shift+S is Save as. The menu shows the same shortcuts.
export function shellShortcut(event: ShortcutKey): ShellShortcut | null {
  if (event.altKey || event.repeat || !(event.ctrlKey || event.metaKey)) {
    return null;
  }
  const key = event.key.toLowerCase();
  if (key === 's' && event.shiftKey) {
    return 'save-as';
  }
  if (event.shiftKey) {
    return null;
  }
  if (key === 's') {
    return 'save';
  }
  if (key === 'n') {
    return 'new';
  }
  if (key === 'o') {
    return 'open';
  }
  if (key === ',') {
    return 'settings';
  }
  return null;
}

export function linkShellShortcut(event: ShortcutKey): 'insert-link' | null {
  if (event.altKey || event.shiftKey || event.repeat || !(event.ctrlKey || event.metaKey)) {
    return null;
  }
  if (event.key.toLowerCase() === 'k') {
    return 'insert-link';
  }
  return null;
}

export function editShellShortcut(event: ShortcutKey): EditShellShortcut | null {
  if (event.altKey || event.repeat || !(event.ctrlKey || event.metaKey) || event.shiftKey) {
    return null;
  }
  const key = event.key.toLowerCase();
  if (key === 'f') {
    return 'edit-find';
  }
  if (key === 'h') {
    return 'edit-replace';
  }
  return null;
}
