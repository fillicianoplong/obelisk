// A vertical wheel moves the tab row sideways. A sideways wheel or swipe does too.
// The row takes the event only when the tabs overflow, so a wheel over a short row
// still reaches the page. Ctrl and Meta stay free for zoom.

interface TabListScroll {
  scrollWidth: number;
  clientWidth: number;
  scrollLeft: number;
}

interface TabWheel {
  deltaX: number;
  deltaY: number;
  ctrlKey: boolean;
  metaKey: boolean;
  preventDefault: () => void;
}

export function scrollTabsFromWheel(list: TabListScroll, event: TabWheel): void {
  if (event.ctrlKey || event.metaKey) {
    return;
  }
  if (list.scrollWidth <= list.clientWidth) {
    return;
  }
  const delta = event.deltaX + event.deltaY;
  if (delta === 0) {
    return;
  }
  event.preventDefault();
  list.scrollLeft += delta;
}
