export async function resolve(specifier, context, nextResolve) {
  const parent = context.parentURL ?? '';
  const fromRenderer = parent.includes('/src/renderer/');
  if (
    fromRenderer
    && (specifier.startsWith('./') || specifier.startsWith('../'))
    && specifier.endsWith('.js')
  ) {
    const stem = specifier.slice(0, -3);
    try {
      return await nextResolve(`${stem}.ts`, context);
    } catch {
      return nextResolve(`${stem}.tsx`, context);
    }
  }
  return nextResolve(specifier, context);
}
