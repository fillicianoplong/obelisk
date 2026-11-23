/** Editor code asks the shell to run a menu command, such as opening the Link dialog. */
export const EDITOR_SHELL_COMMAND = 'obelisk:editor-shell-command';

export interface EditorShellCommandDetail {
  command: string;
}

export function requestShellCommand(command: string, target?: EventTarget | null): void {
  const view = (target ?? (typeof window === 'undefined' ? null : window)) as
    (EventTarget & { CustomEvent?: typeof CustomEvent }) | null;
  if (view === null || typeof view.dispatchEvent !== 'function') {
    return;
  }
  const Ctor = view.CustomEvent ?? globalThis.CustomEvent;
  if (typeof Ctor !== 'function') {
    return;
  }
  view.dispatchEvent(new Ctor<EditorShellCommandDetail>(EDITOR_SHELL_COMMAND, { detail: { command } }));
}
