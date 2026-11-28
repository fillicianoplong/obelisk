import {
  ALIGNMENTS,
  INDENT_FIRST_MAX_IN,
  INDENT_GRID_IN,
  INDENT_HANGING_MAX_IN,
  INDENT_LEFT_MAX_IN,
  INDENT_LEFT_MIN_IN,
  INDENT_RIGHT_MAX_IN,
  LINE_SPACING_RULES,
  SPACE_BEFORE_AFTER_PT,
} from '../../../shared/schema/limits.js';
import {
  documentDefaultParagraphFormat,
  paragraphFormatFromBlock,
  type ParagraphFormatValue,
  type SpacePt,
} from '../../../shared/schema/paragraph-defaults.js';
import {
  defaultLineSpacingAt,
  effectiveLineSpacingAt,
  effectiveLineSpacingRule,
  isLineSpacingRule,
  lineSpacingRuleNeedsAt,
  snapLineSpacingAt,
  type LineSpacingRule,
} from '../../../shared/schema/line-spacing.js';
import type { DocumentMessage } from '../../../shared/ipc/types.js';
import type { EditorState } from 'prosemirror-state';
import { selectedBlockCount } from '../../editor/block-handle-plugin.js';

export type ParagraphApplyScope = 'document' | 'selection';

export type ParagraphAlign = (typeof ALIGNMENTS)[number];

export type SpecialIndent = 'none' | 'first' | 'hanging';

export interface ParagraphDialogValue {
  align: ParagraphAlign;
  indentLeft: number;
  indentRight: number;
  specialIndent: SpecialIndent;
  specialBy: number;
  lineSpacing: LineSpacingRule;
  lineSpacingAt: number;
  spaceBefore: SpacePt;
  spaceAfter: SpacePt;
  dontAddSpaceBetweenSameStyle: boolean;
  scope: ParagraphApplyScope;
}

export const ALIGN_OPTIONS = ALIGNMENTS.map((id) => ({
  id,
  label: id.charAt(0).toUpperCase() + id.slice(1),
}));

const LINE_SPACING_LABELS: Record<LineSpacingRule, string> = {
  single: 'Single',
  '1.15': '1.15',
  '1.25': '1.25',
  '1.5': '1.5',
  double: 'Double',
  atLeast: 'At least',
  exactly: 'Exactly',
  multiple: 'Multiple',
};

export const LINE_SPACING_OPTIONS = LINE_SPACING_RULES.map((id) => ({
  id,
  label: LINE_SPACING_LABELS[id],
}));

export const SPECIAL_INDENT_OPTIONS: readonly { id: SpecialIndent; label: string }[] = [
  { id: 'none', label: '(none)' },
  { id: 'first', label: 'First line' },
  { id: 'hanging', label: 'Hanging' },
];

export function snapIndentInches(value: number, max: number, min = INDENT_LEFT_MIN_IN): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  const snapped = Math.round(value / INDENT_GRID_IN) * INDENT_GRID_IN;
  const clamped = Math.min(max, Math.max(min, snapped));
  return Math.round(clamped * 1000) / 1000;
}

export function snapSpacePt(value: number): SpacePt {
  const rounded = Math.round(value / 6) * 6;
  const clamped = Math.min(24, Math.max(0, rounded));
  return ((SPACE_BEFORE_AFTER_PT as readonly number[]).includes(clamped) ? clamped : 0) as SpacePt;
}

export function specialIndentFromFields(first: number, hanging: number): { specialIndent: SpecialIndent; specialBy: number } {
  if (hanging > 0) {
    return { specialIndent: 'hanging', specialBy: hanging };
  }
  if (first > 0) {
    return { specialIndent: 'first', specialBy: first };
  }
  return { specialIndent: 'none', specialBy: 0 };
}

export function indentsFromSpecial(
  specialIndent: SpecialIndent,
  specialBy: number,
): { indentFirst: number; indentHanging: number } {
  const max = specialIndent === 'hanging' ? INDENT_HANGING_MAX_IN : INDENT_FIRST_MAX_IN;
  const by = snapIndentInches(specialBy, max);
  if (specialIndent === 'first') {
    return { indentFirst: by, indentHanging: 0 };
  }
  if (specialIndent === 'hanging') {
    return { indentFirst: 0, indentHanging: by };
  }
  return { indentFirst: 0, indentHanging: 0 };
}

