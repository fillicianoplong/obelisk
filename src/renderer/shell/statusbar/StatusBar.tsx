import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { STATUS_BAR_LABEL } from '../focus/regions.js';
import { CountItems, ViewItem } from './items.js';
import { statusControlAfter } from './focus.js';
import { LiveRegion } from './LiveRegion.js';
import { PAGE_LABEL, VIEW_LABEL, isSaveState, nextViewLabel, saveStateLabel, saveStateTooltip, textCounts } from './model.js';
import type { SaveState } from './model.js';
import { SaveStateItem } from './SaveStateItem.js';
import { ZoomControl } from './ZoomControl.js';
import { DEFAULT_ZOOM, type ZoomPreset } from '../../../shared/zoom.js';

interface StatusBarProps {
  text: string;
  saveState: SaveState;
  pageLabel?: string;
  viewName?: string;
  zoom?: ZoomPreset;
  onZoom?: (zoom: ZoomPreset) => void;
}

interface StatusCommands {
  show(state: string): void;
  clear(): void;
}

// The bar is the status region. role="status" names it for Narrator.
// aria-live="off" keeps keystrokes from reading the counts. Save-state
// changes go out through the polite live region and do not move focus.
export function StatusBar({
  text,
  saveState,
  pageLabel = PAGE_LABEL,
  viewName = VIEW_LABEL,
  zoom = DEFAULT_ZOOM,
  onZoom = () => {},
}: StatusBarProps) {
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

  const onBarKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
      return;
    }
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return;
    }
    const bar = barRef.current;
    const active = document.activeElement;
    if (bar === null || !(active instanceof HTMLElement) || !bar.contains(active)) {
      return;
    }
    if (active.closest('.status-zoom-menu') !== null) {
      return;
    }
    const current = active.classList.contains('status-zoom')
      ? 'zoom'
      : active.classList.contains('status-save')
        ? 'save'
        : active === bar
          ? 'bar'
          : null;
    if (current === null) {
      return;
    }
    const next = statusControlAfter(current, event.key, saveStateTooltip(shown) !== null);
    if (next === null) {
      return;
    }
    event.preventDefault();
    const selector = next === 'zoom' ? '.status-zoom' : '.status-save';
    bar.querySelector<HTMLElement>(selector)?.focus();
  };

  useEffect(() => {
    const bar = barRef.current;
    if (bar === null) {
      return undefined;
    }
    // Saving, Not saved, Autosave paused, and autosave timing are wired in Shell.
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
      aria-label={STATUS_BAR_LABEL}
      aria-live="off"
      tabIndex={-1}
      ref={barRef}
      onKeyDown={onBarKeyDown}
    >
      <CountItems counts={counts} pageLabel={pageLabel} />
      <div className="status-bar-trailing">
        <SaveStateItem state={shown} />
        <ViewItem itemRef={setViewNode} label={viewName} />
        <ZoomControl zoom={zoom} onZoom={onZoom} />
      </div>
      <LiveRegion label={saveStateLabel(shown)} />
    </footer>
  );
}
