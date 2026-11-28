/** Tab-order opens first; the saved active path is opened last so it stays selected. */
export function sessionActivationOrder(paths: readonly string[], activePath: string | null): string[] {
  if (activePath === null || !paths.includes(activePath)) {
    return [...paths];
  }
  const rest = paths.filter((entry) => entry !== activePath);
  return [...rest, activePath];
}