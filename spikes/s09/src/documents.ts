import {
  AlignmentType,
  BorderStyle,
  CheckBox,
  Document,
  ExternalHyperlink,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  PageBreak,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type FileChild,
  type ISectionOptions,
} from 'docx';
import { FORMULA_SAMPLES, ommlParagraph } from './omml';
import {
  BLUE,
  DIAGRAM_DISPLAY,
  DRAWING_DISPLAY,
  FRACTION_DISPLAY,
  GREEK_DISPLAY,
  GREEN,
  INTEGRAL_DISPLAY,
  MATRIX_DISPLAY,
  RADICAL_DISPLAY,
  RED,
  SIGNATURE_DISPLAY,
  SUM_DISPLAY,
  SWATCH_DISPLAY,
  diagramImage,
  drawingImage,
  fractionImage,
  greekImage,
  integralImage,
  matrixImage,
  radicalImage,
  signatureImage,
  sumImage,
  swatch,
} from './png';

const SYMBOL_FONT = 'Segoe UI Symbol';
const BODY_FONT = 'Calibri';
const TEXT_WIDTH = 9360;

const NIL = { style: BorderStyle.NIL, size: 0, color: 'auto' } as const;
const NO_BORDERS = {
  top: NIL,
  bottom: NIL,
  left: NIL,
  right: NIL,
  insideHorizontal: NIL,
  insideVertical: NIL,
};

export const ALT_DESCRIPTION = 'Red square, the alt text sample for FR-52.';
export const LINK_URL = 'https://example.invalid/obelisk-s09';
export const MARKUP = '<' + '&' + ']]>';
export const CONTROLS = String.fromCharCode(0, 1, 8, 11, 12, 14, 31, 127);
export const SURROGATES = `H${String.fromCharCode(0xd800)}L${String.fromCharCode(0xdc00)}`;

export interface BuiltFile {
  name: string;
  purpose: string;
  bytes: Buffer;
}

function note(text: string): Paragraph {
  return new Paragraph({
    spacing: { before: 80, after: 160 },
    children: [new TextRun({ text, italics: true, size: 22, color: '333333' })],
  });
}

function heading(text: string, level: (typeof HeadingLevel)[keyof typeof HeadingLevel] = HeadingLevel.HEADING_1): Paragraph {
  return new Paragraph({ heading: level, text });
}

function body(text: string): Paragraph {
  return new Paragraph({ spacing: { after: 120 }, children: [new TextRun(text)] });
}

function picture(data: Buffer, width: number, height: number, description: string, name: string): Paragraph {
  return new Paragraph({
    spacing: { after: 160 },
    children: [
      new ImageRun({
        type: 'png',
        data,
        transformation: { width, height },
        altText: { name, description, title: name },
      }),
    ],
  });
}

function pageHeader(label: string): Header {
  return new Header({
    children: [
      new Paragraph({
        children: [
          new TextRun(`${label}   Page `),
          new TextRun({ children: [PageNumber.CURRENT] }),
          new TextRun(' of '),
          new TextRun({ children: [PageNumber.TOTAL_PAGES] }),
        ],
      }),
    ],
  });
}

function pageFooter(label: string): Footer {
  return new Footer({
    children: [new Paragraph(`Footer: ${label}. Ordinary footer text, not a field.`)],
  });
}

function section(label: string, children: readonly FileChild[]): ISectionOptions {
  return {
    properties: {
      page: {
        size: { width: 12240, height: 15840 },
        margin: { top: 1440, right: 1440, bottom: 1440, left: 1440, header: 720, footer: 720 },
      },
    },
    headers: { default: pageHeader(label) },
    footers: { default: pageFooter(label) },
    children,
  };
}

function cell(text: string, width: number, bold = false, borders = true): TableCell {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    borders: borders ? undefined : { top: NIL, bottom: NIL, left: NIL, right: NIL },
    children: [new Paragraph({ children: [new TextRun({ text, bold })] })],
  });
}

function linkParagraph(linkText: string, url: string): Paragraph {
  return new Paragraph({
    spacing: { after: 120 },
    children: [
      new ExternalHyperlink({
        link: url,
        children: [new TextRun({ text: linkText, style: 'Hyperlink' })],
      }),
    ],
  });
}

