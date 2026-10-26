// F6 order. The find bar is not in the window yet.
// When it is open, the one line is regionCycle(['find-bar']), which puts it after the tabs.

export const MENU_BAR_REGION = 'menu-bar';
export const TABS_REGION = 'tab-strip';
export const PAGE_REGION = 'page';
export const STATUS_BAR_REGION = 'status-bar';
export const FIND_BAR_REGION = 'find-bar';

export const MENU_BAR_LABEL = 'Menu bar';
export const TABS_LABEL = 'Tabs';
export const DOCUMENT_LABEL = 'Document';
export const STATUS_BAR_LABEL = 'Status bar';

export const REGION_LABEL: Readonly<Record<string, string>> = {
  [MENU_BAR_REGION]: MENU_BAR_LABEL,
  [TABS_REGION]: TABS_LABEL,
  [PAGE_REGION]: DOCUMENT_LABEL,
  [STATUS_BAR_REGION]: STATUS_BAR_LABEL,
};

export type RegionDirection = 1 | -1;

const PAGE_MARKERS = new Set(['page', 'page-editor']);

export function regionCycle(afterTabs: readonly string[] = []): readonly string[] {
  return [MENU_BAR_REGION, TABS_REGION, ...afterTabs, PAGE_REGION, STATUS_BAR_REGION];
}

export function cycleRegionId(marker: string | null): string | null {
  if (marker === null) {
    return null;
  }
  if (PAGE_MARKERS.has(marker)) {
    return PAGE_REGION;
  }
  if (
    marker === MENU_BAR_REGION
    || marker === TABS_REGION
    || marker === STATUS_BAR_REGION
    || marker === FIND_BAR_REGION
  ) {
    return marker;
  }
  return null;
}

export function regionAfter(
  order: readonly string[],
  current: string | null,
  direction: RegionDirection,
): string {
  if (order.length === 0) {
    throw new RangeError('There are no regions to cycle.');
  }
  const index = current === null ? -1 : order.indexOf(current);
  if (index === -1) {
    return direction === 1 ? order[0] : order[order.length - 1];
  }
  const next = index + direction;
  const wrapped = ((next % order.length) + order.length) % order.length;
  return order[wrapped];
}
