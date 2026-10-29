import { parseXml, attribute, childElements, descendants, mathNamespace, textContent } from './xml';

export interface OmmlStructure {
  rootName: string;
  prefix: string | null;
  namespace: string | null;
  texts: string[];
  emptyTextCount: number;
  hasThinSpace: boolean;
  containsLatexSource: boolean;
  fraction: { numerator: string; denominator: string } | null;
  radical: { degreeHidden: boolean } | null;
  nary: { character: string | null; limitLocation: string | null; sub: string; sup: string; element: string; elementEmpty: boolean } | null;
  superscript: { base: string; sup: string } | null;
  matrixRows: string[][];
  parentheses: string[];
  accent: { character: string | null; codePoint: number | null; base: string } | null;
}

export function readStructure(omml: string, latex: string): OmmlStructure {
  const document = parseXml(omml, 'OMML');
  const root = document.documentElement;
  if (!root) {
    throw new Error('OMML has no root element');
  }
  const texts: string[] = [];
  let emptyTextCount = 0;
  for (const node of descendants(root, mathNamespace, 't')) {
    const text = textContent(node);
    if (text === '') {
      emptyTextCount += 1;
    } else {
      texts.push(text);
    }
  }
  const fractionElement = descendants(root, mathNamespace, 'f')[0];
  const radicalElement = descendants(root, mathNamespace, 'rad')[0];
  const naryElement = descendants(root, mathNamespace, 'nary')[0];
  const superscriptElement = descendants(root, mathNamespace, 'sSup')[0];
  const accentElement = descendants(root, mathNamespace, 'acc')[0];
  return {
    rootName: root.localName ?? '',
    prefix: root.prefix,
    namespace: root.namespaceURI,
    texts,
    emptyTextCount,
    hasThinSpace: omml.includes('\u2009'),
    containsLatexSource: texts.some((text) => text.includes(latex)),
    fraction: fractionElement ? readFraction(fractionElement) : null,
    radical: radicalElement ? readRadical(radicalElement) : null,
    nary: naryElement ? readNary(naryElement) : null,
    superscript: superscriptElement ? readSuperscript(superscriptElement) : null,
    matrixRows: readMatrix(root),
    parentheses: texts.filter((text) => text === '(' || text === ')'),
    accent: accentElement ? readAccent(accentElement) : null,
  };
}

function firstChild(element: Element, localName: string): Element {
  const found = childElements(element).find((child) => child.namespaceURI === mathNamespace && child.localName === localName);
  if (!found) {
    throw new Error(`Missing m:${localName}`);
  }
  return found;
}

function optionalChild(element: Element, localName: string): Element | null {
  return childElements(element).find((child) => child.namespaceURI === mathNamespace && child.localName === localName) ?? null;
}

function readRadical(element: Element): { degreeHidden: boolean } {
  const properties = optionalChild(element, 'radPr');
  const hidden = properties ? optionalChild(properties, 'degHide') : null;
  return { degreeHidden: hidden !== null && attribute(hidden, 'm:val') === 'on' };
}

function readFraction(element: Element): { numerator: string; denominator: string } {
  return {
    numerator: textContent(firstChild(element, 'num')),
    denominator: textContent(firstChild(element, 'den')),
  };
}

function readNary(element: Element): OmmlStructure['nary'] {
  const properties = optionalChild(element, 'naryPr');
  const character = properties ? optionalChild(properties, 'chr') : null;
  const limits = properties ? optionalChild(properties, 'limLoc') : null;
  const body = firstChild(element, 'e');
  const bodyText = textContent(body);
  return {
    character: character ? attribute(character, 'm:val') : null,
    limitLocation: limits ? attribute(limits, 'm:val') : null,
    sub: textContent(firstChild(element, 'sub')),
    sup: textContent(firstChild(element, 'sup')),
    element: bodyText,
    elementEmpty: bodyText === '' && childElements(body).length === 0,
  };
}

function readSuperscript(element: Element): { base: string; sup: string } {
  return {
    base: textContent(firstChild(element, 'e')),
    sup: textContent(firstChild(element, 'sup')),
  };
}

function readMatrix(root: Element): string[][] {
  const matrix = descendants(root, mathNamespace, 'm')[0];
  if (!matrix) {
    return [];
  }
  return childElements(matrix)
    .filter((child) => child.localName === 'mr')
    .map((row) =>
      childElements(row)
        .filter((cell) => cell.localName === 'e')
        .map((cell) => textContent(cell)),
    );
}

