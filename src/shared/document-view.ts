// The last Pages or Pageless choice for the whole app. It is not a field
// of one document. A saved value that is neither of those is Pages.

export const DOCUMENT_VIEW_VALUES = ['pages', 'pageless'] as const;

export type AppDocumentView = (typeof DOCUMENT_VIEW_VALUES)[number];

export const DEFAULT_DOCUMENT_VIEW: AppDocumentView = 'pages';

// Passed into the renderer before the page paints. The preload reads it
// synchronously; the page itself has no Node and does not see process.
export const VIEW_ARG_PREFIX = '--obelisk-view=';

const VIEW_SET: ReadonlySet<string> = new Set(DOCUMENT_VIEW_VALUES);

export function isDocumentView(value: unknown): value is AppDocumentView {
  return typeof value === 'string' && VIEW_SET.has(value);
}

export function viewFromSaved(value: unknown): AppDocumentView {
  return isDocumentView(value) ? value : DEFAULT_DOCUMENT_VIEW;
}

export function viewLaunchArgument(view: AppDocumentView): string {
  return `${VIEW_ARG_PREFIX}${view}`;
}

export function viewFromArguments(argv: readonly string[]): AppDocumentView {
  let found: string | undefined;
  for (const arg of argv) {
    if (arg.startsWith(VIEW_ARG_PREFIX)) {
      found = arg.slice(VIEW_ARG_PREFIX.length);
    }
  }
  return viewFromSaved(found);
}
