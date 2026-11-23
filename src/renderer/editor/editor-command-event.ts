/** Editor code asks the shell to run a menu command, such as opening the Link dialog. */
export const EDITOR_SHELL_COMMAND = 'obelisk:editor-shell-command';

export interface EditorShellCommandDetail {
  command: string;
  /** For link-open: the address to offer. The shell still asks before opening it. */
  address?: string;
}

export function requestShellCommand(command: string, target?: EventTarget | null, address?: string): void {
  const view = (target ?? (typeof window === 'undefined' ? null : window)) as
    (EventTarget & { CustomEvent?: typeof CustomEvent }) | null;
  if (view === null || typeof view.dispatchEvent !== 'function') {
    return;
  }
  const Ctor = view.CustomEvent ?? globalThis.CustomEvent;
  if (typeof Ctor !== 'function') {
    return;
  }
  const detail: EditorShellCommandDetail = address === undefined ? { command } : { command, address };
  view.dispatchEvent(new Ctor<EditorShellCommandDetail>(EDITOR_SHELL_COMMAND, { detail }));
}