async function pack(title: string, sections: readonly ISectionOptions[], numbering = false): Promise<Buffer> {
  const doc = new Document({
    title,
    creator: 'Filliciano Plong',
    description: 'Spike S-09 sample. Throwaway.',
    styles: {
      default: {
        document: {
          run: { font: BODY_FONT, size: 22 },
        },
      },
      paragraphStyles: numbering
        ? [
            {
              id: 'Quote',
              name: 'Quote',
              basedOn: 'Normal',
              quickFormat: true,
              paragraph: { indent: { left: 720 } },
              run: { italics: true },
            },
          ]
        : [],
    },
    numbering: numbering
      ? {
          config: [
            {
              reference: 's09-bullets',
              levels: [
                {
                  level: 0,
                  format: LevelFormat.BULLET,
                  text: '\u2022',
                  alignment: AlignmentType.LEFT,
                  style: { paragraph: { indent: { left: 720, hanging: 360 } } },
                },
              ],
            },
            {
              reference: 's09-numbers',
              levels: [
                {
                  level: 0,
                  format: LevelFormat.DECIMAL,
                  text: '%1.',
                  alignment: AlignmentType.LEFT,
                  style: { paragraph: { indent: { left: 720, hanging: 360 } } },
                },
              ],
            },
          ],
        }
      : undefined,
    sections: [...sections],
  });
  return Packer.toBuffer(doc);
}

