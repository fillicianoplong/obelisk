export type StatusControl = 'save' | 'zoom';

export type StatusFocus = 'bar' | StatusControl;

// The save state is a stop only while it has a tooltip. Zoom is always a stop.
export function statusControls(saveHasTooltip: boolean): readonly StatusControl[] {
  if (saveHasTooltip) {
    return ['save', 'zoom'];
  }
  return ['zoom'];
}

export function statusControlAfter(
  current: StatusFocus,
  key: 'ArrowLeft' | 'ArrowRight',
  saveHasTooltip: boolean,
): StatusControl | null {
  const order = statusControls(saveHasTooltip);
  if (order.length === 0) {
    return null;
  }
  const forward = key === 'ArrowRight';
  if (current === 'bar') {
    return forward ? order[0] ?? null : order[order.length - 1] ?? null;
  }
  const index = order.indexOf(current);
  if (index === -1) {
    return null;
  }
  const next = index + (forward ? 1 : -1);
  if (next < 0 || next >= order.length) {
    return null;
  }
  return order[next] ?? null;
}
