// One zoom for the whole app. The status bar, the View menu, and the wheel
// all move through these presets. A saved value that is not one of them is 100%.

export const ZOOM_PRESETS = [200, 150, 125, 100, 75, 50] as const;

export type ZoomPreset = (typeof ZOOM_PRESETS)[number];

export const DEFAULT_ZOOM: ZoomPreset = 100;

// Passed into the renderer before the page paints. The preload reads it
// synchronously; the page itself has no Node and does not see process.
export const ZOOM_ARG_PREFIX = '--obelisk-zoom=';

export const ZOOM_MIN: ZoomPreset = 50;

export const ZOOM_MAX: ZoomPreset = 200;

// One preset per notch. A high-resolution wheel adds its deltas until it reaches this.
export const WHEEL_UNITS_PER_PRESET = 120;

const ASCENDING: readonly ZoomPreset[] = [50, 75, 100, 125, 150, 200];

const PRESET_SET: ReadonlySet<number> = new Set(ZOOM_PRESETS);

export function isZoomPreset(value: unknown): value is ZoomPreset {
  return typeof value === 'number' && Number.isFinite(value) && PRESET_SET.has(value);
}

export function zoomFromSaved(value: unknown): ZoomPreset {
  return isZoomPreset(value) ? value : DEFAULT_ZOOM;
}

export function zoomLaunchArgument(zoom: ZoomPreset): string {
  return `${ZOOM_ARG_PREFIX}${zoom}`;
}

export function zoomFromArguments(argv: readonly string[]): ZoomPreset {
  let found: string | undefined;
  for (const arg of argv) {
    if (arg.startsWith(ZOOM_ARG_PREFIX)) {
      found = arg.slice(ZOOM_ARG_PREFIX.length);
    }
  }
  if (found === undefined || found.length === 0) {
    return DEFAULT_ZOOM;
  }
  const numeric = Number(found);
  return zoomFromSaved(numeric);
}

export function zoomLabel(zoom: ZoomPreset): string {
  return `${zoom}%`;
}

export function zoomAccessLabel(zoom: ZoomPreset): string {
  return `Zoom ${zoomLabel(zoom)}`;
}

export function stepZoom(zoom: ZoomPreset, direction: 1 | -1): ZoomPreset {
  const current = zoomFromSaved(zoom);
  const index = ASCENDING.indexOf(current);
  const next = index + direction;
  if (next < 0 || next >= ASCENDING.length) {
    return current;
  }
  return ASCENDING[next] ?? current;
}

export function zoomInDisabled(zoom: ZoomPreset): boolean {
  return zoomFromSaved(zoom) === ZOOM_MAX;
}

export function zoomOutDisabled(zoom: ZoomPreset): boolean {
  return zoomFromSaved(zoom) === ZOOM_MIN;
}

export interface ZoomShortcutEvent {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  repeat: boolean;
}

export type ZoomCommand = 'view-zoom-in' | 'view-zoom-out' | 'view-zoom-100';

// Ctrl+Plus on a US keyboard is Ctrl+Shift+=, so the key arrives as "+".
// Ctrl+= (the same key without Shift) and the numeric pad plus do the same.
export function zoomShortcut(event: ZoomShortcutEvent): ZoomCommand | null {
  if (event.altKey || event.repeat || !(event.ctrlKey || event.metaKey)) {
    return null;
  }
  if (event.key === '0' && !event.shiftKey) {
    return 'view-zoom-100';
  }
  if (event.key === '+' || event.key === '=' || event.key === 'Add') {
    return 'view-zoom-in';
  }
  if ((event.key === '-' || event.key === 'Subtract') && !event.shiftKey) {
    return 'view-zoom-out';
  }
  return null;
}

export function zoomCommandResult(zoom: ZoomPreset, command: ZoomCommand): ZoomPreset {
  if (command === 'view-zoom-100') {
    return DEFAULT_ZOOM;
  }
  return stepZoom(zoom, command === 'view-zoom-in' ? 1 : -1);
}

export interface WheelZoom {
  accumulated: number;
  /** Positive steps zoom out (wheel down). Negative steps zoom in (wheel up). */
  steps: number;
}

export function consumeZoomWheel(accumulated: number, deltaY: number, deltaMode: number): WheelZoom {
  const units = deltaMode === 1 || deltaMode === 2 ? deltaY * WHEEL_UNITS_PER_PRESET : deltaY;
  let total = accumulated + units;
  if (!Number.isFinite(total)) {
    return { accumulated: 0, steps: 0 };
  }
  let steps = 0;
  while (total >= WHEEL_UNITS_PER_PRESET) {
    steps += 1;
    total -= WHEEL_UNITS_PER_PRESET;
  }
  while (total <= -WHEEL_UNITS_PER_PRESET) {
    steps -= 1;
    total += WHEEL_UNITS_PER_PRESET;
  }
  return { accumulated: total, steps };
}

export function applyWheelSteps(zoom: ZoomPreset, steps: number): ZoomPreset {
  let current = zoomFromSaved(zoom);
  const count = Math.abs(steps);
  const direction: 1 | -1 = steps > 0 ? -1 : 1;
  for (let index = 0; index < count; index += 1) {
    current = stepZoom(current, direction);
  }
  return current;
}

/** The caret line is on screen when any of it crosses the view. */
export function caretLineVisible(
  lineTop: number,
  lineBottom: number,
  viewTop: number,
  viewBottom: number,
): boolean {
  return lineBottom > viewTop && lineTop < viewBottom;
}
