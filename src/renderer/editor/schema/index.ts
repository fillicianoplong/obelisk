import { Schema } from 'prosemirror-model';
import { codeBlockSpec } from './code.js';
import { dividerSpec } from './divider.js';
import { foreignBlockSpec } from './foreign.js';
import { headingSpec } from './heading.js';
import { inlineSpecs } from './inline.js';
import { listNodeSpecs } from './lists.js';
import { pageBreakSpec } from './page-break.js';
import { paragraphSpec } from './paragraph.js';
import { quoteSpec } from './quote.js';
import { markSpecs } from './marks.js';

const blockTypes = [
  'paragraph',
  'heading',
  'bullet_list',
  'ordered_list',
  'checklist',
  'blockquote',
  'code_block',
  'horizontal_rule',
  'page_break',
  'foreign_block',
].join(' | ');

export const editorSchema = new Schema({
  nodes: {
    doc: {
      content: `(${blockTypes})+`,
    },
    paragraph: paragraphSpec,
    heading: headingSpec,
    ...listNodeSpecs,
    blockquote: quoteSpec,
    code_block: codeBlockSpec,
    horizontal_rule: dividerSpec,
    page_break: pageBreakSpec,
    foreign_block: foreignBlockSpec,
    ...inlineSpecs,
  },
  marks: markSpecs,
});

export type TextBlockKind =
  | 'paragraph'
  | 'heading'
  | 'bulleted-list'
  | 'numbered-list'
  | 'checklist'
  | 'quote'
  | 'code'
  | 'divider'
  | 'page-break';

export const TEXT_BLOCK_KINDS: readonly TextBlockKind[] = [
  'paragraph',
  'heading',
  'bulleted-list',
  'numbered-list',
  'checklist',
  'quote',
  'code',
  'divider',
  'page-break',
];
