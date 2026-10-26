// Decides whether a captured window clips or overlaps.
// The page region and the tab list are allowed to scroll. A tab title may
// ellipsize once the tab has shrunk. Everything else has to fit.

export const LAYOUT_TOLERANCE = 1;

export function judgeLayout(report) {
  const problems = [];
  const expect = report?.expect ?? {};
  const tolerance = LAYOUT_TOLERANCE;

  function fail(region, message) {
    problems.push({ region, message });
  }

  if (!report || report.ready !== true) {
    fail('window', 'the window was not ready');
    return problems;
  }

  if (expect.viewport) {
    if (Math.abs(report.innerWidth - expect.viewport.width) > tolerance) {
      fail('window', `the viewport is ${report.innerWidth} px wide, not ${expect.viewport.width}`);
    }
    if (Math.abs(report.innerHeight - expect.viewport.height) > tolerance) {
      fail('window', `the viewport is ${report.innerHeight} px tall, not ${expect.viewport.height}`);
    }
  }
  if (typeof expect.deviceScaleFactor === 'number') {
    const scale = report.devicePixelRatio;
    if (Math.abs(scale - expect.deviceScaleFactor) > 0.02) {
      fail('window', `the device scale is ${scale}, not ${expect.deviceScaleFactor}`);
    }
  }

  const viewport = {
    left: 0,
    top: 0,
    right: report.innerWidth,
    bottom: report.innerHeight,
  };

  if (report.document.scrollWidth > report.innerWidth + tolerance) {
    fail('window', 'the window scrolls sideways');
  }
  if (report.document.scrollHeight > report.innerHeight + tolerance) {
    fail('window', 'the window scrolls vertically');
  }

  const regionBoxes = [];
  for (const region of report.regions) {
    if (!contains(viewport, region.box, tolerance)) {
      fail(region.name, 'the region sits outside the window');
    }
    if (region.scrolls === false && boxOverflows(region, tolerance)) {
      fail(region.name, 'the region overflows');
    }
    regionBoxes.push({ name: region.name, group: 'regions', box: region.box });
  }
  failOverlaps(regionBoxes, tolerance, fail);

  for (const control of report.controls) {
    if (!control.visible) {
      continue;
    }
    const clip = control.clip ? report.boxes[control.clip] : null;
    const painted = clip ? intersection(control.box, clip) : control.box;
    if (!painted) {
      // A tab that has scrolled out of the strip is not clipped. One that must
      // stay on screen, such as the active tab, is.
      if (control.contained) {
        fail(control.region, `${control.name} is clipped by ${control.clip}`);
      }
      continue;
    }
    if (control.contained && clip && !contains(clip, control.box, tolerance)) {
      fail(control.region, `${control.name} is clipped by ${control.clip}`);
    }
    if (textOverflows(control, tolerance)) {
      const wide = control.scrollWidth > control.clientWidth + tolerance;
      const tall = control.scrollHeight > control.clientHeight + tolerance;
      const axis = wide && tall ? 'wide and tall' : wide ? 'wide' : 'tall';
      fail(
        control.region,
        `${control.name} is clipped (${axis}, ${control.scrollWidth} by ${control.scrollHeight} in ${control.clientWidth} by ${control.clientHeight})`,
      );
    }
  }

  failOverlaps(paintedControls(report, tolerance), tolerance, fail);

  const status = report.status;
  for (const name of ['page', 'words', 'characters', 'save', 'zoom']) {
    const text = status.texts[name] ?? '';
    if (text.length === 0) {
      fail('status bar', `the ${name} label is missing`);
    }
  }
  if (expect.statusViewHidden === true && status.viewHidden !== true) {
    fail('status bar', 'the view label is still shown');
  }
  if (expect.statusViewShown === true && status.viewHidden === true) {
    fail('status bar', 'the view label is hidden');
  }

  if (expect.pageScrolls === true) {
    if (report.page.scrollWidth <= report.page.clientWidth + tolerance) {
      fail('page', 'the page does not scroll sideways');
    }
    if (report.page.scrollLeft > tolerance) {
      fail('page', 'the page does not start at its left edge');
    }
    const frame = report.page.frame;
    const region = report.page.region;
    if (frame.left < region.left - tolerance) {
      fail('page', 'the left edge of the page is clipped');
    }
    if (frame.top < region.top - tolerance) {
      fail('page', 'the top of the page is clipped');
    }
  }

  if (expect.tabsScroll === true) {
    if (report.tabs.scrollWidth <= report.tabs.clientWidth + tolerance) {
      fail('tabs', 'the tabs do not scroll');
    }
    const minimum = expect.tabMin ?? 96;
    for (const width of report.tabs.widths) {
      if (width + tolerance < minimum) {
        fail('tabs', `a tab is ${width} px wide, under ${minimum} px`);
      }
    }
  }

  return problems;
}

