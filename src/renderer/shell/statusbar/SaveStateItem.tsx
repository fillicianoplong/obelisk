import { useEffect, useRef, useState } from 'react';
import type { FocusEvent } from 'react';
import { saveStateLabel, saveStateTooltip, tooltipDelay } from './model.js';
import type { SaveState } from './model.js';
import { SaveStateIcon } from './SaveStateIcon.js';

interface SaveStateItemProps {
  state: SaveState;
}

const TOOLTIP_ID = 'status-save-tooltip';

export function SaveStateItem({ state }: SaveStateItemProps) {
  const tooltip = saveStateTooltip(state);
  const label = saveStateLabel(state);
  const itemRef = useRef<HTMLSpanElement>(null);
  const hoverTimer = useRef<number | null>(null);
  const keyboardFocus = useRef(false);
  const [open, setOpen] = useState(false);

  function clearHoverTimer(): void {
    if (hoverTimer.current !== null) {
      window.clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
  }

  useEffect(() => {
    return () => {
      clearHoverTimer();
    };
  }, []);

  useEffect(() => {
    if (tooltip === null) {
      clearHoverTimer();
      keyboardFocus.current = false;
      setOpen(false);
    }
  }, [tooltip]);

  function showFromHover(): void {
    clearHoverTimer();
    hoverTimer.current = window.setTimeout(() => {
      hoverTimer.current = null;
      setOpen(true);
    }, tooltipDelay('hover'));
  }

  function hideFromHover(): void {
    clearHoverTimer();
    if (!keyboardFocus.current) {
      setOpen(false);
    }
  }

  function showIfKeyboard(target: HTMLElement): void {
    if (!target.matches(':focus-visible')) {
      return;
    }
    keyboardFocus.current = true;
    clearHoverTimer();
    setOpen(true);
  }

  function onFocus(event: FocusEvent<HTMLSpanElement>): void {
    const target = event.currentTarget;
    showIfKeyboard(target);
    window.requestAnimationFrame(() => {
      if (itemRef.current === target) {
        showIfKeyboard(target);
      }
    });
  }

  function onBlur(): void {
    keyboardFocus.current = false;
    clearHoverTimer();
    setOpen(false);
  }

  return (
    <span
      className="status-save"
      data-status-item="save"
      data-save-state={state}
      tabIndex={0}
      ref={itemRef}
      {...(tooltip !== null ? { 'aria-describedby': TOOLTIP_ID } : {})}
      onPointerEnter={() => {
        if (tooltip !== null) {
          showFromHover();
        }
      }}
      onPointerLeave={hideFromHover}
      onFocus={onFocus}
      onBlur={onBlur}
    >
      <SaveStateIcon state={state} />
      <span className="status-save-label">{label}</span>
      {tooltip !== null ? (
        <span
          id={TOOLTIP_ID}
          role="tooltip"
          className="status-tooltip"
          data-open={open ? 'true' : 'false'}
        >
          {tooltip}
        </span>
      ) : null}
    </span>
  );
}
