import type { DocumentMessage, JsonObject } from '../../shared/ipc/types.js';
import { DEFAULT_FONT_SIZE_PT } from '../../shared/schema/limits.js';

/** Values from the MLA template reference in docs/SRS.md (FR-27). */
export const MLA_FONT = 'Liberation Serif';
export const MLA_FONT_SIZE_PT = DEFAULT_FONT_SIZE_PT;
export const MLA_LINE_SPACING = 'double' as const;
export const MLA_BODY_FIRST_INDENT_IN = 0.5;
export const MLA_WORKS_CITED_HANGING_IN = 0.5;
export const MLA_HEADER_NAME_PLACEHOLDER = 'Last Name ';
export const MLA_HEADING_PLACEHOLDERS = ['Name', 'Instructor', 'Course', 'Date'] as const;
export const MLA_TITLE_PLACEHOLDER = 'Title';
export const MLA_WORKS_CITED_TITLE = 'Works Cited';

type Mint = () => string;

function mlaMarks(): JsonObject {
  return { font: MLA_FONT, size: MLA_FONT_SIZE_PT };
}

function textRun(text: string): JsonObject {
  return { type: 'text', text, marks: mlaMarks() };
}

function paragraphFields(
  id: string,
  align: 'left' | 'center' | 'right',
  indents: { left: number; first: number; hanging: number },
): JsonObject {
  return {
    type: 'paragraph',
    id,
    align,
    spaceBefore: 0,
    spaceAfter: 0,
    indents,
    content: [] as JsonObject[],
  };
}

function headingParagraph(id: string, text: string): JsonObject {
  return {
    ...paragraphFields(id, 'left', { left: 0, first: 0, hanging: 0 }),
    content: [textRun(text)],
  };
}

function bodyParagraph(id: string, content: JsonObject[] = []): JsonObject {
  return {
    ...paragraphFields(id, 'left', { left: 0, first: MLA_BODY_FIRST_INDENT_IN, hanging: 0 }),
    content,
  };
}

function worksCitedEntry(id: string, content: JsonObject[] = []): JsonObject {
  return {
    ...paragraphFields(id, 'left', { left: 0, first: 0, hanging: MLA_WORKS_CITED_HANGING_IN }),
    content,
  };
}

function pageBreakBlock(id: string): JsonObject {
  return { type: 'pageBreak', id };
}

export function createMlaDocument(mint: Mint): {
  document: DocumentMessage;
  blockIds: string[];
} {
  const headerId = mint();
  const footerId = mint();
  const blocks: JsonObject[] = [];
  const blockIds: string[] = [];

  for (const label of MLA_HEADING_PLACEHOLDERS) {
    const id = mint();
    blocks.push(headingParagraph(id, label));
    blockIds.push(id);
  }

  const titleId = mint();
  blocks.push({
    ...paragraphFields(titleId, 'center', { left: 0, first: 0, hanging: 0 }),
    content: [textRun(MLA_TITLE_PLACEHOLDER)],
  });
  blockIds.push(titleId);

  const bodyId = mint();
  blocks.push(bodyParagraph(bodyId));
  blockIds.push(bodyId);

  const breakId = mint();
  blocks.push(pageBreakBlock(breakId));
  blockIds.push(breakId);

  const worksTitleId = mint();
  blocks.push({
    ...paragraphFields(worksTitleId, 'center', { left: 0, first: 0, hanging: 0 }),
    content: [textRun(MLA_WORKS_CITED_TITLE)],
  });
  blockIds.push(worksTitleId);

  const worksEntryId = mint();
  blocks.push(worksCitedEntry(worksEntryId));
  blockIds.push(worksEntryId);

  return {
    document: {
      view: 'pages',
      defaultLineSpacing: MLA_LINE_SPACING,
      page: {
        paper: 'letter',
        orientation: 'portrait',
        margins: { top: 1, right: 1, bottom: 1, left: 1 },
      },
      header: {
        id: headerId,
        align: 'right',
        lineSpacing: MLA_LINE_SPACING,
        spaceBefore: 0,
        spaceAfter: 0,
        indents: { left: 0, first: 0, hanging: 0 },
        content: [
          textRun(MLA_HEADER_NAME_PLACEHOLDER),
          { type: 'pageField', kind: 'page', format: 'decimal' },
        ],
      },
      footer: {
        id: footerId,
        align: 'left',
        lineSpacing: MLA_LINE_SPACING,
        spaceBefore: 0,
        spaceAfter: 0,
        indents: { left: 0, first: 0, hanging: 0 },
        content: [],
      },
      blocks,
    },
    blockIds,
  };
}