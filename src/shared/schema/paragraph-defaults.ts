import type { DocumentMessage } from '../ipc/types.js';
import { ALIGNMENTS, SPACE_BEFORE_AFTER_PT } from './limits.js';
import {
  defaultLineSpacingAt,
  documentDefaultLineSpacingAt,
  documentDefaultLineSpacingRule,
  effectiveLineSpacingAt,
  effectiveLineSpacingRule,
  isLineSpacingRule,
  lineSpacingRuleNeedsAt,
  snapLineSpacingAt,
  type LineSpacingRule,
} from './line-spacing.js';

export type SpacePt = (typeof SPACE_BEFORE_AFTER_PT)[number];
export type ParagraphAlign = (typeof ALIGNMENTS)[number];

export interface ParagraphIndents {
  left: number;
  right: number;
  first: number;
  hanging: number;
}

export interface ParagraphFormatValue {
  align: ParagraphAlign;
  lineSpacing: LineSpacingRule;
  lineSpacingAt: number | null;
  spaceBefore: SpacePt;
  spaceAfter: SpacePt;
  indents: ParagraphIndents;
  dontAddSpaceBetweenSameStyle: boolean;
}

export interface DefaultParagraphFormat {
  align?: ParagraphAlign;
  lineSpacing?: LineSpacingRule;
  lineSpacingAt?: number;
  spaceBefore?: SpacePt;
  spaceAfter?: SpacePt;
  indents?: Partial<ParagraphIndents>;
  dontAddSpaceBetweenSameStyle?: boolean;
}

function spacePt(value: unknown): SpacePt {
  const n = Number(value ?? 0);
  return (SPACE_BEFORE_AFTER_PT as readonly number[]).includes(n) ? n as SpacePt : 0;
}

function alignValue(value: unknown): ParagraphAlign {
  return typeof value === 'string' && (ALIGNMENTS as readonly string[]).includes(value)
    ? value as ParagraphAlign
    : 'left';
}

export function normalizeIndents(raw: unknown): ParagraphIndents {
  const record = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  return {
    left: Number(record.left ?? 0) || 0,
    right: Number(record.right ?? 0) || 0,
    first: Number(record.first ?? 0) || 0,
    hanging: Number(record.hanging ?? 0) || 0,
  };
}

export function documentDefaultParagraphFormat(document: DocumentMessage): ParagraphFormatValue {
  const def = (document.defaultParagraph && typeof document.defaultParagraph === 'object'
    ? document.defaultParagraph
    : {}) as Record<string, unknown>;
  const rule = documentDefaultLineSpacingRule(document);
  const lineSpacingAt = documentDefaultLineSpacingAt(document);
  return {
    align: alignValue(def.align),
    lineSpacing: rule,
    lineSpacingAt,
    spaceBefore: spacePt(def.spaceBefore),
    spaceAfter: spacePt(def.spaceAfter),
    indents: normalizeIndents(def.indents),
    dontAddSpaceBetweenSameStyle: def.dontAddSpaceBetweenSameStyle === true,
  };
}

export function paragraphFormatFromBlock(block: Record<string, unknown>, document: DocumentMessage): ParagraphFormatValue {
  const defaults = documentDefaultParagraphFormat(document);
  const rule = effectiveLineSpacingRule(block.lineSpacing, document);
  const lineSpacingAt = effectiveLineSpacingAt(block.lineSpacing, block.lineSpacingAt, document);
  const collapse = block.dontAddSpaceBetweenSameStyle;
  return {
    align: alignValue(block.align ?? defaults.align),
    lineSpacing: rule,
    lineSpacingAt,
    spaceBefore: spacePt(block.spaceBefore ?? defaults.spaceBefore),
    spaceAfter: spacePt(block.spaceAfter ?? defaults.spaceAfter),
    indents: {
      ...defaults.indents,
      ...normalizeIndents(block.indents),
    },
    dontAddSpaceBetweenSameStyle: collapse === true
      || (collapse !== false && defaults.dontAddSpaceBetweenSameStyle),
  };
}

export function paragraphStyleFingerprint(format: ParagraphFormatValue): string {
  return JSON.stringify({
    align: format.align,
    lineSpacing: format.lineSpacing,
    lineSpacingAt: format.lineSpacingAt,
    indents: format.indents,
  });
}

export function formatToDefaultParagraph(format: ParagraphFormatValue): DefaultParagraphFormat {
  const lineSpacing = format.lineSpacing;
  const next: DefaultParagraphFormat = {
    align: format.align,
    lineSpacing,
    spaceBefore: format.spaceBefore,
    spaceAfter: format.spaceAfter,
    indents: format.indents,
    dontAddSpaceBetweenSameStyle: format.dontAddSpaceBetweenSameStyle,
  };
  if (lineSpacingRuleNeedsAt(lineSpacing)) {
    next.lineSpacingAt = format.lineSpacingAt ?? defaultLineSpacingAt(lineSpacing);
  }
  return next;
}

export function defaultParagraphFromDialogValue(value: ParagraphFormatValue): DocumentMessage['defaultParagraph'] {
  return formatToDefaultParagraph(value) as unknown as DocumentMessage['defaultParagraph'];
}

export function isDefaultParagraphEqual(
  left: DefaultParagraphFormat | undefined,
  right: DefaultParagraphFormat,
): boolean {
  return JSON.stringify(left ?? {}) === JSON.stringify(right);
}

export function sanitizeLineSpacingAt(rule: LineSpacingRule, at: number | null): number | undefined {
  if (!lineSpacingRuleNeedsAt(rule)) {
    return undefined;
  }
  const snapped = snapLineSpacingAt(rule, at ?? defaultLineSpacingAt(rule));
  return snapped;
}

export function isPresetLineSpacing(rule: unknown): rule is LineSpacingRule {
  return isLineSpacingRule(rule);
}