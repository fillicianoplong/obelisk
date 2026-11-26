import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { FocusEvent, KeyboardEvent, MouseEvent } from 'react';
import { MenuCheck } from '../menus/icons.js';
import { watchOutsidePress } from '../outside-press.js';
import { commitPageKeyboardFocus } from '../page-focus.js';
import { tooltipDelay } from './model.js';
import {
  ZOOM_PRESETS,
  zoomAccessLabel,
  zoomLabel,
  type ZoomPreset,
} from '../../../shared/zoom.js';

interface ZoomControlProps {
  zoom: ZoomPreset;
  onZoom: (zoom: ZoomPreset) => void;
}

const TOOLTIP_ID = 'status-zoom-tooltip';
const MENU_ID = 'status-zoom-menu';
const TOOLTIP_TEXT = 'Zoom (Ctrl+wheel)';

function tokenPx(name: string, fallback: number): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name);
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : fallback;
}

// The popup sits 4 px above the bar, and stays 8 px inside the window.
function placeAboveBar(element: HTMLElement, slot: HTMLElement): void {
  const bar = slot.closest('.status-bar');
  element.style.right = '0px';
  if (bar instanceof HTMLElement) {
    const slotRect = slot.getBoundingClientRect();
    const barRect = bar.getBoundingClientRect();
    const gap = tokenPx('--space-xs', 4);
    element.style.bottom = `${slotRect.bottom - (barRect.top - gap)}px`;
  }
  const rect = element.getBoundingClientRect();
  const inset = tokenPx('--space-s', 8);
  const pastRight = rect.right - (window.innerWidth - inset);
  const pastLeft = inset - rect.left;
  if (pastRight > 0) {
    element.style.right = `${pastRight}px`;
  } else if (pastLeft > 0) {
    element.style.right = `${-pastLeft}px`;
  }
}

function focusPage(): void {
  const page = document.querySelector<HTMLElement>('[data-region="page-editor"]');
  if (page !== null) {
    commitPageKeyboardFocus(page);
  }
}

