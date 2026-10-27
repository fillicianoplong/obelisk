import { ImportedXmlComponent, Paragraph, type ParagraphChild } from 'docx';

const MATH_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/math';

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function run(text: string): string {
  return `<m:r><m:t xml:space="preserve">${escapeXml(text)}</m:t></m:r>`;
}

function sup(base: string, exponent: string): string {
  return `<m:sSup><m:e>${run(base)}</m:e><m:sup>${run(exponent)}</m:sup></m:sSup>`;
}

function wrap(inner: string): string {
  return `<m:oMath xmlns:m="${MATH_NS}">${inner}</m:oMath>`;
}

export const FORMULA_SAMPLES = [
  {
    id: 'fraction',
    title: 'Fraction',
    latex: '\\frac{a+b}{c}',
    word: 'an editable fraction, a+b over c',
    image: 'the picture of a+b over a bar over c',
    omml: wrap(
      `<m:f><m:num>${run('a')}${run('+')}${run('b')}</m:num><m:den>${run('c')}</m:den></m:f>`,
    ),
  },
  {
    id: 'root',
    title: 'Root and power',
    latex: '\\sqrt{x^2+y^2}',
    word: 'an editable square root of x squared plus y squared',
    image: 'the picture of a radical over x with a superscript 2, plus y with a superscript 2',
    omml: wrap(
      `<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg>${run('')}</m:deg><m:e>${sup('x', '2')}${run('+')}${sup('y', '2')}</m:e></m:rad>`,
    ),
  },
  {
    id: 'sum',
    title: 'Sum',
    latex: '\\sum_{i=1}^{n} i^2',
    word: 'an editable sum from i=1 to n of i squared',
    image: 'the picture of a sigma whose point faces right, from i=1 to n, of i with a superscript 2',
    omml: wrap(
      `<m:nary><m:naryPr><m:chr m:val="\u2211"/><m:limLoc m:val="undOvr"/></m:naryPr><m:sub>${run('i=1')}</m:sub><m:sup>${run('n')}</m:sup><m:e>${sup('i', '2')}</m:e></m:nary>`,
    ),
  },
  {
    id: 'integral',
    title: 'Integral',
    latex: '\\int_0^1 x\\,dx',
    word: 'an editable integral of x dx from 0 to 1. The thin space in the sample is a separate math run between x and dx',
    image: 'the picture of an integral of x dx from 0 to 1. The top of the sign curls right and the bottom curls left',
    omml: wrap(
      `<m:nary><m:naryPr><m:chr m:val="\u222b"/><m:limLoc m:val="subSup"/></m:naryPr><m:sub>${run('0')}</m:sub><m:sup>${run('1')}</m:sup><m:e>${run('x')}${run('dx')}</m:e></m:nary>`,
    ),
  },
  {
    id: 'matrix',
    title: 'Matrix',
    latex: '\\begin{pmatrix}1&0\\\\0&1\\end{pmatrix}',
    word: 'an editable 2 by 2 matrix in parentheses, first row 1 0, second row 0 1',
    image: 'the picture of that matrix',
    omml: wrap(
      `<m:d><m:dPr><m:begChr m:val="("/><m:endChr m:val=")"/></m:dPr><m:e><m:m><m:mr><m:e>${run('1')}</m:e><m:e>${run('0')}</m:e></m:mr><m:mr><m:e>${run('0')}</m:e><m:e>${run('1')}</m:e></m:mr></m:m></m:e></m:d>`,
    ),
  },
  {
    id: 'greek',
    title: 'Greek and accents',
    latex: '\\hat{\\theta} = \\alpha + \\beta',
    word: 'an editable equation: theta with a hat, then equals alpha plus beta',
    image: 'the picture of theta with a hat, then equals, alpha, plus, beta',
    omml: wrap(
      `<m:acc><m:accPr><m:chr m:val="\u0302"/></m:accPr><m:e>${run('\u03b8')}</m:e></m:acc>${run('=')}${run('\u03b1')}${run('+')}${run('\u03b2')}`,
    ),
  },
] as const;

interface XmlNode {
  rootKey: string | undefined;
  root: readonly XmlNode[];
}

export function parsedOmml(xml: string): { wrapper: ImportedXmlComponent; math: ImportedXmlComponent } {
  const wrapper = ImportedXmlComponent.fromXmlString(xml);
  const node = wrapper as unknown as XmlNode;
  const math = node.root.find((child) => child.rootKey === 'm:oMath');
  if (!math) {
    throw new Error('fromXmlString did not produce an m:oMath child');
  }
  return { wrapper, math: math as unknown as ImportedXmlComponent };
}

export function ommlParagraph(xml: string, rawWrapper: boolean): Paragraph {
  const parsed = parsedOmml(xml);
  const child = (rawWrapper ? parsed.wrapper : parsed.math) as unknown as ParagraphChild;
  return new Paragraph({ children: [child] });
}

export function wrapperRootKey(xml: string): string | undefined {
  return (ImportedXmlComponent.fromXmlString(xml) as unknown as XmlNode).rootKey;
}
