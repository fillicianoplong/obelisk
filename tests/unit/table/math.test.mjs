import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadRenderer } from '../editor/load-renderer.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const math = await loadRenderer(new URL('../../../src/renderer/blocks/table/math/index.ts', import.meta.url));

function textCell(text) {
  if (text === '') {
    return { kind: 'text', content: [] };
  }
  return { kind: 'text', content: [{ type: 'text', text }] };
}

function formula(source) {
  return { kind: 'formula', source };
}

function grid(rows) {
  return rows.map((row) => row.map((cell) => (cell.startsWith('=') ? formula(cell) : textCell(cell))));
}

function at(evaluated, address) {
  const col = address.toUpperCase().charCodeAt(0) - 65;
  const row = Number(address.slice(1)) - 1;
  const cell = evaluated[row]?.[col];
  assert.ok(cell, address);
  return cell;
}

function run(rows) {
  return math.evaluateTable(grid(rows));
}

function mustShift(rows, change) {
  const shifted = math.shiftTable(rows, change);
  assert.equal(shifted.ok, true, shifted.reason ?? 'shift failed');
  return shifted.rows;
}

test('the math module does not touch the DOM, React, or Electron', async () => {
  const dir = path.join(root, 'src/renderer/blocks/table/math');
  const files = (await readdir(dir)).filter((name) => name.endsWith('.ts'));
  assert.ok(files.includes('index.ts'));
  for (const name of files) {
    const source = await readFile(path.join(dir, name), 'utf8');
    assert.doesNotMatch(source, /from ['"](?:react|electron|prosemirror|node:)/);
    assert.doesNotMatch(source, /\b(?:document|window|HTMLElement)\b/);
  }
});

test('=B2+B3*2 is B2 plus twice B3', () => {
  const pairs = [
    ['10', '3', 16],
    ['-2.5', '0.75', -1],
    ['0', '4', 8],
    ['', '4', 8],
  ];
  for (const [b2, b3, expected] of pairs) {
    const cell = at(run([
      ['', ''],
      ['', b2],
      ['', b3],
      ['', '=B2+B3*2'],
    ]), 'B4');
    assert.equal(cell.value, expected);
    assert.equal(cell.error, null);
    assert.equal(cell.underline, false);
    assert.equal(cell.editing, '=B2+B3*2');
  }
});

test('=(B2-B3)/2 is half the difference', () => {
  assert.equal(at(run([['', ''], ['', '10'], ['', '4'], ['', '=(B2-B3)/2']]), 'B4').value, 3);
  assert.equal(at(run([['', ''], ['', '3'], ['', '7'], ['', '=(B2-B3)/2']]), 'B4').value, -2);
});

test('=[B2+B3]**2 is the square of the sum', () => {
  const cell = at(run([['', ''], ['', '3'], ['', '1'], ['', '=[B2+B3]**2']]), 'B4');
  assert.equal(cell.value, 16);
  assert.equal(cell.display, '16');
  assert.equal(at(run([['', ''], ['', '1.5'], ['', '0.5'], ['', '=[B2+B3]**2']]), 'B4').value, 4);
});

test('=B2^2 squares the referenced cell', () => {
  assert.equal(at(run([['', ''], ['', '5'], ['', '=B2^2']]), 'B3').value, 25);
  assert.equal(at(run([['', ''], ['', '-3'], ['', '=B2^2']]), 'B3').value, 9);
  assert.equal(at(run([['', ''], ['', '2'], ['', '=-B2^2']]), 'B3').value, -4);
});

test('=2^3^2 is 512, right to left', () => {
  const cell = at(run([['=2^3^2']]), 'A1');
  assert.equal(cell.value, 512);
  assert.equal(cell.display, '512');
  assert.equal(cell.editing, '=2^3^2');
  assert.equal(at(run([['=2**3**2']]), 'A1').value, 512);
  assert.equal(at(run([['=(2^3)^2']]), 'A1').value, 64);
  assert.equal(at(run([['=-2^2']]), 'A1').value, -4);
  assert.equal(at(run([['=(-2)^2']]), 'A1').value, 4);
});

test('=B2/0 is #DIV/0!', () => {
  const cell = at(run([['', ''], ['', '5'], ['', '=B2/0']]), 'B3');
  assert.equal(cell.error, '#DIV/0!');
  assert.equal(cell.display, '#DIV/0!');
  assert.equal(cell.value, null);
  assert.equal(cell.underline, false);
  assert.equal(at(run([['=1/0']]), 'A1').error, '#DIV/0!');
  assert.equal(at(run([['=0/0']]), 'A1').error, '#DIV/0!');
  assert.equal(at(run([['', ''], ['', '5'], ['', ''], ['', '=B2/B3']]), 'B4').error, '#DIV/0!');
});

test('=Z99 is #REF! outside the table', () => {
  const cell = at(run([['=Z99', '1']]), 'A1');
  assert.equal(cell.error, '#REF!');
  assert.equal(cell.display, '#REF!');
  const wide = [Array.from({ length: 26 }, (_, index) => String(index + 1))];
  wide.push(['=Z1']);
  const z = at(math.evaluateTable(grid(wide)), 'A2');
  assert.equal(z.value, 26);
  assert.equal(z.error, null);
});

test('=B4 becomes =B5 when a row is inserted above row 4', () => {
  assert.equal(
    math.rewriteFormula('=B4', { kind: 'insert-rows', row: 4 }),
    '=B5',
  );
  const rows = grid([
    ['', '1'],
    ['', '2'],
    ['', '3'],
    ['', '9'],
    ['=B4', ''],
  ]);
  const shifted = mustShift(rows, { kind: 'insert-rows', row: 4 });
  assert.equal(shifted[4][1].kind === 'text' ? shifted[4][1].content[0].text : '', '9');
  assert.equal(shifted[5][0].source, '=B5');
  const evaluated = math.evaluateTable(shifted);
  assert.equal(at(evaluated, 'A6').value, 9);
  assert.equal(at(evaluated, 'A6').display, '9');
});

test('=B3 becomes =#REF! when row 3 is deleted', () => {
  assert.equal(
    math.rewriteFormula('=B3', { kind: 'delete-rows', row: 3 }),
    '=#REF!',
  );
  const rows = grid([
    ['', '1'],
    ['', '2'],
    ['', '3'],
    ['=B3', ''],
  ]);
  const shifted = mustShift(rows, { kind: 'delete-rows', row: 3 });
  assert.equal(shifted[2][0].source, '=#REF!');
  assert.equal(at(math.evaluateTable(shifted), 'A3').error, '#REF!');
  assert.equal(at(math.evaluateTable(shifted), 'A3').display, '#REF!');
});

test('a row inserted above a referenced cell keeps the value', () => {
  const before = run([
    ['Item', 'Qty'],
    ['A', '10'],
    ['B', '4'],
    ['Total', '=B2+B3*2'],
  ]);
  assert.equal(at(before, 'B4').value, 18);
  const shifted = mustShift(grid([
    ['Item', 'Qty'],
    ['A', '10'],
    ['B', '4'],
    ['Total', '=B2+B3*2'],
  ]), { kind: 'insert-rows', row: 2 });
  assert.equal(shifted[4][1].source, '=B3+B4*2');
  const after = math.evaluateTable(shifted);
  assert.equal(at(after, 'B5').value, 18);
  assert.equal(at(after, 'B3').value, 10);
  assert.equal(at(after, 'B4').value, 4);
});

test('two cells that reference each other show #CYCLE!', () => {
  const evaluated = run([
    ['=B1', '=A1'],
  ]);
  assert.equal(at(evaluated, 'A1').error, '#CYCLE!');
  assert.equal(at(evaluated, 'A1').display, '#CYCLE!');
  assert.equal(at(evaluated, 'B1').error, '#CYCLE!');
  assert.equal(at(evaluated, 'B1').display, '#CYCLE!');
  assert.equal(at(run([['=A1']]), 'A1').error, '#CYCLE!');
});

test('a cycle through a third cell is #CYCLE!, and a reader of that cycle is too', () => {
  const evaluated = run([
    ['=B1', '=C1', '=A1'],
    ['=A1+1', '', ''],
  ]);
  assert.equal(at(evaluated, 'A1').error, '#CYCLE!');
  assert.equal(at(evaluated, 'B1').error, '#CYCLE!');
  assert.equal(at(evaluated, 'C1').error, '#CYCLE!');
  assert.equal(at(evaluated, 'A2').error, '#CYCLE!');
});

test('formulas run in dependency order', () => {
  const evaluated = run([
    ['=B1+1', '=C1+1', '2'],
  ]);
  assert.equal(at(evaluated, 'C1').value, 2);
  assert.equal(at(evaluated, 'B1').value, 3);
  assert.equal(at(evaluated, 'A1').value, 4);
});

test('the header row is row 1', () => {
  const evaluated = run([
    ['Name', 'Score'],
    ['Ada', '10'],
    ['Total', '=B2*2'],
  ]);
  assert.equal(at(evaluated, 'B1').value, null);
  assert.equal(at(evaluated, 'B1').display, 'Score');
  assert.equal(at(evaluated, 'B3').value, 20);
});

test('an empty cell counts as 0 inside a formula and stays blank itself', () => {
  const evaluated = run([
    ['=B1', ''],
    ['=B2+1', '   '],
  ]);
  assert.equal(at(evaluated, 'B1').blank, true);
  assert.equal(at(evaluated, 'B1').display, '');
  assert.equal(at(evaluated, 'B1').value, null);
  assert.equal(at(evaluated, 'A1').value, 0);
  assert.equal(at(evaluated, 'A1').display, '0');
  assert.equal(at(evaluated, 'B2').blank, true);
  assert.equal(at(evaluated, 'A2').value, 1);
});

test('a text cell, including one whose text starts with =, is #REF!', () => {
  const rows = [
    [textCell('hello'), formula('=A1')],
    [textCell('=B2'), formula('=A2')],
    [{
      kind: 'text',
      content: [{ type: 'link', address: 'https://example.com', text: '12' }],
    }, formula('=A3')],
    [{
      kind: 'text',
      content: [
        { type: 'text', text: '12' },
        { type: 'inlineFormula', latex: 'x' },
      ],
    }, formula('=A4')],
    [{
      kind: 'text',
      content: [{ type: 'dateChip', dateTime: '2026-11-25T12:00', format: 'iso-date' }],
    }, formula('=A5')],
  ];
  const evaluated = math.evaluateTable(rows);
  assert.equal(at(evaluated, 'B1').error, '#REF!');
  assert.equal(at(evaluated, 'A2').display, '=B2');
  assert.equal(at(evaluated, 'A2').value, null);
  assert.equal(at(evaluated, 'B2').error, '#REF!');
  assert.equal(at(evaluated, 'B3').value, 12);
  assert.equal(at(evaluated, 'A4').value, null);
  assert.equal(at(evaluated, 'B4').error, '#REF!');
  assert.equal(at(evaluated, 'A5').blank, false);
  assert.equal(at(evaluated, 'B5').error, '#REF!');
});

test('a formula that does not parse stays text with an underline and is not rewritten', () => {
  const samples = [
    '=B2+',
    '=(1+2]',
    '=[1+2)',
    '=()',
    '=SUM(A1)',
    '=#DIV/0!',
    '=AA1',
    '=A',
    '=A0',
    '=.5',
    '=5.',
    '=1e3',
    '=2***3',
    '=1+*2',
    '=B2\n+B3',
    '=-',
    '=1*',
    '=1/',
    `=A${'9'.repeat(20)}`,
  ];
  for (const source of samples) {
    const cell = at(math.evaluateTable([[formula(source)]]), 'A1');
    assert.equal(cell.underline, true, source);
    assert.equal(cell.display, source, source);
    assert.equal(cell.editing, source, source);
    assert.equal(cell.error, null, source);
    assert.equal(cell.value, null, source);
    assert.equal(math.rewriteFormula(source, { kind: 'insert-rows', row: 1 }), source, source);
  }
  const rows = grid([['=B2+']]);
  const shifted = mustShift(rows, { kind: 'insert-rows', row: 1 });
  assert.equal(shifted[1][0].source, '=B2+');
});

test('grouping nests, and each pair closes with its own kind', () => {
  assert.equal(at(run([['=([B1])', '3']]), 'A1').value, 3);
  let nested = '1';
  for (let depth = 0; depth < 50; depth += 1) {
    nested = depth % 2 === 0 ? `(${nested})` : `[${nested}]`;
  }
  assert.equal(at(run([[`=${nested}`]]), 'A1').value, 1);
  const deep = `${'('.repeat(200)}1${')'.repeat(200)}`;
  assert.equal(at(run([[`=${deep}`]]), 'A1').value, 1);
});

test('operators associate and respect precedence', () => {
  assert.equal(at(run([['=2+3*4']]), 'A1').value, 14);
  assert.equal(at(run([['=2*3+4']]), 'A1').value, 10);
  assert.equal(at(run([['=2*3^2']]), 'A1').value, 18);
  assert.equal(at(run([['=(2^3)*4']]), 'A1').value, 32);
  assert.equal(at(run([['=2**3*4']]), 'A1').value, 32);
  assert.equal(at(run([['=8/2*2']]), 'A1').value, 8);
  assert.equal(at(run([['=8/2/2']]), 'A1').value, 2);
  assert.equal(at(run([['=2-3-4']]), 'A1').value, -5);
  assert.equal(at(run([['=2*-3']]), 'A1').value, -6);
  assert.equal(at(run([['=2^-2']]), 'A1').value, 0.25);
  assert.equal(at(run([['=+2']]), 'A1').value, 2);
  assert.equal(at(run([['=1++2']]), 'A1').value, 3);
  assert.equal(at(run([['=007']]), 'A1').value, 7);
  assert.equal(at(run([['=2**3']]), 'A1').value, 8);
  assert.equal(at(run([['=(-2)^3']]), 'A1').value, -8);
  assert.equal(at(run([['=4^0.5']]), 'A1').display, '2');
});

test('spaces and tabs are allowed between tokens, and lowercase references match', () => {
  const spaced = at(run([
    ['', ''],
    ['', '10'],
    ['', '3'],
    ['', '= B2 + B3 * 2'],
  ]), 'B4');
  assert.equal(spaced.value, 16);
  const tabbed = at(run([['=1\t+\t2']]), 'A1');
  assert.equal(tabbed.value, 3);
  assert.equal(at(run([['', ''], ['', '10'], ['', '3'], ['', '=b2+b3*2']]), 'B4').value, 16);
  assert.equal(math.rewriteFormula('=b4', { kind: 'insert-rows', row: 4 }), '=b5');
  assert.equal(math.rewriteFormula('=B2 + B3', { kind: 'insert-rows', row: 2 }), '=B3 + B4');
});

test('display keeps at most 10 decimal places', () => {
  assert.equal(math.formatMathValue(1 / 3), '0.3333333333');
  assert.equal(math.formatMathValue(2 / 3), '0.6666666667');
  assert.equal(math.formatMathValue(-1 / 3), '-0.3333333333');
  assert.equal(math.formatMathValue(0.1 + 0.2), '0.3');
  assert.equal(math.formatMathValue(-0), '0');
  assert.equal(math.formatMathValue(Number.POSITIVE_INFINITY), '#DIV/0!');
  assert.equal(at(run([['=1/3']]), 'A1').display, '0.3333333333');
  assert.equal(at(run([['=2/3']]), 'A1').display, '0.6666666667');
  assert.equal(at(run([['=1/2']]), 'A1').display, '0.5');
  assert.equal(at(run([['=0/-1']]), 'A1').display, '0');
  const typed = at(run([['2.50', '=A1']]), 'B1');
  assert.equal(at(run([['2.50']]), 'A1').display, '2.50');
  assert.equal(at(run([['2.50']]), 'A1').value, 2.5);
  assert.equal(typed.value, 2.5);
  assert.equal(at(run([['007', '=A1']]), 'B1').value, 7);
  assert.equal(at(run([[' 10 ', '=A1']]), 'B1').value, 10);
});

test('a power that is not a finite real number is #DIV/0!, and 0^0 is 1', () => {
  assert.equal(at(run([['=0^0']]), 'A1').value, 1);
  assert.equal(at(run([['=(-2)^0.5']]), 'A1').error, '#DIV/0!');
  assert.equal(at(run([['=0^-1']]), 'A1').error, '#DIV/0!');
  assert.equal(at(run([['=2^1024']]), 'A1').error, '#DIV/0!');
});

test('errors already in a cell propagate from the left', () => {
  const evaluated = run([
    ['=1/0', '=A1+1', '=#REF!/0', '=-(1/0)', '=1+#REF!'],
  ]);
  assert.equal(at(evaluated, 'B1').error, '#DIV/0!');
  assert.equal(at(evaluated, 'C1').error, '#REF!');
  assert.equal(at(evaluated, 'D1').error, '#DIV/0!');
  assert.equal(at(evaluated, 'E1').error, '#REF!');
});

test('a formula cell whose text does not start with = stays text', () => {
  const cell = at(math.evaluateTable([[formula('1+2')]]), 'A1');
  assert.equal(cell.underline, true);
  assert.equal(cell.display, '1+2');
  assert.equal(math.rewriteFormula('B4', { kind: 'insert-rows', row: 1 }), 'B4');
});

test('a number that does not fit in a finite value is text, and the same formula does not parse', () => {
  const huge = '9'.repeat(400);
  const evaluated = math.evaluateTable([
    [textCell(huge), formula(`=A1`), formula(`=${huge}`)],
  ]);
  assert.equal(at(evaluated, 'A1').value, null);
  assert.equal(at(evaluated, 'B1').error, '#REF!');
  assert.equal(at(evaluated, 'C1').underline, true);
});

test('inserting or deleting a column rewrites references', () => {
  assert.equal(math.rewriteFormula('=C2', { kind: 'insert-columns', column: 3 }), '=D2');
  assert.equal(math.rewriteFormula('=C2', { kind: 'delete-columns', column: 3 }), '=#REF!');
  assert.equal(math.rewriteFormula('=D2', { kind: 'delete-columns', column: 3 }), '=C2');
  const inserted = mustShift(grid([
    ['1', '9', '3'],
    ['=B1', '', ''],
  ]), { kind: 'insert-columns', column: 2 });
  assert.equal(inserted[1][0].source, '=C1');
  assert.equal(inserted[0][2].content[0].text, '9');
  assert.equal(at(math.evaluateTable(inserted), 'A2').value, 9);
  const deleted = mustShift(grid([
    ['1', '8', '3'],
    ['=A1+1', '', '=A1+1'],
  ]), { kind: 'delete-columns', column: 2 });
  assert.equal(deleted[1][1].source, '=A1+1');
  assert.equal(at(math.evaluateTable(deleted), 'B2').value, 2);
  const lost = mustShift(grid([
    ['1', '8', '3'],
    ['', '=B1', '=B1+1'],
  ]), { kind: 'delete-columns', column: 2 });
  assert.equal(lost[1][1].source, '=#REF!+1');
  assert.equal(at(math.evaluateTable(lost), 'B2').error, '#REF!');
});

test('deleting several rows rewrites each reference once', () => {
  assert.equal(
    math.rewriteFormula('=B3+C4+B5', { kind: 'delete-rows', row: 3, count: 2 }),
    '=#REF!+#REF!+B3',
  );
  assert.equal(
    math.rewriteFormula('=B4', { kind: 'insert-rows', row: 4, count: 2 }),
    '=B6',
  );
  assert.equal(
    math.rewriteFormula('=#REF!+B4', { kind: 'insert-rows', row: 4 }),
    '=#REF!+B5',
  );
  const shifted = mustShift(grid([
    ['1'],
    ['2'],
    ['3'],
    ['4'],
    ['=A4'],
  ]), { kind: 'delete-rows', row: 2, count: 2 });
  assert.equal(shifted[2][0].source, '=A2');
  assert.equal(at(math.evaluateTable(shifted), 'A3').value, 4);
});

test('a reference past the grid still shifts, and column Z cannot move past Z', () => {
  assert.equal(math.rewriteFormula('=A50', { kind: 'insert-rows', row: 1 }), '=A51');
  assert.equal(math.rewriteFormula('=Z1', { kind: 'insert-columns', column: 1 }), '=#REF!');
  const shifted = mustShift(grid([['=Z1', '4']]), { kind: 'insert-columns', column: 1 });
  assert.equal(shifted[0][1].source, '=#REF!');
  assert.equal(at(math.evaluateTable(shifted), 'B1').error, '#REF!');
});

test('an unparsed formula is not part of a cycle', () => {
  const evaluated = run([
    ['=B1+', '=A1'],
  ]);
  assert.equal(at(evaluated, 'A1').underline, true);
  assert.equal(at(evaluated, 'B1').error, '#REF!');
});

test('insert and delete refuse an empty result, a ragged grid, and a table past the limit', () => {
  const one = grid([['1']]);
  assert.deepEqual(math.shiftTable(one, { kind: 'delete-rows', row: 1 }), { ok: false, reason: 'out-of-range' });
  assert.deepEqual(math.shiftTable(one, { kind: 'delete-columns', column: 1 }), { ok: false, reason: 'out-of-range' });
  assert.deepEqual(math.shiftTable(one, { kind: 'insert-rows', row: 3 }), { ok: false, reason: 'out-of-range' });
  assert.deepEqual(math.shiftTable(one, { kind: 'insert-columns', column: 3 }), { ok: false, reason: 'out-of-range' });
  assert.deepEqual(math.shiftTable(one, { kind: 'insert-rows', row: 0 }), { ok: false, reason: 'out-of-range' });
  assert.deepEqual(math.shiftTable(one, { kind: 'delete-rows', row: 1, count: 0 }), { ok: false, reason: 'out-of-range' });
  assert.deepEqual(math.shiftTable(one, { kind: 'insert-rows', row: 1, count: 1.5 }), { ok: false, reason: 'out-of-range' });
  assert.deepEqual(math.shiftTable([], { kind: 'insert-rows', row: 1 }), { ok: false, reason: 'out-of-range' });
  assert.deepEqual(math.shiftTable([[]], { kind: 'insert-columns', column: 1 }), { ok: false, reason: 'out-of-range' });
  const ragged = [textCell('1'), textCell('2')];
  assert.equal(math.shiftTable([
    [textCell('1')],
    [ragged[0], ragged[1]],
  ], { kind: 'insert-rows', row: 1 }).ok, false);
  const fullRows = Array.from({ length: 200 }, () => [textCell('1')]);
  const snapshot = structuredClone(fullRows);
  assert.deepEqual(math.shiftTable(fullRows, { kind: 'insert-rows', row: 1 }), { ok: false, reason: 'too-big' });
  assert.deepEqual(fullRows, snapshot);
  const fullColumns = [Array.from({ length: 26 }, () => textCell('1'))];
  assert.equal(math.shiftTable(fullColumns, { kind: 'insert-columns', column: 1 }).reason, 'too-big');
  assert.equal(math.rewriteFormula('=A1', { kind: 'insert-rows', row: 1, count: 0 }), '=A1');
});

test('a shift copies cells and can append a row or column', () => {
  const rows = grid([['1', '=A1+1']]);
  const snapshot = structuredClone(rows);
  const appended = mustShift(rows, { kind: 'insert-rows', row: 2 });
  assert.deepEqual(rows, snapshot);
  assert.equal(appended.length, 2);
  assert.deepEqual(appended[1][0], { kind: 'text', content: [] });
  assert.equal(appended[0][1].source, '=A1+1');
  const widened = mustShift(rows, { kind: 'insert-columns', column: 3 });
  assert.equal(widened[0].length, 3);
  assert.deepEqual(widened[0][2], { kind: 'text', content: [] });
  assert.equal(at(math.evaluateTable(widened), 'B1').value, 2);
});

test('a short row does not invent cells', () => {
  const evaluated = math.evaluateTable([
    [textCell('1'), textCell('2'), textCell('3')],
    [formula('=C1'), formula('=C2')],
  ]);
  assert.equal(at(evaluated, 'A2').value, 3);
  assert.equal(at(evaluated, 'B2').error, '#REF!');
});
