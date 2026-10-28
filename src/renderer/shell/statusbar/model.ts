// Words are whitespace-separated runs of non-space text.
// "a  b\tc" is three words. An empty or all-whitespace string is zero words.
// A line break from the editor is whitespace, so it separates words.
// Characters are UTF-16 code units and include spaces, tabs, and line breaks.

export const SAVE_STATES = ['saved', 'saving', 'unsaved', 'not-saved', 'autosave-paused'] as const;

export type SaveState = (typeof SAVE_STATES)[number];

export const SAVE_STATE_LABELS: Record<SaveState, string> = {
  saved: 'Saved',
  saving: 'Saving…',
  unsaved: 'Unsaved changes',
  'not-saved': 'Not saved',
  'autosave-paused': 'Autosave paused',
};

// Shown for Autosave paused. Later conflict handling can keep this copy.
export const AUTOSAVE_PAUSED_TOOLTIP =
  'Autosave paused. Another program changed this file. Autosave resumes after you save (Ctrl+S).';

// Hover waits. Keyboard focus shows the tooltip on the same turn.
export const TOOLTIP_HOVER_DELAY_MS = 500;

export type TooltipTrigger = 'hover' | 'keyboard';

export function tooltipDelay(trigger: TooltipTrigger): number {
  if (trigger === 'keyboard') {
    return 0;
  }
  return TOOLTIP_HOVER_DELAY_MS;
}

// Page count and zoom are placeholders until layout and zoom exist.
export const PAGE_LABEL = 'Page 1 of 1';

export const VIEW_LABEL = 'Pages';

export const ZOOM_LABEL = '100%';

// The smallest window is 640 CSS pixels wide. The view label drops first.
export const SMALLEST_WINDOW_WIDTH = 640;

const SAVE_STATE_SET: ReadonlySet<string> = new Set(SAVE_STATES);

export function isSaveState(value: string): value is SaveState {
  return SAVE_STATE_SET.has(value);
}

export function saveStateLabel(state: SaveState): string {
  return SAVE_STATE_LABELS[state];
}

export function saveStateTooltip(state: SaveState): string | null {
  if (state === 'autosave-paused') {
    return AUTOSAVE_PAUSED_TOOLTIP;
  }
  return null;
}

// A tab that matches its saved document shows Saved. A tab that does not shows
// Unsaved changes. Saving… and Not saved come from the save in flight.
export function saveStateFromChanged(changed: boolean): SaveState {
  if (changed) {
    return 'unsaved';
  }
  return 'saved';
}

export function wordCount(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return 0;
  }
  return trimmed.split(/\s+/).length;
}

export function characterCount(text: string): number {
  return text.length;
}

function countLabel(count: number, singular: string, plural: string): string {
  const amount = count.toLocaleString('en-US');
  return `${amount} ${count === 1 ? singular : plural}`;
}

export interface TextCounts {
  words: number;
  characters: number;
  wordsLabel: string;
  charactersLabel: string;
}

export function textCounts(text: string): TextCounts {
  const words = wordCount(text);
  const characters = characterCount(text);
  return {
    words,
    characters,
    wordsLabel: countLabel(words, 'word', 'words'),
    charactersLabel: countLabel(characters, 'character', 'characters'),
  };
}

export interface ViewLabelDecision {
  show: boolean;
  overflowAt: number | null;
}

// The view label is the first item to drop. Counts, save state, and zoom stay.
export function nextViewLabel(
  width: number,
  overflowsWithView: boolean,
  overflowAt: number | null,
  currentlyShown: boolean,
): ViewLabelDecision {
  if (width <= SMALLEST_WINDOW_WIDTH) {
    return { show: false, overflowAt };
  }
  if (currentlyShown && overflowsWithView) {
    return { show: false, overflowAt: width };
  }
  if (!currentlyShown && overflowAt !== null && width <= overflowAt) {
    return { show: false, overflowAt };
  }
  return { show: true, overflowAt: null };
}

// Null means "do not announce". The first value is the resting label, not a change.
// The same label again, including a count-only render, stays quiet.
export function saveStateAnnouncement(previous: string | null, next: string): string | null {
  if (previous === null || previous === next) {
    return null;
  }
  return next;
}