export function formatProblems(problems) {
  return problems.map((problem) => `${problem.region}: ${problem.message}`).join('\n');
}

function boxOverflows(region, tolerance) {
  return region.scrollWidth > region.clientWidth + tolerance
    || region.scrollHeight > region.clientHeight + tolerance;
}

function textOverflows(control, tolerance) {
  if (control.allowEllipsis && control.ellipsis) {
    return false;
  }
  if (typeof control.scrollWidth !== 'number') {
    return false;
  }
  return control.scrollWidth > control.clientWidth + tolerance
    || control.scrollHeight > control.clientHeight + tolerance;
}

function paintedControls(report, tolerance) {
  const painted = [];
  for (const control of report.controls) {
    if (!control.visible || !control.group) {
      continue;
    }
    const clip = control.clip ? report.boxes[control.clip] : null;
    const box = clip ? intersection(control.box, clip) : control.box;
    if (!box || box.right - box.left <= tolerance || box.bottom - box.top <= tolerance) {
      continue;
    }
    painted.push({ name: control.name, region: control.region, group: control.group, box });
  }
  return painted;
}

function failOverlaps(controls, tolerance, fail) {
  for (let left = 0; left < controls.length; left += 1) {
    for (let right = left + 1; right < controls.length; right += 1) {
      const a = controls[left];
      const b = controls[right];
      if (a.group !== b.group) {
        continue;
      }
      if (contains(a.box, b.box, tolerance) || contains(b.box, a.box, tolerance)) {
        continue;
      }
      if (overlaps(a.box, b.box, tolerance)) {
        fail(a.region ?? 'window', `${a.name} overlaps ${b.name}`);
      }
    }
  }
}

function overlaps(a, b, tolerance) {
  const width = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const height = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return width > tolerance && height > tolerance;
}

function contains(outer, inner, tolerance) {
  return inner.left >= outer.left - tolerance
    && inner.top >= outer.top - tolerance
    && inner.right <= outer.right + tolerance
    && inner.bottom <= outer.bottom + tolerance;
}

