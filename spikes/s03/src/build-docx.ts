import {
  AlignmentType,
  Document,
  ImportedXmlComponent,
  Packer,
  Paragraph,
  TextRun,
} from 'docx';

const letterWidth = 12240;
const letterHeight = 15840;
const inch = 1440;
const headerDistance = 720;

interface XmlView {
  rootKey: string | undefined;
  root: unknown[];
}

export interface InsertedMath {
  math: ImportedXmlComponent;
  // The name fromXmlString itself would write. docx 9.14.0 leaves this undefined.
  returnedRootKey: string | undefined;
}

export function insertedMath(omml: string): InsertedMath {
  const parsed = ImportedXmlComponent.fromXmlString(omml);
  const view = parsed as unknown as XmlView;
  const elements = view.root.filter((child): child is ImportedXmlComponent => child instanceof ImportedXmlComponent);
  if (view.rootKey === 'm:oMath') {
    return { math: parsed, returnedRootKey: view.rootKey };
  }
  const inner = elements[0];
  const innerKey = inner ? (inner as unknown as XmlView).rootKey : undefined;
  if (elements.length === 1 && inner && innerKey === 'm:oMath') {
    return { math: inner, returnedRootKey: view.rootKey };
  }
  throw new Error(
    `fromXmlString returned ${String(view.rootKey)} with ${elements.length} elements, first ${String(innerKey)}`,
  );
}

export function rawFromXmlString(omml: string): ImportedXmlComponent {
  return ImportedXmlComponent.fromXmlString(omml);
}

class MathParagraph extends Paragraph {
  constructor(math: ImportedXmlComponent, options: { lead?: string; center?: boolean }) {
    super({
      alignment: options.center ? AlignmentType.CENTER : undefined,
      children: options.lead ? [new TextRun(options.lead)] : [],
    });
    this.root.push(math);
  }
}

export function naiveParagraphs(omml: string): Paragraph[] {
  return [
    new Paragraph({
      children: [
        new TextRun(
          'This file is the fraction inserted as the return value of ImportedXmlComponent.fromXmlString(), with no unwrapping.',
        ),
      ],
    }),
    new MathParagraph(rawFromXmlString(omml), { center: true }),
  ];
}

export function equationParagraphs(caption: string, display: ImportedXmlComponent, inline: ImportedXmlComponent): Paragraph[] {
  return [
    new Paragraph({ children: [new TextRun(caption)] }),
    new MathParagraph(display, { center: true }),
    new MathParagraph(inline, { lead: 'Inline: ' }),
    new Paragraph({}),
  ];
}

export async function packDocument(children: readonly Paragraph[]): Promise<Buffer> {
  const document = new Document({
    sections: [
      {
        properties: {
          page: {
            size: { width: letterWidth, height: letterHeight },
            margin: {
              top: inch,
              right: inch,
              bottom: inch,
              left: inch,
              header: headerDistance,
              footer: headerDistance,
            },
          },
        },
        children: [...children],
      },
    ],
  });
  return Packer.toBuffer(document);
}
