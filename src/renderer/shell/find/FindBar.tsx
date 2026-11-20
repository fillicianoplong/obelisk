import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { FIND_BAR_REGION } from '../focus/regions.js';
import { resetPageFocusToPointer } from '../page-focus.js';
import { editShellShortcut } from '../shortcuts.js';
import { escapeWouldCloseSomethingElse } from '../../editor/find/find-plugin.js';
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

function Glyph({ d, chevron }: { d: string; chevron?: 'right' | 'down' }) {
  return (
    <svg
      className="find-bubble-glyph"
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
      {...(chevron !== undefined ? { 'data-chevron': chevron } : {})}
    >
      <path
        d={d}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="square"
        strokeLinejoin="miter"
      />
    </svg>
  );
}

function IconButton({
  label,
  shortcut,
  pressed,
  disabled,
  word,
  expanded,
  onMouseDown,
  onClick,
  children,
}: {
  label: string;
  shortcut?: string;
  pressed?: boolean;
  disabled?: boolean;
  word?: boolean;
  expanded?: boolean;
  onMouseDown?: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onClick: () => void;
  children: ReactNode;
}) {
  const className = pressed === undefined
    ? 'find-bubble-icon'
    : word === true
      ? 'find-bubble-toggle find-bubble-toggle-word'
      : 'find-bubble-toggle';
  return (
    <button
      type="button"
      className={className}
      aria-label={label}
      title={shortcut === undefined ? label : `${label} (${shortcut})`}
      aria-expanded={expanded}
      aria-pressed={pressed}
      disabled={disabled}
      onMouseDown={onMouseDown}
      onClick={onClick}
    >
      {children}
    </button>
  );
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

  useEffect(() => {
    if (!visible) {
      return undefined;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      const command = editShellShortcut({
        key: event.key,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        repeat: event.repeat,
      });
      if (command === null) {
        return;
      }
      const showReplace = command === 'edit-replace';
      queueMicrotask(() => {
        const commands = activeEditorFindCommands();
        if (commands === null) {
          return;
        }
        if (commands.snapshot().showReplace !== showReplace) {
          commands.patch({ showReplace });
        }
        const next = activeEditorFindCommands()?.snapshot();
        if (next !== undefined) {
          flushSync(() => {
            setSnap(next);
          });
        }
        findRef.current?.focus({ preventScroll: true });
        findRef.current?.select();
      });
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey || event.isComposing) {
        return;
      }
      if (escapeWouldCloseSomethingElse(document)) {
        return;
      }
      const editor = document.querySelector<HTMLElement>('[data-region="page-editor"]');
      const active = document.activeElement;
      const inDocument = editor !== null && (active === editor || (active instanceof Node && editor.contains(active)));
      if (!inDocument) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      activeEditorFindCommands()?.close({ restoreSelection: false });
      onVisibilityChange(false);
    };
    window.addEventListener('keydown', onKeyDown);
    document.addEventListener('keydown', onEscape, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keydown', onEscape, true);
    };
  }, [visible, refresh, onVisibilityChange]);

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

  const patch = useCallback((next: Partial<FindSnapshot>) => {
    const commands = activeEditorFindCommands();
    if (commands === null) {
      return;
    }
    commands.patch(next);
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

  const step = (direction: 'next' | 'previous' | 'replace' | 'replace-all') => {
    const commands = activeEditorFindCommands();
    if (commands === null) {
      return;
    }
    if (direction === 'previous') {
      commands.previous();
    } else if (direction === 'replace') {
      commands.replaceCurrent();
    } else if (direction === 'replace-all') {
      commands.replaceAll();
    } else {
      commands.next();
    }
    refresh();
  };

  return (
    <div
      className="find-bubble"
      data-region={FIND_BAR_REGION}
      role="search"
      aria-label="Find and replace"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) {
          event.preventDefault();
          closeBar();
          return;
        }
        if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
          const replaceAll = (event.ctrlKey || event.metaKey) && event.altKey && !event.shiftKey;
          if (replaceAll) {
            if (!snap.showReplace) {
              return;
            }
            event.preventDefault();
            step('replace-all');
            return;
          }
          if (event.altKey || event.ctrlKey || event.metaKey) {
            return;
          }
          const target = event.target;
          const inReplace = target === replaceRef.current;
          const inFind = target === findRef.current;
          if (!inFind && !inReplace) {
            return;
          }
          event.preventDefault();
          if (event.shiftKey) {
            step('previous');
          } else if (inReplace) {
            step('replace');
          } else {
            step('next');
          }
          return;
        }
        if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'f') {
          event.preventDefault();
          findRef.current?.focus({ preventScroll: true });
          findRef.current?.select();
        }
      }}
    >
      <div className="find-bubble-row">
        <IconButton
          label={snap.showReplace ? 'Hide replace' : 'Show replace'}
          shortcut={snap.showReplace ? 'Ctrl+F' : 'Ctrl+H'}
          expanded={snap.showReplace}
          onClick={() => patch({ showReplace: !snap.showReplace })}
        >
          <Glyph d={snap.showReplace ? 'M3.75 4.5 L8 8.25 L12.25 4.5' : 'M3.75 4 L9 8 L3.75 12'} />
        </IconButton>
        <label className="find-bubble-field">
          <input
            ref={findRef}
            type="search"
            className="find-bubble-input find-bar-input"
            aria-label="Find"
            value={snap.query}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => onFindInput(event.target.value)}
          />
          <IconButton
            label="Match case"
            pressed={snap.matchCase}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => patch({ matchCase: !snap.matchCase, currentIndex: 0 })}
          >
            Aa
          </IconButton>
          <IconButton
            label="Whole word"
            pressed={snap.wholeWord}
            word
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => patch({ wholeWord: !snap.wholeWord, currentIndex: 0 })}
          >
            ab
          </IconButton>
        </label>
        <span className="find-bubble-count" data-find-count="" data-empty={countLabel.length === 0 ? 'true' : 'false'}>
          {countLabel}
        </span>
        <span className="find-bubble-divider" aria-hidden="true" />
        <IconButton
          label="Previous"
          shortcut="Shift+Enter"
          disabled={snap.matchCount === 0}
          onClick={() => step('previous')}
        >
          <Glyph d="M3.5 10 L8 5.5 L12.5 10" />
        </IconButton>
        <IconButton
          label="Next"
          shortcut="Enter"
          disabled={snap.matchCount === 0}
          onClick={() => step('next')}
        >
          <Glyph d="M3.5 6 L8 10.5 L12.5 6" />
        </IconButton>
        <IconButton label="Close" shortcut="Escape" onClick={closeBar}>
          <Glyph d="M3.75 3.75 L12.25 12.25 M12.25 3.75 L3.75 12.25" />
        </IconButton>
      </div>
      {snap.showReplace ? (
        <div className="find-bubble-row">
          <span className="find-bubble-spacer" aria-hidden="true" />
          <label className="find-bubble-field">
            <input
              ref={replaceRef}
              type="text"
              className="find-bubble-input"
              aria-label="Replace"
              value={snap.replacement}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => onReplaceInput(event.target.value)}
            />
          </label>
          <IconButton
            label="Replace"
            shortcut="Enter"
            disabled={snap.matchCount === 0}
            onClick={() => step('replace')}
          >
            <Glyph d="M3 8 H12.5 M9 4.5 L12.5 8 L9 11.5" />
          </IconButton>
          <IconButton
            label="Replace all"
            shortcut="Ctrl+Alt+Enter"
            disabled={snap.matchCount === 0}
            onClick={() => step('replace-all')}
          >
            <Glyph d="M2.5 4.5 H11.5 M8.5 2 L11.5 4.5 L8.5 7 M2.5 11.5 H11.5 M8.5 9 L11.5 11.5 L8.5 14" />
          </IconButton>
        </div>
      ) : null}
    </div>
  );
}