function intersection(box, clip) {
  const left = Math.max(box.left, clip.left);
  const top = Math.max(box.top, clip.top);
  const right = Math.min(box.right, clip.right);
  const bottom = Math.min(box.bottom, clip.bottom);
  if (right <= left || bottom <= top) {
    return null;
  }
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

// Runs in the page. Returns null fields only when the shell is not ready.
export const collectLayoutSource = `async () => {
  await document.fonts.ready;
  await new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });

  function shown(element) {
    if (!element) {
      return false;
    }
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') {
      return false;
    }
    const rect = element.getBoundingClientRect();
    return rect.width >= 1 && rect.height >= 1;
  }

  function boxOf(element) {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
    };
  }

  function textOf(element) {
    return (element.textContent || '').replace(/\\s+/g, ' ').trim();
  }

  const root = document.documentElement;
  const title = document.querySelector('[data-region="title-bar"]');
  const menu = document.querySelector('[data-region="menu-bar"]');
  const tabs = document.querySelector('[data-region="tab-strip"]');
  const page = document.querySelector('[data-region="page"]');
  const status = document.querySelector('[data-region="status-bar"]');
  const list = tabs ? tabs.querySelector('.tab-list') : null;
  const frame = document.querySelector('.page-frame');
  if (root.dataset.shellCommands !== 'ready' || !shown(title) || !shown(menu) || !shown(tabs) || !shown(page) || !shown(status) || !list) {
    return { ready: false };
  }

  function region(name, element, scrolls) {
    return {
      name,
      box: boxOf(element),
      clientWidth: element.clientWidth,
      clientHeight: element.clientHeight,
      scrollWidth: element.scrollWidth,
      scrollHeight: element.scrollHeight,
      scrolls,
    };
  }

  const controls = [];
  const boxes = {
    window: {
      left: 0,
      top: 0,
      right: window.innerWidth,
      bottom: window.innerHeight,
    },
    'title bar': boxOf(title),
    'menu bar': boxOf(menu),
    tabs: boxOf(tabs),
    'tab list': boxOf(list),
    page: boxOf(page),
    'status bar': boxOf(status),
  };

  const titleText = title.querySelector('.title-bar-title');
  const titleIcon = title.querySelector('.title-bar-icon');
  if (shown(titleIcon)) {
    controls.push({
      name: 'icon',
      region: 'title bar',
      group: 'title',
      visible: true,
      box: boxOf(titleIcon),
      clip: 'title bar',
      contained: true,
    });
  }
  if (shown(titleText)) {
    const style = getComputedStyle(titleText);
    controls.push({
      name: 'title',
      region: 'title bar',
      group: 'title',
      visible: true,
      box: boxOf(titleText),
      clip: 'title bar',
      contained: true,
      allowEllipsis: true,
      ellipsis: style.textOverflow === 'ellipsis',
      scrollWidth: titleText.scrollWidth,
      clientWidth: titleText.clientWidth,
      scrollHeight: titleText.scrollHeight,
      clientHeight: titleText.clientHeight,
    });
  }

  for (const button of menu.querySelectorAll('.menu-button')) {
    if (!shown(button)) {
      continue;
    }
    controls.push({
      name: textOf(button) || 'menu',
      region: 'menu bar',
      group: 'menu',
      visible: true,
      box: boxOf(button),
      clip: 'menu bar',
      contained: true,
      allowEllipsis: false,
      ellipsis: false,
      scrollWidth: button.scrollWidth,
      clientWidth: button.clientWidth,
      scrollHeight: button.scrollHeight,
      clientHeight: button.clientHeight,
    });
  }

  const tabWidths = [];
  for (const tab of list.querySelectorAll('[role="tab"]')) {
    if (!shown(tab)) {
      continue;
    }
    const box = boxOf(tab);
    const active = tab.getAttribute('aria-selected') === 'true';
    tabWidths.push(box.width);
    controls.push({
      name: tab.getAttribute('data-title') || 'tab',
      region: 'tabs',
      group: 'tabs',
      visible: true,
      box,
      clip: 'tab list',
      contained: active,
    });
    const titleNode = tab.querySelector('.tab-title');
    if (shown(titleNode)) {
      const style = getComputedStyle(titleNode);
      controls.push({
        name: (tab.getAttribute('data-title') || 'tab') + ' title',
        region: 'tabs',
        group: 'tab:' + (tab.getAttribute('data-tab-id') || ''),
        visible: true,
        box: boxOf(titleNode),
        clip: 'tab list',
        contained: false,
        allowEllipsis: true,
        ellipsis: style.textOverflow === 'ellipsis',
        scrollWidth: titleNode.scrollWidth,
        clientWidth: titleNode.clientWidth,
        scrollHeight: titleNode.scrollHeight,
        clientHeight: titleNode.clientHeight,
      });
    }
    const close = tab.querySelector('.tab-close');
    if (shown(close)) {
      controls.push({
        name: 'Close ' + (tab.getAttribute('data-title') || 'tab'),
        region: 'tabs',
        group: 'tab:' + (tab.getAttribute('data-tab-id') || ''),
        visible: true,
        box: boxOf(close),
        clip: 'tab list',
        contained: active,
      });
    }
  }

  const added = tabs.querySelector('.tab-new');
  if (!shown(added)) {
    return { ready: false };
  }
  controls.push({
    name: 'New tab',
    region: 'tabs',
    group: 'tabs',
    visible: true,
    box: boxOf(added),
    clip: 'tabs',
    contained: true,
  });

  const paragraphs = [];
  for (const paragraph of page.querySelectorAll('.page-sheet p')) {
    if (!shown(paragraph)) {
      continue;
    }
    paragraphs.push({
      name: 'page text',
      region: 'page',
      group: null,
      visible: true,
      box: boxOf(paragraph),
      clip: null,
      contained: false,
      allowEllipsis: false,
      ellipsis: false,
      scrollWidth: paragraph.scrollWidth,
      clientWidth: paragraph.clientWidth,
      scrollHeight: paragraph.scrollHeight,
      clientHeight: paragraph.clientHeight,
    });
  }
  controls.push(...paragraphs);

  const statusTexts = {};
  for (const item of status.querySelectorAll('[data-status-item]')) {
    const name = item.getAttribute('data-status-item');
    const hidden = !shown(item) || item.classList.contains('status-view-hidden');
    statusTexts[name] = hidden ? '' : textOf(item);
    if (hidden) {
      continue;
    }
    controls.push({
      name: name,
      region: 'status bar',
      group: 'status',
      visible: true,
      box: boxOf(item),
      clip: 'status bar',
      contained: true,
      allowEllipsis: false,
      ellipsis: false,
      scrollWidth: item.scrollWidth,
      clientWidth: item.clientWidth,
      scrollHeight: item.scrollHeight,
      clientHeight: item.clientHeight,
    });
  }
  for (const mark of status.querySelectorAll('.status-zoom-mark, .status-save-icon, .status-save-label')) {
    if (!shown(mark)) {
      continue;
    }
    controls.push({
      name: mark.className,
      region: 'status bar',
      group: 'status',
      visible: true,
      box: boxOf(mark),
      clip: 'status bar',
      contained: true,
    });
  }

  const view = status.querySelector('[data-status-item="view"]');
  const scrollingElement = document.scrollingElement || root;

  return {
    ready: true,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio,
    document: {
      scrollWidth: scrollingElement.scrollWidth,
      scrollHeight: scrollingElement.scrollHeight,
    },
    regions: [
      region('title bar', title, false),
      region('menu bar', menu, false),
      region('tabs', tabs, false),
      region('page', page, true),
      region('status bar', status, false),
    ],
    boxes,
    controls,
    page: {
      scrollLeft: page.scrollLeft,
      scrollTop: page.scrollTop,
      scrollWidth: page.scrollWidth,
      clientWidth: page.clientWidth,
      frame: frame ? boxOf(frame) : boxOf(page),
      region: boxOf(page),
    },
    tabs: {
      scrollWidth: list.scrollWidth,
      clientWidth: list.clientWidth,
      widths: tabWidths,
      activeInside: (() => {
        const active = list.querySelector('[role="tab"][aria-selected="true"]');
        if (!active) {
          return false;
        }
        const activeBox = boxOf(active);
        const listBox = boxOf(list);
        return activeBox.left >= listBox.left - 1 && activeBox.right <= listBox.right + 1
          && activeBox.top >= listBox.top - 1 && activeBox.bottom <= listBox.bottom + 1;
      })(),
    },
    status: {
      viewHidden: view ? view.classList.contains('status-view-hidden') || !shown(view) : true,
      texts: statusTexts,
    },
  };
}`;
