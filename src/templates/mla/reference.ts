import type { DocumentMessage, JsonObject } from '../../shared/ipc/types.js';
import {
  MLA_BODY_FIRST_INDENT_IN,
  MLA_FONT,
  MLA_FONT_SIZE_PT,
  MLA_HEADER_NAME_PLACEHOLDER,
  MLA_HEADING_PLACEHOLDERS,
  MLA_LINE_SPACING,
  MLA_TITLE_PLACEHOLDER,
  MLA_WORKS_CITED_HANGING_IN,
  MLA_WORKS_CITED_TITLE,
} from './document.js';

export interface MlaReferenceRow {
  setting: string;
  expected: string;
}

/** Rows from the MLA template reference in docs/SRS.md (FR-27, AC-09). */
export const MLA_TEMPLATE_REFERENCE: readonly MlaReferenceRow[] = [
  { setting: 'Margins', expected: '1 in on all sides' },
  { setting: 'Font', expected: 'Liberation Serif, 12 pt' },
  { setting: 'Line spacing', expected: 'Double, everywhere, with no extra space before or after' },
  { setting: 'Header', expected: 'Right-aligned: last name, a space, and the page number' },
  { setting: 'Heading lines', expected: 'Four left-aligned placeholder lines: name, instructor, course, date' },
  { setting: 'Title', expected: 'Centered placeholder line, no bold or underline' },
  { setting: 'Body', expected: 'First-line indent 0.5 in' },
  { setting: 'Works Cited', expected: 'New page, centered title, hanging indent 0.5 in' },
];

export interface MlaInspectionIssue {
  area: 'margins' | 'font' | 'lineSpacing' | 'header' | 'headingLines' | 'title' | 'body' | 'worksCited';
  message: string;
}

function paragraphBlocks(document: DocumentMessage): JsonObject[] {
  return document.blocks.filter((block) => block.type === 'paragraph') as JsonObject[];
}

function runMarks(run: JsonObject): JsonObject | undefined {
  return typeof run.marks === 'object' && run.marks !== null ? (run.marks as JsonObject) : undefined;
}

function assertFontOnRuns(runs: JsonObject[], issues: MlaInspectionIssue[], area: MlaInspectionIssue['area']): void {
  for (const run of runs) {
    if (run.type !== 'text') {
      continue;
    }
    const marks = runMarks(run);
    if (marks?.font !== MLA_FONT) {
      issues.push({ area: 'font', message: `${area}: expected font ${MLA_FONT}, got ${String(marks?.font)}` });
    }
    if (marks?.size !== MLA_FONT_SIZE_PT) {
      issues.push({ area: 'font', message: `${area}: expected ${MLA_FONT_SIZE_PT} pt, got ${String(marks?.size)}` });
    }
    if (marks?.bold === true || marks?.underline === true) {
      issues.push({ area: 'font', message: `${area}: bold or underline on template placeholder text` });
    }
  }
}

function assertParagraphSpacing(block: JsonObject, issues: MlaInspectionIssue[], area: MlaInspectionIssue['area']): void {
  if (block.lineSpacing !== MLA_LINE_SPACING) {
    issues.push({
      area: 'lineSpacing',
      message: `${area}: expected line spacing ${MLA_LINE_SPACING}, got ${String(block.lineSpacing)}`,
    });
  }
  if (block.spaceBefore !== 0 || block.spaceAfter !== 0) {
    issues.push({
      area: 'lineSpacing',
      message: `${area}: expected no space before or after, got ${block.spaceBefore}/${block.spaceAfter}`,
    });
  }
}

