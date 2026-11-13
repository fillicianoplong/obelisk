export function runActiveEditorFormatCommand(command: string): boolean {
  const page = document.querySelector<HTMLElement>('[data-region="page-editor"]');
  if (page === null) {
    return false;
  }
  const commands = (page as HTMLElement & {
    editorCommands?: { runFormatMenu?: (menuId: string) => void };
  }).editorCommands;
  if (commands?.runFormatMenu === undefined) {
    return false;
  }
  if (!command.startsWith('format-')) {
    return false;
  }
  commands.runFormatMenu(command);
  return true;
}
