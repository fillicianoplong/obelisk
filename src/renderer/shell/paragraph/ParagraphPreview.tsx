import { indentsFromSpecial, type ParagraphDialogValue } from './model.js';
import { lineSpacingRuleNeedsAt, snapLineSpacingAt } from '../../../shared/schema/line-spacing.js';

interface ParagraphPreviewProps {
  value: ParagraphDialogValue;
}

function paragraphAttrs(value: ParagraphDialogValue, variant: 'sample' | 'muted'): Record<string, string> {
  if (variant === 'muted') {
    return {
      'data-align': 'left',
      'data-indent-left': '0',
      'data-indent-right': '0',
      'data-indent-first': '0',
      'data-indent-hanging': '0',
      'data-space-before': '0',
      'data-space-after': '6',
      'data-effective-space-before': '0',
      'data-effective-space-after': '6',
    };
  }
  const { indentFirst, indentHanging } = indentsFromSpecial(value.specialIndent, value.specialBy);
  const lineSpacingAt = lineSpacingRuleNeedsAt(value.lineSpacing)
    ? snapLineSpacingAt(value.lineSpacing, value.lineSpacingAt)
    : null;
  const attrs: Record<string, string> = {
    'data-align': value.align,
    'data-indent-left': String(value.indentLeft),
    'data-indent-right': String(value.indentRight),
    'data-indent-first': String(indentFirst),
    'data-indent-hanging': String(indentHanging),
    'data-space-before': String(value.spaceBefore),
    'data-space-after': String(value.spaceAfter),
    'data-effective-space-before': String(value.spaceBefore),
    'data-effective-space-after': String(value.spaceAfter),
    'data-line-spacing': value.lineSpacing,
  };
  if (lineSpacingAt !== null) {
    attrs['data-line-spacing-at'] = String(lineSpacingAt);
  }
  if (value.dontAddSpaceBetweenSameStyle) {
    attrs['data-collapse-same-style'] = 'true';
  }
  return attrs;
}

export function ParagraphPreview({ value }: ParagraphPreviewProps) {
  const sampleAttrs = paragraphAttrs(value, 'sample');
  const sheetAttrs: Record<string, string> = {
    'data-default-line-spacing': value.lineSpacing,
  };
  if (lineSpacingRuleNeedsAt(value.lineSpacing)) {
    sheetAttrs['data-default-line-spacing-at'] = String(snapLineSpacingAt(value.lineSpacing, value.lineSpacingAt));
  }
  return (
    <div
      className="paragraph-dialog-preview-sheet page-sheet"
      {...sheetAttrs}
      aria-hidden="true"
    >
      <p className="paragraph-dialog-preview-muted" {...paragraphAttrs(value, 'muted')}>
        Previous paragraphs use normal spacing in the actual document.
      </p>
      <p className="paragraph-dialog-preview-muted" {...paragraphAttrs(value, 'muted')}>
        A second line shows where this block sits.
      </p>
      <p className="paragraph-dialog-preview-sample" {...sampleAttrs}>
        The quick brown fox jumps over the lazy dog. This sample wraps across several lines so
        first-line, hanging, left and right indents, and line spacing are easy to see in the preview.
      </p>
      <p className="paragraph-dialog-preview-muted" {...paragraphAttrs(value, 'muted')}>
        Following text continues below with ordinary grey styling.
      </p>
    </div>
  );
}