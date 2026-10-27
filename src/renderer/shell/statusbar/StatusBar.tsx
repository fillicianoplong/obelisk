import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CountItems, ViewItem, ZoomItem } from './items.js';
import { LiveRegion } from './LiveRegion.js';
import { isSaveState, nextViewLabel, saveStateLabel, textCounts } from './model.js';
import type { SaveState } from './model.js';
import { SaveStateItem } from './SaveStateItem.js';

interface StatusBarProps {
  text: string;
  saveState: SaveState;
}

interface StatusCommands {
  show(state: string): void;
  clear(): void;
}

// The bar is the status region. role="status" names it for Narrator.
// aria-live="off" keeps keystrokes from reading the counts. Save-state
// changes go out through the polite live region and do not move focus.
export function StatusBar({ text, saveState }: StatusBarProps) {
  // The editor publishes the active tab's text on each edit, inside the 250 ms count limit.
  const counts = textCounts(text);
  const barRef = useRef<HTMLElement>(null);
  const viewRef = useRef<HTMLSpanElement>(null);
  const overflowAt = useRef<number | null>(null);
  const [preview, setPreview] = useState<SaveState | null>(null);
  const [trackedSaveState, setTrackedSaveState] = useState(saveState);
  if (saveState !== trackedSaveState) {
    setTrackedSaveState(saveState);
    setPreview(null);
  }
  const shown = preview ?? saveState;

  const setViewNode = useCallback((node: HTMLSpanElement | null) => {
    viewRef.current = node;
  }, []);

  useLayoutEffect(() => {
    const bar = barRef.current;
    const view = viewRef.current;
    if (bar === null || view === null) {
      return undefined;
    }
    const update = () => {
      const shownNow = !view.classList.contains('status-view-hidden');
      const overflows = shownNow && bar.scrollWidth > bar.clientWidth + 1;
      const decision = nextViewLabel(bar.clientWidth, overflows, overflowAt.current, shownNow);
      overflowAt.current = decision.overflowAt;
      view.classList.toggle('status-view-hidden', !decision.show);
    };
    update();
    const observer = new ResizeObserver(() => {
      update();
    });
    observer.observe(bar);
    return () => {
      observer.disconnect();
    };
  }, [text, shown]);

  useEffect(() => {
    const bar = barRef.current;
    if (bar === null) {
      return undefined;
    }
    // Saving, Not saved, and Autosave paused have no flow yet.
    // show() displays them on this bar before that work lands.
    const commands: StatusCommands = {
      show(state: string) {
        if (isSaveState(state)) {
          setPreview(state);
        }
      },
      clear() {
        setPreview(null);
      },
    };
    Object.defineProperty(bar, 'statusCommands', {
      configurable: true,
      value: commands,
    });
    return () => {
      delete (bar as HTMLElement & { statusCommands?: StatusCommands }).statusCommands;
    };
  }, []);

  return (
    <footer
      className="status-bar"
      data-region="status-bar"
      data-save-state={shown}
      role="status"
      aria-label="Status bar"
      aria-live="off"
      tabIndex={-1}
      ref={barRef}
    >
      <CountItems counts={counts} />
      <div className="status-bar-trailing">
        <SaveStateItem state={shown} />
        <ViewItem itemRef={setViewNode} />
        <ZoomItem />
      </div>
      <LiveRegion label={saveStateLabel(shown)} />
    </footer>
  );
}
