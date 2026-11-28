import {
  LINE_SPACING_ADVANCED,
  LINE_SPACINGS,
  LINE_SPACING_MULTIPLE_MAX,
  LINE_SPACING_MULTIPLE_MIN,
  LINE_SPACING_PT_MAX,
  LINE_SPACING_PT_MIN,
  LINE_SPACING_RULES,
} from './limits.js';

export type LineSpacingPreset = (typeof LINE_SPACINGS)[number];
export type LineSpacingAdvanced = (typeof LINE_SPACING_ADVANCED)[number];
export type LineSpacingRule = (typeof LINE_SPACING_RULES)[number];
/** @deprecated Use LineSpacingRule for new code. */
export type LineSpacing = LineSpacingPreset;

export function isLineSpacingPreset(value: unknown): value is LineSpacingPreset {
  return typeof value === 'string' && (LINE_SPACINGS as readonly string[]).includes(value);
}

export function isLineSpacingAdvanced(value: unknown): value is LineSpacingAdvanced {
  return typeof value === 'string' && (LINE_SPACING_ADVANCED as readonly string[]).includes(value);
}

export function isLineSpacingRule(value: unknown): value is LineSpacingRule {
  return typeof value === 'string' && (LINE_SPACING_RULES as readonly string[]).includes(value);
}

/** Legacy helper: preset line spacing only. */
export function isLineSpacing(value: unknown): value is LineSpacingPreset {
  return isLineSpacingPreset(value);
}

export function lineSpacingRuleNeedsAt(rule: LineSpacingRule): boolean {
  return isLineSpacingAdvanced(rule);
}

export function snapLineSpacingAt(rule: LineSpacingRule, raw: number): number {
  if (!Number.isFinite(raw)) {
    return rule === 'multiple' ? 1 : 12;
  }
  if (rule === 'multiple') {
    const snapped = Math.round(raw / 0.05) * 0.05;
    return Math.min(LINE_SPACING_MULTIPLE_MAX, Math.max(LINE_SPACING_MULTIPLE_MIN, snapped));
  }
  if (rule === 'atLeast' || rule === 'exactly') {
    const snapped = Math.round(raw);
    return Math.min(LINE_SPACING_PT_MAX, Math.max(LINE_SPACING_PT_MIN, snapped));
  }
  return raw;
}

export function defaultLineSpacingAt(rule: LineSpacingRule): number {
  if (rule === 'multiple') {
    return 1.15;
  }
  if (rule === 'atLeast' || rule === 'exactly') {
    return 12;
  }
  return 0;
}

export interface LineSpacingSource {
  defaultLineSpacing?: unknown;
  defaultParagraph?: {
    lineSpacing?: unknown;
    lineSpacingAt?: unknown;
  };
}

export function documentDefaultLineSpacingRule(document: LineSpacingSource): LineSpacingRule {
  const fromParagraph = document.defaultParagraph?.lineSpacing;
  if (isLineSpacingRule(fromParagraph)) {
    return fromParagraph;
  }
  if (isLineSpacingPreset(document.defaultLineSpacing)) {
    return document.defaultLineSpacing;
  }
  return 'single';
}

export function documentDefaultLineSpacingAt(document: LineSpacingSource): number | null {
  const rule = documentDefaultLineSpacingRule(document);
  if (!lineSpacingRuleNeedsAt(rule)) {
    return null;
  }
  const raw = document.defaultParagraph?.lineSpacingAt;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return snapLineSpacingAt(rule, raw);
  }
  return defaultLineSpacingAt(rule);
}

/** Legacy helper. */
export function documentDefaultLineSpacing(document: LineSpacingSource): LineSpacingPreset {
  const rule = documentDefaultLineSpacingRule(document);
  return isLineSpacingPreset(rule) ? rule : 'single';
}

export function effectiveLineSpacingRule(
  blockOverride: unknown,
  document: LineSpacingSource,
): LineSpacingRule {
  if (isLineSpacingRule(blockOverride)) {
    return blockOverride;
  }
  return documentDefaultLineSpacingRule(document);
}

export function effectiveLineSpacingAt(
  blockRule: unknown,
  blockAt: unknown,
  document: LineSpacingSource,
): number | null {
  const rule = effectiveLineSpacingRule(blockRule, document);
  if (!lineSpacingRuleNeedsAt(rule)) {
    return null;
  }
  if (isLineSpacingRule(blockRule) && typeof blockAt === 'number') {
    return snapLineSpacingAt(rule, blockAt);
  }
  return documentDefaultLineSpacingAt(document);
}

/** Legacy helper. */
export function effectiveLineSpacing(
  blockOverride: unknown,
  document: LineSpacingSource,
): LineSpacingPreset {
  const rule = effectiveLineSpacingRule(blockOverride, document);
  return isLineSpacingPreset(rule) ? rule : 'single';
}