export async function buildExportReference(): Promise<Buffer> {
  const photo = swatch(BLUE, 'PHOTO');
  const frame = swatch(GREEN, 'FRAME 1');
  const children: FileChild[] = [
    heading('Export reference'),
    note('Each heading below names one row of the SRS Export reference and says what Word should show. Page size is Letter, margins 1 inch. The header and footer are on every page.'),
    heading('Text and headings', HeadingLevel.HEADING_2),
    note('Word should show this as a Heading 2, and the next lines as a normal paragraph and a Heading 3.'),
    body('This is a normal paragraph. It is text, not a heading.'),
    heading('A third-level heading', HeadingLevel.HEADING_3),
    heading('Lists and checklist', HeadingLevel.HEADING_2),
    note('Word should show a bulleted list, then a numbered list, then two checkbox symbols in Segoe UI Symbol, then a Word checkbox content control. The empty symbol should be an empty box, not a letter. The third line is a real checkbox, so it can be compared with the symbols.'),
    new Paragraph({
      numbering: { reference: 's09-bullets', level: 0 },
      children: [new TextRun('First bullet')],
    }),
    new Paragraph({
      numbering: { reference: 's09-bullets', level: 0 },
      children: [new TextRun('Second bullet')],
    }),
    new Paragraph({
      numbering: { reference: 's09-numbers', level: 0 },
      children: [new TextRun('First number')],
    }),
    new Paragraph({
      numbering: { reference: 's09-numbers', level: 0 },
      children: [new TextRun('Second number')],
    }),
    new Paragraph({
      spacing: { after: 120 },
      children: [
        new TextRun({ text: '\u2610', font: SYMBOL_FONT }),
        new TextRun(' An empty checkbox, as a symbol in Segoe UI Symbol'),
      ],
    }),
    new Paragraph({
      spacing: { after: 120 },
      children: [
        new TextRun({ text: '\u2611', font: SYMBOL_FONT }),
        new TextRun(' A checked checkbox, as a symbol in Segoe UI Symbol'),
      ],
    }),
    new Paragraph({
      spacing: { after: 120 },
      children: [
        new CheckBox({
          checked: false,
          alias: 'Empty checkbox',
          checkedState: { value: '2611', font: SYMBOL_FONT },
          uncheckedState: { value: '2610', font: SYMBOL_FONT },
        }),
        new TextRun(' An empty checkbox, as a Word content control'),
      ],
    }),
    heading('Quote, code, divider', HeadingLevel.HEADING_2),
    note('Word should show the next paragraph in the Quote style, then Consolas for the code line, then a horizontal rule under the divider line.'),
    new Paragraph({
      style: 'Quote',
      children: [new TextRun('A quoted sentence that should use the Quote style.')],
    }),
    new Paragraph({
      shading: { type: ShadingType.CLEAR, fill: 'F2F2F2' },
      spacing: { before: 120, after: 120 },
      children: [new TextRun({ text: 'const answer = 42;', font: 'Consolas', size: 24 })],
    }),
    new Paragraph({
      thematicBreak: true,
      spacing: { before: 120 },
      children: [new TextRun('Divider. A rule should sit under this line.')],
    }),
    heading('Table', HeadingLevel.HEADING_2),
    note('Word should show a table of values. The total cell is the value 5. The source cell was the formula =B2+B3. Word should show 5, not the formula.'),
    new Table({
      width: { size: TEXT_WIDTH, type: WidthType.DXA },
      columnWidths: [TEXT_WIDTH / 2, TEXT_WIDTH / 2],
      rows: [
        new TableRow({
          tableHeader: true,
          children: [cell('Item', TEXT_WIDTH / 2, true), cell('Count', TEXT_WIDTH / 2, true)],
        }),
        new TableRow({ children: [cell('Apples', TEXT_WIDTH / 2), cell('2', TEXT_WIDTH / 2)] }),
        new TableRow({ children: [cell('Bananas', TEXT_WIDTH / 2), cell('3', TEXT_WIDTH / 2)] }),
        new TableRow({ children: [cell('Total', TEXT_WIDTH / 2, true), cell('5', TEXT_WIDTH / 2, true)] }),
      ],
    }),
    heading('Image', HeadingLevel.HEADING_2),
    note('Word should show three images: a photograph sample, a flattened drawing, and the first frame of an animation. Each has alt text. Select one and open the Alt Text pane.'),
    body('Photograph. Alt text: Photograph sample.'),
    picture(photo, SWATCH_DISPLAY[0], SWATCH_DISPLAY[1], 'Photograph sample', 'photograph'),
    body('Drawing, flattened to an image. Alt text: Flattened drawing.'),
    picture(drawingImage(), DRAWING_DISPLAY[0], DRAWING_DISPLAY[1], 'Flattened drawing', 'drawing'),
    body('First frame of an animation. Alt text: First frame of an animation.'),
    picture(frame, SWATCH_DISPLAY[0], SWATCH_DISPLAY[1], 'First frame of an animation', 'frame-1'),
    heading('Formula', HeadingLevel.HEADING_2),
    note('Word should show one editable equation here, the fraction (a+b)/c. The six formula samples with conversion on are in equations-on.docx. The same samples as images are in equations-off.docx.'),
    ommlParagraph(FORMULA_SAMPLES[0].omml, false),
    heading('Page break', HeadingLevel.HEADING_2),
    note('Word should put the next paragraph at the top of the next page.'),
    new Paragraph({
      pageBreakBefore: true,
      spacing: { after: 120 },
      children: [new TextRun('This paragraph should be at the top of the next page.')],
    }),
    heading('Header and footer', HeadingLevel.HEADING_2),
    note('The header on every page should contain the words Export reference, then Page, the page number, of, and the page count. The footer should read Footer: Export reference. Ordinary footer text, not a field.'),
    heading('Date chip', HeadingLevel.HEADING_2),
    note('Word should show the next line as ordinary text, not a date field: March 4, 2027.'),
    body('March 4, 2027'),
    heading('Column row', HeadingLevel.HEADING_2),
    note('Word should show three columns side by side in a table with no borders.'),
    new Table({
      width: { size: TEXT_WIDTH, type: WidthType.DXA },
      columnWidths: [TEXT_WIDTH / 3, TEXT_WIDTH / 3, TEXT_WIDTH / 3],
      borders: NO_BORDERS,
      rows: [
        new TableRow({
          children: [
            cell('Left column', TEXT_WIDTH / 3, false, false),
            cell('Middle column', TEXT_WIDTH / 3, false, false),
            cell('Right column', TEXT_WIDTH / 3, false, false),
          ],
        }),
      ],
    }),
    heading('Drawing, signature, diagram', HeadingLevel.HEADING_2),
    note('Word should show three images: a drawing, a signature, and a diagram.'),
    body('Drawing. Alt text: Drawing sample.'),
    picture(drawingImage(), DRAWING_DISPLAY[0], DRAWING_DISPLAY[1], 'Drawing sample', 'drawing-sample'),
    body('Signature. Alt text: Signature sample.'),
    picture(signatureImage(), SIGNATURE_DISPLAY[0], SIGNATURE_DISPLAY[1], 'Signature sample', 'signature'),
    body('Diagram. Alt text: Diagram sample.'),
    picture(diagramImage(), DIAGRAM_DISPLAY[0], DIAGRAM_DISPLAY[1], 'Diagram sample', 'diagram'),
    heading('Link inside text', HeadingLevel.HEADING_2),
    note('Word should show the next two lines as hyperlinks, one https and one mailto. The visible text is the address.'),
    linkParagraph('https://example.invalid/obelisk', 'https://example.invalid/obelisk'),
    linkParagraph('s09@example.invalid', 'mailto:s09@example.invalid'),
  ];
  return pack('S-09 export reference', [section('Export reference', children)], true);
}