/** Inspection helper for AC-09: compare a document to the MLA template reference. */
export function inspectMlaDocument(document: DocumentMessage): MlaInspectionIssue[] {
  const issues: MlaInspectionIssue[] = [];

  const margins = document.page.margins as JsonObject | undefined;
  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    if (margins?.[side] !== 1) {
      issues.push({ area: 'margins', message: `margin ${side} expected 1 in, got ${String(margins?.[side])}` });
    }
  }
  if (document.view !== 'pages') {
    issues.push({ area: 'margins', message: `view expected pages, got ${String(document.view)}` });
  }

  const header = document.header as JsonObject;
  if (header.align !== 'right') {
    issues.push({ area: 'header', message: `header align expected right, got ${String(header.align)}` });
  }
  assertParagraphSpacing(header, issues, 'header');
  const headerRuns = Array.isArray(header.content) ? (header.content as JsonObject[]) : [];
  if (headerRuns.length < 2
    || headerRuns[0].type !== 'text'
    || headerRuns[0].text !== MLA_HEADER_NAME_PLACEHOLDER
    || headerRuns[1].type !== 'pageField'
    || headerRuns[1].kind !== 'page'
    || headerRuns[1].format !== 'decimal') {
    issues.push({ area: 'header', message: 'header must be last name, space, and decimal page number field' });
  }
  assertFontOnRuns(headerRuns, issues, 'header');

  const footer = document.footer as JsonObject;
  assertParagraphSpacing(footer, issues, 'lineSpacing');

  const paragraphs = paragraphBlocks(document);
  if (paragraphs.length < 8) {
    issues.push({ area: 'headingLines', message: `expected at least 8 paragraphs, got ${paragraphs.length}` });
    return issues;
  }

  for (let index = 0; index < 4; index += 1) {
    const block = paragraphs[index];
    if (block.align !== 'left') {
      issues.push({ area: 'headingLines', message: `heading line ${index + 1} must be left-aligned` });
    }
    assertParagraphSpacing(block, issues, 'headingLines');
    const content = Array.isArray(block.content) ? (block.content as JsonObject[]) : [];
    const text = content[0]?.type === 'text' ? content[0].text : '';
    const expected = MLA_HEADING_PLACEHOLDERS[index];
    if (text !== expected) {
      issues.push({ area: 'headingLines', message: `heading line ${index + 1} expected ${expected}, got ${text}` });
    }
    assertFontOnRuns(content, issues, 'headingLines');
  }

  const title = paragraphs[4];
  if (title.align !== 'center') {
    issues.push({ area: 'title', message: 'title must be centered' });
  }
  assertParagraphSpacing(title, issues, 'title');
  const titleRuns = Array.isArray(title.content) ? (title.content as JsonObject[]) : [];
  if (titleRuns[0]?.text !== MLA_TITLE_PLACEHOLDER) {
    issues.push({ area: 'title', message: `title placeholder expected ${MLA_TITLE_PLACEHOLDER}` });
  }
  assertFontOnRuns(titleRuns, issues, 'title');

  const body = paragraphs[5];
  assertParagraphSpacing(body, issues, 'body');
  const bodyIndents = body.indents as JsonObject;
  if (bodyIndents?.first !== MLA_BODY_FIRST_INDENT_IN) {
    issues.push({
      area: 'body',
      message: `body first-line indent expected ${MLA_BODY_FIRST_INDENT_IN} in, got ${String(bodyIndents?.first)}`,
    });
  }

  const breakIndex = document.blocks.findIndex((block) => block.type === 'pageBreak');
  if (breakIndex < 0) {
    issues.push({ area: 'worksCited', message: 'Works Cited must start on a new page (page break)' });
  }

  const worksTitle = paragraphs[6];
  if (worksTitle.align !== 'center') {
    issues.push({ area: 'worksCited', message: 'Works Cited title must be centered' });
  }
  const worksTitleRuns = Array.isArray(worksTitle.content) ? (worksTitle.content as JsonObject[]) : [];
  if (worksTitleRuns[0]?.text !== MLA_WORKS_CITED_TITLE) {
    issues.push({ area: 'worksCited', message: `Works Cited title expected ${MLA_WORKS_CITED_TITLE}` });
  }

  const worksEntry = paragraphs[7];
  const hanging = (worksEntry.indents as JsonObject)?.hanging;
  if (hanging !== MLA_WORKS_CITED_HANGING_IN) {
    issues.push({
      area: 'worksCited',
      message: `Works Cited entry hanging indent expected ${MLA_WORKS_CITED_HANGING_IN} in, got ${String(hanging)}`,
    });
  }
  assertParagraphSpacing(worksEntry, issues, 'worksCited');

  return issues;
}

export function mlaDocumentMatchesReference(document: DocumentMessage): boolean {
  return inspectMlaDocument(document).length === 0;
}