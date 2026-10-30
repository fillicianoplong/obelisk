import type { AttributeSpec } from 'prosemirror-model';

export const BLOCK_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const blockIdAttr: AttributeSpec = {
  default: '',
  validate: (value: unknown) => typeof value === 'string' && BLOCK_ID_PATTERN.test(value),
};

export const paragraphLayoutAttrs: Record<string, AttributeSpec> = {
  blockId: blockIdAttr,
  align: { default: 'left' },
  lineSpacing: { default: 'single' },
  spaceBefore: { default: 0 },
  spaceAfter: { default: 0 },
  indentLeft: { default: 0 },
  indentFirst: { default: 0 },
  indentHanging: { default: 0 },
};

export const headingAttrs: Record<string, AttributeSpec> = {
  blockId: blockIdAttr,
  level: { default: 1 },
};

export const listAttrs: Record<string, AttributeSpec> = {
  blockId: blockIdAttr,
};

export const listItemAttrs: Record<string, AttributeSpec> = {
  level: { default: 0 },
};

export const checklistItemAttrs: Record<string, AttributeSpec> = {
  level: { default: 0 },
  checked: { default: false },
};

export const foreignBlockAttrs: Record<string, AttributeSpec> = {
  blockId: blockIdAttr,
  blockType: { default: 'unknown' },
};
