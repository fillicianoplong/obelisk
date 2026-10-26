import assert from 'node:assert/strict';
import test from 'node:test';
import { judgeLayout } from '../../visual/layout-check.mjs';

function box(left, top, width, height) {
  return { left, top, right: left + width, bottom: top + height, width, height };
}

function region(name, top, height, scrolls = false) {
  return {
    name,
    box: box(0, top, 1280, height),
    clientWidth: 1280,
    clientHeight: height,
    scrollWidth: 1280,
    scrollHeight: height,
    scrolls,
  };
}

function control(name, regionName, group, left, top, width, height, extra = {}) {
  return {
    name,
    region: regionName,
    group,
    visible: true,
    box: box(left, top, width, height),
    clip: regionName,
    contained: true,
    allowEllipsis: false,
    ellipsis: false,
    scrollWidth: width,
    clientWidth: width,
    scrollHeight: height,
    clientHeight: height,
    ...extra,
  };
}

function restingReport(overrides = {}) {
  const regions = [
    region('title bar', 0, 32),
    region('menu bar', 32, 32),
    region('tabs', 64, 40),
    region('page', 104, 668, true),
    region('status bar', 772, 28),
  ];
  return {
    ready: true,
    innerWidth: 1280,
    innerHeight: 800,
    devicePixelRatio: 1,
    document: { scrollWidth: 1280, scrollHeight: 800 },
    regions,
    boxes: {
      'title bar': regions[0].box,
      'menu bar': regions[1].box,
      tabs: regions[2].box,
      'tab list': box(8, 72, 1200, 32),
      page: regions[3].box,
      'status bar': regions[4].box,
    },
    controls: [
      control('File', 'menu bar', 'menu', 8, 36, 48, 24),
      control('Edit', 'menu bar', 'menu', 56, 36, 48, 24),
      control('Untitled 1', 'tabs', 'tabs', 8, 72, 160, 32, { clip: 'tab list', contained: true }),
      control('New tab', 'tabs', 'tabs', 170, 72, 32, 32, { clip: 'tabs' }),
      control('page', 'status bar', 'status', 12, 778, 70, 16),
      control('words', 'status bar', 'status', 98, 778, 50, 16),
      control('zoom', 'status bar', 'status', 1180, 778, 40, 16),
    ],
    page: {
      scrollLeft: 0,
      scrollTop: 0,
      scrollWidth: 1280,
      clientWidth: 1280,
      frame: box(232, 128, 816, 1056),
      region: box(0, 104, 1280, 668),
    },
    tabs: { scrollWidth: 160, clientWidth: 1200, widths: [160] },
    status: {
      viewHidden: false,
      texts: {
        page: 'Page 1 of 1',
        words: '0 words',
        characters: '0 characters',
        save: 'Saved',
        zoom: '100%',
        view: 'Pages',
      },
    },
    expect: {
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
      statusViewShown: true,
    },
    ...overrides,
  };
}

test('a resting 1280 by 800 window has nothing clipped', () => {
  assert.deepEqual(judgeLayout(restingReport()), []);
});

test('a menu that overflows the bar fails', () => {
  const report = restingReport();
  report.regions[1].scrollWidth = 1400;
  const problems = judgeLayout(report);
  assert.equal(problems.some((problem) => problem.region === 'menu bar'), true);
});

test('overlapping status items fail', () => {
  const report = restingReport();
  report.controls.push(control('characters', 'status bar', 'status', 110, 778, 80, 16));
  const problems = judgeLayout(report);
  assert.equal(problems.some((problem) => problem.message.includes('overlaps')), true);
});

test('a tab title may ellipsize', () => {
  const report = restingReport();
  report.controls.push(control('Untitled 1 title', 'tabs', 'tab:untitled-1', 20, 78, 48, 18, {
    clip: 'tab list',
    contained: false,
    allowEllipsis: true,
    ellipsis: true,
    scrollWidth: 90,
    clientWidth: 48,
  }));
  assert.deepEqual(judgeLayout(report), []);
});

test('page text that overflows its line fails', () => {
  const report = restingReport();
  report.controls.push(control('page text', 'page', null, 120, 200, 600, 18, {
    clip: null,
    contained: false,
    scrollWidth: 900,
    clientWidth: 600,
  }));
  const problems = judgeLayout(report);
  assert.equal(problems.some((problem) => problem.region === 'page' && problem.message.includes('clipped')), true);
});

test('the minimum keeps the sideways page, scrolling tabs, and the status counts', () => {
  const report = restingReport({
    innerWidth: 640,
    innerHeight: 400,
    document: { scrollWidth: 640, scrollHeight: 400 },
    expect: {
      viewport: { width: 640, height: 400 },
      deviceScaleFactor: 1,
      statusViewHidden: true,
      pageScrolls: true,
      tabsScroll: true,
      tabMin: 96,
    },
  });
  report.regions = [
    region('title bar', 0, 32),
    region('menu bar', 32, 32),
    region('tabs', 64, 40),
    region('page', 104, 268, true),
    region('status bar', 372, 28),
  ];
  for (const item of report.regions) {
    item.box = box(0, item.box.top, 640, item.box.height);
    item.clientWidth = 640;
    item.scrollWidth = 640;
  }
  report.boxes['title bar'] = report.regions[0].box;
  report.boxes['menu bar'] = report.regions[1].box;
  report.boxes.tabs = report.regions[2].box;
  report.boxes['tab list'] = box(8, 72, 560, 32);
  report.boxes.page = report.regions[3].box;
  report.boxes['status bar'] = report.regions[4].box;
  report.controls = [
    control('File', 'menu bar', 'menu', 8, 36, 48, 24),
    control('Edit', 'menu bar', 'menu', 56, 36, 48, 24),
    control('Untitled 1', 'tabs', 'tabs', 8, 72, 96, 32, { clip: 'tab list', contained: true }),
    control('New tab', 'tabs', 'tabs', 600, 72, 32, 32, { clip: 'tabs' }),
    control('page', 'status bar', 'status', 12, 378, 70, 16),
    control('words', 'status bar', 'status', 98, 378, 50, 16),
    control('zoom', 'status bar', 'status', 560, 378, 40, 16),
  ];
  report.page = {
    scrollLeft: 0,
    scrollTop: 0,
    scrollWidth: 864,
    clientWidth: 640,
    frame: box(24, 128, 816, 1056),
    region: box(0, 104, 640, 268),
  };
  report.tabs = { scrollWidth: 780, clientWidth: 560, widths: [96, 96, 96, 96, 96, 96, 96, 96] };
  report.status.viewHidden = true;
  report.status.texts.view = '';
  assert.deepEqual(judgeLayout(report), []);

  report.page.scrollLeft = 40;
  assert.equal(judgeLayout(report).some((problem) => problem.message.includes('left edge')), true);

  report.page.scrollLeft = 0;
  report.tabs.scrollWidth = 560;
  assert.equal(judgeLayout(report).some((problem) => problem.message.includes('do not scroll')), true);

  report.tabs.scrollWidth = 780;
  report.status.viewHidden = false;
  assert.equal(judgeLayout(report).some((problem) => problem.message.includes('view label')), true);
});