export function ZoomControl({ zoom, onZoom }: ZoomControlProps) {
  const slotRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const hoverTimer = useRef<number | null>(null);
  const keyboardFocus = useRef(false);
  const openRef = useRef(false);
  const focusIndexRef = useRef(ZOOM_PRESETS.indexOf(zoom));
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState<'pointer' | 'keyboard'>('pointer');
  const [focusIndex, setFocusIndex] = useState(ZOOM_PRESETS.indexOf(zoom));
  const [tooltipOpen, setTooltipOpen] = useState(false);
  openRef.current = open;
  focusIndexRef.current = focusIndex;

  function clearHoverTimer(): void {
    if (hoverTimer.current !== null) {
      window.clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
  }

  const choose = useCallback((preset: ZoomPreset) => {
    setOpen(false);
    onZoom(preset);
    focusPage();
  }, [onZoom]);

  function openMenu(from: 'pointer' | 'keyboard'): void {
    const index = Math.max(0, ZOOM_PRESETS.indexOf(zoom));
    setFocusIndex(index);
    setInput(from);
    setTooltipOpen(false);
    clearHoverTimer();
    setOpen(true);
  }

  useEffect(() => {
    return () => {
      clearHoverTimer();
    };
  }, []);

  useEffect(() => {
    return watchOutsidePress(window, {
      isOpen: () => openRef.current,
      isInside: (node) => node !== null && slotRef.current?.contains(node) === true,
      onOutside: () => {
        setOpen(false);
      },
    });
  }, []);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        buttonRef.current?.focus();
        return;
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        event.stopPropagation();
        const delta = event.key === 'ArrowDown' ? 1 : -1;
        setInput('keyboard');
        setFocusIndex((current) => (current + delta + ZOOM_PRESETS.length) % ZOOM_PRESETS.length);
        return;
      }
      if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        event.stopPropagation();
        setInput('keyboard');
        setFocusIndex(event.key === 'Home' ? 0 : ZOOM_PRESETS.length - 1);
        return;
      }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
        event.preventDefault();
        event.stopPropagation();
        const preset = ZOOM_PRESETS[focusIndexRef.current];
        if (preset !== undefined) {
          choose(preset);
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
    };
  }, [choose, open]);

  useLayoutEffect(() => {
    if (!open || input !== 'keyboard') {
      return;
    }
    const preset = ZOOM_PRESETS[focusIndex];
    menuRef.current?.querySelector<HTMLElement>(`[data-zoom-preset="${preset}"]`)?.focus();
  }, [focusIndex, input, open]);

  useLayoutEffect(() => {
    const slot = slotRef.current;
    if (slot === null) {
      return;
    }
    if (open && menuRef.current !== null) {
      placeAboveBar(menuRef.current, slot);
    }
    if (tooltipOpen && tooltipRef.current !== null) {
      placeAboveBar(tooltipRef.current, slot);
    }
  }, [open, tooltipOpen, zoom]);

  function showFromHover(): void {
    if (openRef.current) {
      return;
    }
    clearHoverTimer();
    hoverTimer.current = window.setTimeout(() => {
      hoverTimer.current = null;
      if (!openRef.current) {
        setTooltipOpen(true);
      }
    }, tooltipDelay('hover'));
  }

  function hideFromHover(): void {
    clearHoverTimer();
    if (!keyboardFocus.current) {
      setTooltipOpen(false);
    }
  }

  function showIfKeyboard(target: HTMLElement): void {
    if (!target.matches(':focus-visible') || openRef.current) {
      return;
    }
    keyboardFocus.current = true;
    clearHoverTimer();
    setTooltipOpen(true);
  }

  function onFocus(event: FocusEvent<HTMLButtonElement>): void {
    const target = event.currentTarget;
    showIfKeyboard(target);
    window.requestAnimationFrame(() => {
      if (buttonRef.current === target) {
        showIfKeyboard(target);
      }
    });
  }

  function onBlur(): void {
    keyboardFocus.current = false;
    clearHoverTimer();
    setTooltipOpen(false);
  }

  function onButtonKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
    const altDown = event.altKey && event.key === 'ArrowDown' && !event.ctrlKey && !event.metaKey && !event.shiftKey;
    const vertical = !event.altKey && !event.ctrlKey && !event.metaKey
      && (event.key === 'ArrowDown' || event.key === 'ArrowUp');
    if (!altDown && !vertical) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (!open) {
      openMenu('keyboard');
    }
  }

  function onButtonClick(event: MouseEvent<HTMLButtonElement>): void {
    if (open) {
      setOpen(false);
      return;
    }
    openMenu(event.detail === 0 ? 'keyboard' : 'pointer');
  }

  const tooltipShown = tooltipOpen && !open;

  return (
    <div className="status-zoom-slot" ref={slotRef}>
      <button
        type="button"
        className="status-zoom"
        data-status-item="zoom"
        aria-label={zoomAccessLabel(zoom)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? MENU_ID : undefined}
        aria-describedby={TOOLTIP_ID}
        ref={buttonRef}
        onClick={onButtonClick}
        onKeyDown={onButtonKeyDown}
        onPointerEnter={showFromHover}
        onPointerLeave={hideFromHover}
        onFocus={onFocus}
        onBlur={onBlur}
      >
        <span className="status-zoom-value">{zoomLabel(zoom)}</span>
        <svg className="status-zoom-chevron" viewBox="0 0 8 8" aria-hidden="true" focusable="false">
          <path d="M1 2.75 L4 5.75 L7 2.75" fill="none" stroke="currentColor" />
        </svg>
      </button>
      <span
        id={TOOLTIP_ID}
        role="tooltip"
        className="status-tooltip"
        data-open={tooltipShown ? 'true' : 'false'}
        ref={tooltipRef}
      >
        {TOOLTIP_TEXT}
      </span>
      {open ? (
        <div
          className="status-zoom-menu status-zoom-host"
          data-input={input}
          ref={menuRef}
        >
          <div className="menu-panel" id={MENU_ID} role="menu" aria-label="Zoom" tabIndex={-1}>
            {ZOOM_PRESETS.map((preset, index) => {
              const checked = preset === zoom;
              return (
                <button
                  key={preset}
                  type="button"
                  className="menu-item"
                  role="menuitemradio"
                  tabIndex={-1}
                  aria-checked={checked}
                  data-zoom-preset={preset}
                  data-focused={input === 'keyboard' && index === focusIndex ? 'true' : undefined}
                  onMouseDown={(event) => {
                    event.preventDefault();
                  }}
                  onMouseEnter={() => {
                    setInput('pointer');
                    setFocusIndex(index);
                  }}
                  onClick={() => {
                    choose(preset);
                  }}
                >
                  <span className="menu-check" aria-hidden="true">
                    {checked ? <MenuCheck /> : null}
                  </span>
                  <span className="menu-label">{zoomLabel(preset)}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