const FORMULA_IMAGES = [
  fractionImage(),
  radicalImage(),
  sumImage(),
  integralImage(),
  matrixImage(),
  greekImage(),
];

const FORMULA_IMAGE_SIZE: ReadonlyArray<readonly [number, number]> = [
  FRACTION_DISPLAY,
  RADICAL_DISPLAY,
  SUM_DISPLAY,
  INTEGRAL_DISPLAY,
  MATRIX_DISPLAY,
  GREEK_DISPLAY,
];

export async function buildEquationsOn(): Promise<Buffer> {
  const children: FileChild[] = [
    heading('Equations, conversion on'),
    note('Each sample below should be an editable Word equation. Click it and Word should open the equation for editing. These are the six samples from the SRS formula reference. The OMML was inserted with ImportedXmlComponent.fromXmlString, using the m:oMath child of that call.'),
  ];
  for (const sample of FORMULA_SAMPLES) {
    children.push(heading(sample.title, HeadingLevel.HEADING_2));
    children.push(note(`Word should show ${sample.word}. LaTeX: ${sample.latex}`));
    children.push(ommlParagraph(sample.omml, false));
  }
  return pack('S-09 equations on', [section('Equations on', children)]);
}

export async function buildEquationsOff(): Promise<Buffer> {
  const children: FileChild[] = [
    heading('Equations, conversion off'),
    note('Each sample below should be an image, not an editable equation. Clicking it should select a picture. These are the same six SRS formula samples.'),
  ];
  FORMULA_SAMPLES.forEach((sample, index) => {
    const [width, height] = FORMULA_IMAGE_SIZE[index];
    children.push(heading(sample.title, HeadingLevel.HEADING_2));
    children.push(note(`Word should show ${sample.image}, as a picture. LaTeX: ${sample.latex}`));
    children.push(picture(FORMULA_IMAGES[index], width, height, sample.title, `formula-${sample.id}`));
  });
  return pack('S-09 equations off', [section('Equations off', children)]);
}

export async function buildRawWrapper(): Promise<Buffer> {
  const children: FileChild[] = [
    heading('Raw fromXmlString return value'),
    note('This file places the return value of ImportedXmlComponent.fromXmlString in the paragraph, which this docx version wraps in an element whose name is missing. Word may repair the file or refuse it. The equations to judge for FR-57 are in equations-on.docx, which uses the m:oMath child instead.'),
    ommlParagraph(FORMULA_SAMPLES[0].omml, true),
  ];
  return pack('S-09 raw wrapper', [section('Raw wrapper', children)]);
}

export async function buildAltText(): Promise<Buffer> {
  const children: FileChild[] = [
    heading('Image alt text'),
    note(`Select the red square. Word's Alt Text pane should show the description: ${ALT_DESCRIPTION}`),
    picture(swatch(RED, 'ALT'), SWATCH_DISPLAY[0], SWATCH_DISPLAY[1], ALT_DESCRIPTION, 'fr52-red-square'),
  ];
  return pack('S-09 alt text', [section('Alt text', children)]);
}

