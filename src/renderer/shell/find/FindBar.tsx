import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { FIND_BAR_REGION } from '../focus/regions.js';
import { resetPageFocusToPointer } from '../page-focus.js';
import { activeEditorFindCommands } from './find-bridge.js';
import type { FindSnapshot } from './find-bridge.js';

interface FindBarProps {
  visible: boolean;
  onVisibilityChange: (open: boolean) => void;
}

function emptySnapshot(): FindSnapshot {
  return {
    open: false,
    showReplace: false,
    query: '',
    replacement: '',
    matchCase: false,
    wholeWord: false,
    matchCount: 0,
    currentIndex: 0,
  };
}

export function FindBar({ visible, onVisibilityChange }: FindBarProps) {
  const findRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  const [snap, setSnap] = useState<FindSnapshot>(emptySnapshot);

  const refresh = useCallback(() => {
    const commands = activeEditorFindCommands();
    if (commands === null) {
      setSnap(emptySnapshot());
      return;
    }
    setSnap(commands.snapshot());
  }, []);

  useLayoutEffect(() => {
    if (!visible) {
      return;
    }
    refresh();
    findRef.current?.focus({ preventScroll: true });
    findRef.current?.select();
  }, [visible, refresh]);

  useEffect(() => {
    if (!visible) {
      return undefined;
    }
    const id = window.setInterval(refresh, 100);
    return () => {
      window.clearInterval(id);
    };
  }, [visible, refresh]);

  const closeBar = useCallback(() => {
    const commands = activeEditorFindCommands();
    if (commands !== null) {
      commands.close();
    }
    onVisibilityChange(false);
    const page = document.querySelector<HTMLElement>('[data-region="page-editor"]');
    if (page instanceof HTMLElement) {
      page.focus({ preventScroll: true });
      resetPageFocusToPointer(page);
    }
    refresh();
  }, [onVisibilityChange, refresh]);

  const patch = useCallback((patch: Partial<FindSnapshot>) => {
    const commands = activeEditorFindCommands();
    if (commands === null) {
      return;
    }
    commands.patch(patch);
    refresh();
  }, [refresh]);

  const onFindInput = useCallback((value: string) => {
    patch({ query: value, currentIndex: 0 });
  }, [patch]);

  const onReplaceInput = useCallback((value: string) => {
    patch({ replacement: value });
  }, [patch]);

  const countLabel = (() => {
    if (snap.query.length === 0) {
      return '';
    }
    if (snap.matchCount === 0) {
      return '0 matches';
    }
  const current = snap.currentIndex + 1;
    return `${current} of ${snap.matchCount}`;
  })();

  if (!visible) {
    return null;
  }

  return (
    <div
      className="find-bar"
      data-region={FIND_BAR_REGION}
      role="search"
      aria-label="Find and replace"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !event.shiftKey) {
          event.preventDefault();
          closeBar();
          return;
        }
        if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
          event.preventDefault();
          const commands = activeEditorFindCommands();
          if (commands === null) {
            return;
          }
          if (event.shiftKey) {
            commands.previous();
          } else {
            commands.next();
          }
          refresh();
          return;
        }
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
          event.preventDefault();
          findRef.current?.focus({ preventScroll: true });
          findRef.current?.select();
        }
      }}
    >
      <label className="find-bar-field">
        <span className="find-bar-label">Find</span>
        <input
          ref={findRef}
          type="search"
          className="find-bar-input"
          value={snap.query}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => onFindInput(event.target.value)}
        />
      </label>
      {snap.showReplace ? (
        <label className="find-bar-field">
          <span className="find-bar-label">Replace</span>
          <input
            ref={replaceRef}
            type="text"
            className="find-bar-input"
            value={snap.replacement}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => onReplaceInput(event.target.value)}
          />
        </label>
      ) : null}
      <label className="find-bar-check">
        <input
          type="checkbox"
          checked={snap.matchCase}
          onChange={(event) => patch({ matchCase: event.target.checked, currentIndex: 0 })}
        />
        <span>Match case</span>
      </label>
      <label className="find-bar-check">
        <input
          type="checkbox"
          checked={snap.wholeWord}
          onChange={(event) => patch({ wholeWord: event.target.checked, currentIndex: 0 })}
        />
        <span>Whole word</span>
      </label>
      <span className="find-bar-count" data-find-count="">
        {countLabel}
      </span>
      <div className="find-bar-actions">
        <button
          type="button"
          className="find-bar-button"
          disabled={snap.matchCount === 0}
          onClick={() => {
            activeEditorFindCommands()?.previous();
            refresh();
          }}
        >
          Previous
        </button>
        <button
          type="button"
          className="find-bar-button"
          disabled={snap.matchCount === 0}
          onClick={() => {
            activeEditorFindCommands()?.next();
            refresh();
          }}
        >
          Next
        </button>
        {snap.showReplace ? (
          <>
            <button
              type="button"
              className="find-bar-button"
              disabled={snap.matchCount === 0}
              onClick={() => {
                activeEditorFindCommands()?.replaceCurrent();
                refresh();
              }}
            >
              Replace
            </button>
            <button
              type="button"
              className="find-bar-button"
              disabled={snap.matchCount === 0}
              onClick={() => {
                activeEditorFindCommands()?.replaceAll();
                refresh();
              }}
            >
              Replace all
            </button>
          </>
        ) : null}
        <button type="button" className="find-bar-button find-bar-close" onClick={closeBar}>
          Close
        </button>
      </div>
    </div>
  );
}