function caretParagraphAttrs(editorState: EditorState | null): Record<string, unknown> {
  const { $from } = editorState?.selection ?? { $from: null };
  if ($from === null) {
    return {};
  }
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.name === 'paragraph') {
      return { ...node.attrs };
    }
  }
  return {};
}

export function paragraphDialogValueToFormat(value: ParagraphDialogValue): ParagraphFormatValue {
  const { indentFirst, indentHanging } = indentsFromSpecial(value.specialIndent, value.specialBy);
  const lineSpacingAt = lineSpacingRuleNeedsAt(value.lineSpacing)
    ? snapLineSpacingAt(value.lineSpacing, value.lineSpacingAt)
    : null;
  return {
    align: value.align,
    lineSpacing: value.lineSpacing,
    lineSpacingAt,
    spaceBefore: value.spaceBefore,
    spaceAfter: value.spaceAfter,
    indents: {
      left: value.indentLeft,
      right: value.indentRight,
      first: indentFirst,
      hanging: indentHanging,
    },
    dontAddSpaceBetweenSameStyle: value.dontAddSpaceBetweenSameStyle,
  };
}

export function paragraphDialogInitial(
  document: DocumentMessage,
  editorState: EditorState | null,
): ParagraphDialogValue {
  const attrs = caretParagraphAttrs(editorState);
  const hasCaret = editorState !== null && Object.keys(attrs).length > 0;
  const blockFormat = hasCaret
    ? paragraphFormatFromBlock({
      align: attrs.align,
      lineSpacing: attrs.lineSpacing,
      lineSpacingAt: attrs.lineSpacingAt,
      spaceBefore: attrs.spaceBefore,
      spaceAfter: attrs.spaceAfter,
      indents: {
        left: attrs.indentLeft,
        right: attrs.indentRight,
        first: attrs.indentFirst,
        hanging: attrs.indentHanging,
      },
      dontAddSpaceBetweenSameStyle: attrs.dontAddSpaceBetweenSameStyle,
    }, document)
    : documentDefaultParagraphFormat(document);
  const lineSpacing = effectiveLineSpacingRule(attrs.lineSpacing, document);
  const lineSpacingAt = effectiveLineSpacingAt(attrs.lineSpacing, attrs.lineSpacingAt, document)
    ?? defaultLineSpacingAt(lineSpacing);
  const { specialIndent, specialBy } = specialIndentFromFields(
    blockFormat.indents.first,
    blockFormat.indents.hanging,
  );
  const multiBlock = editorState !== null && selectedBlockCount(editorState) > 1;
  const scope: ParagraphApplyScope = multiBlock ? 'selection' : 'document';
  return {
    align: blockFormat.align,
    indentLeft: snapIndentInches(blockFormat.indents.left, INDENT_LEFT_MAX_IN),
    indentRight: snapIndentInches(blockFormat.indents.right, INDENT_RIGHT_MAX_IN),
    specialIndent,
    specialBy,
    lineSpacing: isLineSpacingRule(lineSpacing) ? lineSpacing : 'single',
    lineSpacingAt,
    spaceBefore: blockFormat.spaceBefore,
    spaceAfter: blockFormat.spaceAfter,
    dontAddSpaceBetweenSameStyle: blockFormat.dontAddSpaceBetweenSameStyle,
    scope,
  };
}

export function selectionHasParagraph(editorState: EditorState | null): boolean {
  if (editorState === null) {
    return false;
  }
  if (!editorState.selection.empty) {
    let found = false;
    const { $from, $to } = editorState.selection;
    editorState.doc.nodesBetween($from.pos, $to.pos, (node) => {
      if (node.type.name === 'paragraph') {
        found = true;
      }
    });
    return found;
  }
  for (let depth = editorState.selection.$from.depth; depth > 0; depth -= 1) {
    if (editorState.selection.$from.node(depth).type.name === 'paragraph') {
      return true;
    }
  }
  return false;
}

export function lineSpacingAtSuffix(rule: LineSpacingRule): string {
  if (rule === 'multiple') {
    return '×';
  }
  if (rule === 'atLeast' || rule === 'exactly') {
    return 'pt';
  }
  return '';
}