export async function buildHostile(): Promise<Buffer> {
  const square = swatch(RED, 'TEXT');
  const children: FileChild[] = [
    heading('Hostile text'),
    note('Body text, alt text, and link text below include a less-than sign, an ampersand, the characters ]]>, control characters, and unpaired surrogates. Word should open this file and show those as text, not as markup. The link target is a normal https address.'),
    heading('Body text', HeadingLevel.HEADING_2),
    body(`Markup: ${MARKUP}`),
    body(`Controls: ${CONTROLS}`),
    body(`Surrogates: ${SURROGATES}`),
    heading('Alt text', HeadingLevel.HEADING_2),
    note('Three squares. Their alt text is the markup, then the controls, then the surrogates. Open the Alt Text pane on each.'),
    picture(square, SWATCH_DISPLAY[0], SWATCH_DISPLAY[1], `ALT ${MARKUP}`, 'alt-markup'),
    picture(square, SWATCH_DISPLAY[0], SWATCH_DISPLAY[1], `ALT ${CONTROLS}`, 'alt-controls'),
    picture(square, SWATCH_DISPLAY[0], SWATCH_DISPLAY[1], `ALT ${SURROGATES}`, 'alt-surrogates'),
    heading('Link text', HeadingLevel.HEADING_2),
    note(`Each link points at ${LINK_URL}. The visible text is the hostile sample.`),
    linkParagraph(`Link ${MARKUP}`, LINK_URL),
    linkParagraph(`Link ${CONTROLS}`, LINK_URL),
    linkParagraph(`Link ${SURROGATES}`, LINK_URL),
  ];
  return pack('S-09 hostile text', [section('Hostile text', children)]);
}

export async function buildFiftyPages(): Promise<Buffer> {
  const children: FileChild[] = [
    heading('Fifty pages'),
    note('Word should show 50 pages. Each page has a heading with its page number. The header has a page field.'),
  ];
  const line = 'Fifty-page export sample. This sentence is body text so the page is not empty. ';
  for (let page = 1; page <= 50; page += 1) {
    if (page > 1) {
      children.push(new Paragraph({ children: [new PageBreak()] }));
    }
    children.push(heading(`Page ${page} of 50`, HeadingLevel.HEADING_2));
    children.push(body(line.repeat(4)));
  }
  return pack('S-09 fifty pages', [section('Fifty pages', children)]);
}

export async function buildSamples(): Promise<BuiltFile[]> {
  const files: Array<{ name: string; purpose: string; build: () => Promise<Buffer> }> = [
    {
      name: 'export-reference.docx',
      purpose: 'One sample for each Export reference row (FR-63).',
      build: buildExportReference,
    },
    {
      name: 'equations-on.docx',
      purpose: 'The six SRS formula samples as editable OMML equations (FR-57, AC-11).',
      build: buildEquationsOn,
    },
    {
      name: 'equations-off.docx',
      purpose: 'The same six samples as images (FR-56, AC-11).',
      build: buildEquationsOff,
    },
    {
      name: 'equations-raw-wrapper.docx',
      purpose: 'The fraction placed from the raw fromXmlString return value, which writes an undefined element.',
      build: buildRawWrapper,
    },
    {
      name: 'alt-text.docx',
      purpose: 'One image whose alt text should show in the Alt Text pane (FR-52).',
      build: buildAltText,
    },
    {
      name: 'hostile-text.docx',
      purpose: 'Markup, control characters, and unpaired surrogates in body text, alt text, and link text (H-26).',
      build: buildHostile,
    },
  ];
  const built: BuiltFile[] = [];
  for (const file of files) {
    built.push({ name: file.name, purpose: file.purpose, bytes: await file.build() });
  }
  return built;
}

export function samplesList(extra: readonly { name: string; purpose: string }[]): string {
  const lines = ['# S-09 sample files', ''];
  for (const file of extra) {
    lines.push(`- \`${file.name}\` — ${file.purpose}`);
  }
  lines.push('');
  return lines.join('\n');
}
