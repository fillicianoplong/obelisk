export function runActiveEditorMenuCommand(command: string): boolean {
  const page = document.querySelector<HTMLElement>('[data-region="page-editor"]');
  if (page === null) {
    return false;
  }
  const commands = (page as HTMLElement & {
    editorCommands?: { runMenuCommand?: (menuId: string) => void };
  }).editorCommands;
  if (commands?.runMenuCommand === undefined) {
    return false;
  }
  commands.runMenuCommand(command);
  return true;
}