function readAccent(element: Element): OmmlStructure['accent'] {
  const properties = optionalChild(element, 'accPr');
  const character = properties ? optionalChild(properties, 'chr') : null;
  const value = character ? attribute(character, 'm:val') : null;
  return {
    character: value,
    codePoint: value ? value.codePointAt(0) ?? null : null,
    base: textContent(firstChild(element, 'e')),
  };
}

export function assertSampleStructure(id: string, display: OmmlStructure, inline: OmmlStructure): string[] {
  const problems: string[] = [];
  for (const structure of [display, inline]) {
    if (structure.rootName !== 'oMath' || structure.prefix !== 'm' || structure.namespace !== mathNamespace) {
      problems.push(`${id} root is ${structure.prefix}:${structure.rootName} in ${structure.namespace}`);
    }
    if (structure.containsLatexSource) {
      problems.push(`${id} copied the LaTeX source into an equation text run`);
    }
  }
  if (id === 'fraction') {
    expectFraction(problems, display);
    expectFraction(problems, inline);
  } else if (id === 'root-and-power') {
    expectRoot(problems, display);
    expectRoot(problems, inline);
  } else if (id === 'sum') {
    expectSum(problems, display, 'undOvr');
    expectSum(problems, inline, 'subSup');
  } else if (id === 'integral') {
    expectIntegral(problems, display);
    expectIntegral(problems, inline);
  } else if (id === 'matrix') {
    expectMatrix(problems, display);
    expectMatrix(problems, inline);
  } else if (id === 'greek-and-accents') {
    expectGreek(problems, display);
    expectGreek(problems, inline);
  } else {
    problems.push(`No structure check for ${id}`);
  }
  return problems;
}

function expectFraction(problems: string[], structure: OmmlStructure): void {
  if (structure.fraction?.numerator !== 'a+b' || structure.fraction.denominator !== 'c') {
    problems.push(`Fraction was ${JSON.stringify(structure.fraction)}`);
  }
}

function expectRoot(problems: string[], structure: OmmlStructure): void {
  if (!structure.radical?.degreeHidden) {
    problems.push('Root degree was not hidden');
  }
  if (!structure.texts.includes('x') || !structure.texts.includes('y') || structure.texts.filter((text) => text === '2').length !== 2) {
    problems.push(`Root texts were ${structure.texts.join(', ')}`);
  }
}

function expectSum(problems: string[], structure: OmmlStructure, limitLocation: string): void {
  const nary = structure.nary;
  if (nary?.character !== '∑' || nary.limitLocation !== limitLocation || nary.sub !== 'i=1' || nary.sup !== 'n') {
    problems.push(`Sum n-ary was ${JSON.stringify(nary)}`);
  }
  if (!nary?.elementEmpty) {
    problems.push('Sum n-ary element was not empty');
  }
  if (structure.superscript?.base !== 'i' || structure.superscript.sup !== '2') {
    problems.push(`Sum operand was ${JSON.stringify(structure.superscript)}`);
  }
}

function expectIntegral(problems: string[], structure: OmmlStructure): void {
  const nary = structure.nary;
  if (nary?.character !== '∫' || nary.sub !== '0' || nary.sup !== '1' || nary.element !== 'x') {
    problems.push(`Integral n-ary was ${JSON.stringify(nary)}`);
  }
  if (!structure.texts.includes('dx')) {
    problems.push('Integral is missing dx');
  }
  if (structure.emptyTextCount < 1 || structure.hasThinSpace) {
    problems.push('The thin space from \\, was not the empty run this build produces');
  }
}

function expectMatrix(problems: string[], structure: OmmlStructure): void {
  const rows = structure.matrixRows.map((row) => row.join(',')).join(';');
  if (rows !== '1,0;0,1') {
    problems.push(`Matrix rows were ${rows}`);
  }
  if (structure.parentheses.join('') !== '()') {
    problems.push(`Matrix parentheses were ${structure.parentheses.join('')}`);
  }
}

function expectGreek(problems: string[], structure: OmmlStructure): void {
  if (structure.accent?.codePoint !== 0x302 || structure.accent.base !== 'θ') {
    problems.push(`Accent was ${JSON.stringify(structure.accent)}`);
  }
  if (!structure.texts.includes('=α+β')) {
    problems.push(`Greek texts were ${structure.texts.join(', ')}`);
  }
}
