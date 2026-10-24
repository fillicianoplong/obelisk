import { fileURLToPath } from 'node:url';

export const LINE_COVERAGE_TARGET = 80;

export function meetsLineTarget(linesHit, linesFound, target = LINE_COVERAGE_TARGET) {
  if (!Number.isFinite(linesFound) || linesFound <= 0) {
    return false;
  }
  if (!Number.isFinite(linesHit) || linesHit < 0) {
    return false;
  }
  return linesHit * 100 >= target * linesFound;
}

export function formatLinePercent(linesHit, linesFound) {
  if (!Number.isFinite(linesFound) || linesFound <= 0) {
    return 'n/a';
  }
  const scaled = Math.round((linesHit * 10000) / linesFound);
  const whole = Math.trunc(scaled / 100);
  const fraction = String(Math.abs(scaled % 100)).padStart(2, '0');
  return `${whole}.${fraction}%`;
}

export function parseLcov(text) {
  const records = [];
  let current = null;
  for (const line of String(text).split(/\r?\n/)) {
    if (line.startsWith('SF:')) {
      current = {
        file: line.slice(3).trim(),
        linesHit: null,
        linesFound: null,
        countedHit: 0,
        countedFound: 0,
      };
      continue;
    }
    if (!current) {
      continue;
    }
    if (line.startsWith('DA:')) {
      const hits = Number(line.slice(3).split(',')[1]);
      current.countedFound += 1;
      if (hits > 0) {
        current.countedHit += 1;
      }
      continue;
    }
    if (line.startsWith('LH:')) {
      current.linesHit = Number(line.slice(3));
      continue;
    }
    if (line.startsWith('LF:')) {
      current.linesFound = Number(line.slice(3));
      continue;
    }
    if (line === 'end_of_record') {
      records.push({
        file: current.file,
        linesHit: current.linesHit ?? current.countedHit,
        linesFound: current.linesFound ?? current.countedFound,
      });
      current = null;
    }
  }
  return records;
}

function normalizeModulePath(file, root) {
  let value = file.trim();
  if (value.startsWith('file://')) {
    try {
      value = fileURLToPath(value);
    } catch {
      value = value.replace(/^file:\/\//, '');
    }
  }
  value = value.replaceAll('\\', '/');
  if (root) {
    const prefix = `${root.replaceAll('\\', '/').replace(/\/$/, '')}/`;
    if (value.toLowerCase().startsWith(prefix.toLowerCase())) {
      value = value.slice(prefix.length);
    }
  }
  return value;
}

export function coverageRows(records, { root, target = LINE_COVERAGE_TARGET } = {}) {
  const byFile = new Map();
  for (const record of records) {
    if (!record.file) {
      continue;
    }
    byFile.set(normalizeModulePath(record.file, root), {
      linesHit: record.linesHit,
      linesFound: record.linesFound,
    });
  }
  return [...byFile.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([file, counts]) => ({
      file,
      linesHit: counts.linesHit,
      linesFound: counts.linesFound,
      met: meetsLineTarget(counts.linesHit, counts.linesFound, target),
    }));
}

function pad(value, width, alignRight) {
  const text = String(value);
  if (text.length >= width) {
    return text;
  }
  const space = ' '.repeat(width - text.length);
  return alignRight ? `${space}${text}` : `${text}${space}`;
}

export function formatCoverageReport(records, options = {}) {
  const target = options.target ?? LINE_COVERAGE_TARGET;
  const measured = coverageRows(records, { root: options.root, target });
  const prefixed = options.includePrefix
    ? measured.filter((row) => row.file.startsWith(options.includePrefix))
    : measured;
  const rows = prefixed.length > 0 ? prefixed : measured;
  const lines = [
    `Line coverage by module against the ${target}% target (NFR-23)`,
    '',
  ];
  if (rows.length === 0) {
    lines.push('No modules were measured.');
    lines.push(
      `The ${target}% column is the NFR-23 line-coverage target for the file format, save, and table math modules. This report does not fail the run when a module is under that target.`,
    );
    return `${lines.join('\n')}\n`;
  }

  const all = rows.reduce(
    (sum, row) => ({
      linesHit: sum.linesHit + row.linesHit,
      linesFound: sum.linesFound + row.linesFound,
    }),
    { linesHit: 0, linesFound: 0 },
  );
  const rendered = [
    ...rows.map((row) => ({
      file: row.file,
      linesFound: row.linesFound,
      linesHit: row.linesHit,
      met: row.met,
    })),
    {
      file: 'all measured modules',
      linesFound: all.linesFound,
      linesHit: all.linesHit,
      met: meetsLineTarget(all.linesHit, all.linesFound, target),
    },
  ];
  const moduleWidth = Math.max('module'.length, ...rendered.map((row) => row.file.length));
  const header = [
    pad('module', moduleWidth, false),
    pad('lines', 7, true),
    pad('covered', 8, true),
    pad('line %', 8, true),
    pad('target', 7, true),
    pad('met', 3, false),
  ].join('  ');
  lines.push(header);
  for (const row of rendered) {
    lines.push(
      [
        pad(row.file, moduleWidth, false),
        pad(row.linesFound, 7, true),
        pad(row.linesHit, 8, true),
        pad(formatLinePercent(row.linesHit, row.linesFound), 8, true),
        pad(`${target}%`, 7, true),
        pad(row.met ? 'yes' : 'no', 3, false),
      ].join('  '),
    );
  }
  const under = rows.filter((row) => !row.met).length;
  lines.push('');
  lines.push(
    `${rows.length} module${rows.length === 1 ? '' : 's'} measured. ${under} ${under === 1 ? 'is' : 'are'} under the ${target}% target.`,
  );
  lines.push(
    `The ${target}% column is the NFR-23 line-coverage target for the file format, save, and table math modules. This report does not fail the run when a module is under that target.`,
  );
  return `${lines.join('\n')}\n`;
}
