import { splitBlockAs } from 'prosemirror-commands';
import type { Node as ProseNode } from 'prosemirror-model';
import type { Command, EditorState, Transaction } from 'prosemirror-state';
import { INDENT_FIRST_MAX_IN } from '../../shared/schema/limits.js';
import {
  isLineSpacingRule,
  lineSpacingRuleNeedsAt,
  type LineSpacingRule,
} from '../../shared/schema/line-spacing.js';
import {
  ALIGNMENTS,
  INDENT_LEFT_MAX_IN,
  INDENT_LEFT_MIN_IN,
  LINE_SPACINGS,
  SPACE_BEFORE_AFTER_PT,
  alignmentFromMenuId,
  firstLineIndentFromMenuId,
  hangingIndentFromMenuId,
  leftIndentFromMenuId,
  lineSpacingFromMenuId,
  spaceAfterFromMenuId,
  spaceBeforeFromMenuId,
  stepIndentInches,
  INDENT_STEP_IN,
} from './format/reference.js';
import { newBlockId } from './block-id.js';
import { markCloseHistoryGroup } from './history/groups.js';

type Align = (typeof ALIGNMENTS)[number];
type LineSpacing = (typeof LINE_SPACINGS)[number];
type DialogLineSpacing = LineSpacingRule;
type SpacePt = (typeof SPACE_BEFORE_AFTER_PT)[number];

function applyCommand(state: EditorState, command: Command): EditorState | null {
  let next: EditorState | null = null;
  const applied = command(state, (tr) => {
    next = state.apply(tr);
  });
  if (!applied || next === null) {
    return null;
  }
  return next;
}

function paragraphDepth($pos: { depth: number; node: (depth: number) => ProseNode }): number | null {
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    if ($pos.node(depth).type.name === 'paragraph') {
      return depth;
    }
  }
  return null;
}

function updateParagraphAttrs(
  tr: Transaction,
  pos: number,
  node: ProseNode,
  attrs: Record<string, unknown>,
): void {
  tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs });
}

function setParagraphFieldsCommand(fields: Record<string, unknown>): Command {
  return (state, dispatch) => {
    const { $from, $to } = state.selection;
    const tr = state.tr;
    let changed = false;
    const seen = new Set<number>();
    state.doc.nodesBetween($from.pos, $to.pos, (node, pos) => {
      if (node.type.name !== 'paragraph' || seen.has(pos)) {
        return;
      }
      seen.add(pos);
      const nextAttrs: Record<string, unknown> = { ...fields };
      if (typeof nextAttrs.indentFirst === 'number' && nextAttrs.indentFirst > 0) {
        nextAttrs.indentHanging = 0;
      }
      if (typeof nextAttrs.indentHanging === 'number' && nextAttrs.indentHanging > 0) {
        nextAttrs.indentFirst = 0;
      }
      updateParagraphAttrs(tr, pos, node, nextAttrs);
      changed = true;
    });
    if (!changed) {
      const depth = paragraphDepth($from);
      if (depth === null) {
        return false;
      }
      const node = $from.node(depth);
      const pos = $from.before(depth);
      const nextAttrs: Record<string, unknown> = { ...fields };
      if (typeof nextAttrs.indentFirst === 'number' && nextAttrs.indentFirst > 0) {
        nextAttrs.indentHanging = 0;
      }
      if (typeof nextAttrs.indentHanging === 'number' && nextAttrs.indentHanging > 0) {
        nextAttrs.indentFirst = 0;
      }
      updateParagraphAttrs(tr, pos, node, nextAttrs);
      changed = true;
    }
    if (!changed) {
      return false;
    }
    if (dispatch) {
      dispatch(tr);
    }
    return true;
  };
}

function setAlignCommand(align: Align): Command {
  return setParagraphFieldsCommand({ align });
}

function setLineSpacingCommand(lineSpacing: LineSpacing): Command {
  return setParagraphFieldsCommand({ lineSpacing });
}

function setSpaceBeforeCommand(spaceBefore: SpacePt): Command {
  return setParagraphFieldsCommand({ spaceBefore });
}

function setSpaceAfterCommand(spaceAfter: SpacePt): Command {
  return setParagraphFieldsCommand({ spaceAfter });
}

function setLeftIndentCommand(indentLeft: number): Command {
  return setParagraphFieldsCommand({ indentLeft });
}

function setFirstLineIndentCommand(indentFirst: number): Command {
  return setParagraphFieldsCommand({ indentFirst, indentHanging: 0 });
}

function setHangingIndentCommand(indentHanging: number): Command {
  return setParagraphFieldsCommand({ indentHanging, indentFirst: 0 });
}

function stepLeftIndentCommand(deltaSteps: number): Command {
  return (state, dispatch) => {
    const depth = paragraphDepth(state.selection.$from);
    if (depth === null) {
      return false;
    }
    const node = state.selection.$from.node(depth);
    const current = Number(node.attrs.indentLeft ?? 0);
    const next = stepIndentInches(current, deltaSteps, INDENT_LEFT_MIN_IN, INDENT_LEFT_MAX_IN);
    if (next === current) {
      return false;
    }
    return setLeftIndentCommand(next)(state, dispatch);
  };
}

function isAtParagraphFirstLineStart(state: EditorState): boolean {
  const depth = paragraphDepth(state.selection.$from);
  if (depth === null) {
    return false;
  }
  return state.selection.$from.parentOffset === 0;
}

function tabIndentCommand(): Command {
  return (state, dispatch) => {
    if (isAtParagraphFirstLineStart(state)) {
      const depth = paragraphDepth(state.selection.$from);
      if (depth === null) {
        return false;
      }
      const node = state.selection.$from.node(depth);
      const currentFirst = Number(node.attrs.indentFirst ?? 0);
      if (currentFirst === 0) {
        return setFirstLineIndentCommand(INDENT_STEP_IN)(state, dispatch);
      }
    }
    return stepLeftIndentCommand(1)(state, dispatch);
  };
}

function backspaceRemovesIndent(state: EditorState): boolean {
  const { empty, $from } = state.selection;
  if (!empty || $from.parentOffset !== 0) {
    return false;
  }
  const depth = paragraphDepth($from);
  if (depth === null) {
    return false;
  }
  const node = $from.node(depth);
  return Number(node.attrs.indentFirst ?? 0) > 0 || Number(node.attrs.indentLeft ?? 0) > 0;
}

function dispatchAsOwnUndo(dispatch: ((tr: Transaction) => void) | undefined) {
  if (dispatch === undefined) {
    return undefined;
  }
  return (tr: Transaction) => {
    dispatch(markCloseHistoryGroup(tr));
  };
}

// At the start of an indented paragraph, Backspace removes one indent step
// and stays put. First-line indent goes first, then each left-indent step.
// Joining with the previous block waits until no indent is left.
export function backspaceUnindentAtStartCommand(): Command {
  return (state, dispatch) => {
    if (!backspaceRemovesIndent(state)) {
      return false;
    }
    const node = state.selection.$from.node(paragraphDepth(state.selection.$from) as number);
    const currentFirst = Number(node.attrs.indentFirst ?? 0);
    const apply = dispatchAsOwnUndo(dispatch);
    if (currentFirst > 0) {
      const next = stepIndentInches(currentFirst, -1, INDENT_LEFT_MIN_IN, INDENT_FIRST_MAX_IN);
      if (next !== currentFirst) {
        return setFirstLineIndentCommand(next)(state, apply);
      }
    }
    return stepLeftIndentCommand(-1)(state, apply);
  };
}

function shiftTabIndentCommand(): Command {
  return (state, dispatch) => {
    const depth = paragraphDepth(state.selection.$from);
    if (depth === null) {
      return false;
    }
    const node = state.selection.$from.node(depth);
    const currentLeft = Number(node.attrs.indentLeft ?? 0);
    // Undo a whole-paragraph step before the first-line step.
    if (currentLeft > 0) {
      return stepLeftIndentCommand(-1)(state, dispatch);
    }
    const currentFirst = Number(node.attrs.indentFirst ?? 0);
    if (currentFirst > 0) {
      const next = stepIndentInches(currentFirst, -1, INDENT_LEFT_MIN_IN, INDENT_FIRST_MAX_IN);
      if (next !== currentFirst) {
        return setFirstLineIndentCommand(next)(state, dispatch);
      }
    }
    return false;
  };
}

function paragraphAttrsAfterEnter(node: ProseNode): Record<string, unknown> {
  // A Tab first-line indent stays a first-line indent. It is not copied
  // into the left indent. A paragraph with neither indent stays that way.
  // A left indent that was set on purpose is kept.
  return {
    ...node.attrs,
    blockId: newBlockId(),
    indentLeft: Number(node.attrs.indentLeft ?? 0),
    indentFirst: Number(node.attrs.indentFirst ?? 0),
    indentHanging: Number(node.attrs.indentHanging ?? 0),
  };
}

export function splitParagraphKeepingFormat(): Command {
  const split = splitBlockAs((node) => {
    if (node.type.name !== 'paragraph') {
      return null;
    }
    return {
      type: node.type,
      attrs: paragraphAttrsAfterEnter(node),
    };
  });
  return (state, dispatch) => {
    return split(state, (tr) => {
      tr.setStoredMarks([]);
      tr.setMeta('splitBlock', true);
      dispatch?.(markCloseHistoryGroup(tr));
    });
  };
}

export function paragraphFormatKeymap(): Record<string, Command> {
  return {
    Tab: tabIndentCommand(),
    'Shift-Tab': shiftTabIndentCommand(),
    'Mod-l': setAlignCommand('left'),
    'Mod-e': setAlignCommand('center'),
    'Mod-r': setAlignCommand('right'),
    'Mod-j': setAlignCommand('justify'),
  };
}

export function paragraphMenuCommand(menuId: string): Command | null {
  const align = alignmentFromMenuId(menuId);
  if (align !== null) {
    return setAlignCommand(align);
  }
  const lineSpacing = lineSpacingFromMenuId(menuId);
  if (lineSpacing !== null) {
    return setLineSpacingCommand(lineSpacing);
  }
  const spaceBefore = spaceBeforeFromMenuId(menuId);
  if (spaceBefore !== null) {
    return setSpaceBeforeCommand(spaceBefore);
  }
  const spaceAfter = spaceAfterFromMenuId(menuId);
  if (spaceAfter !== null) {
    return setSpaceAfterCommand(spaceAfter);
  }
  const left = leftIndentFromMenuId(menuId);
  if (left !== null) {
    return setLeftIndentCommand(left);
  }
  const first = firstLineIndentFromMenuId(menuId);
  if (first !== null) {
    return setFirstLineIndentCommand(first);
  }
  const hanging = hangingIndentFromMenuId(menuId);
  if (hanging !== null) {
    return setHangingIndentCommand(hanging);
  }
  if (menuId === 'format-indent-increase') {
    return stepLeftIndentCommand(1);
  }
  if (menuId === 'format-indent-decrease') {
    return stepLeftIndentCommand(-1);
  }
  return null;
}

export function runParagraphMenuCommand(state: EditorState, menuId: string): EditorState | null {
  const command = paragraphMenuCommand(menuId);
  if (command === null) {
    return null;
  }
  return applyCommand(state, command);
}

export function applyParagraphFormatCommand(format: Record<string, unknown>): Command {
  const fields: Record<string, unknown> = {};
  if (typeof format.align === 'string' && (ALIGNMENTS as readonly string[]).includes(format.align)) {
    fields.align = format.align;
  }
  if (typeof format.lineSpacing === 'string' && isLineSpacingRule(format.lineSpacing)) {
    fields.lineSpacing = format.lineSpacing;
    if (lineSpacingRuleNeedsAt(format.lineSpacing) && typeof format.lineSpacingAt === 'number') {
      fields.lineSpacingAt = format.lineSpacingAt;
    }
  }
  if (typeof format.indentRight === 'number') {
    fields.indentRight = format.indentRight;
  }
  if (format.dontAddSpaceBetweenSameStyle === true) {
    fields.dontAddSpaceBetweenSameStyle = true;
  }
  if (typeof format.spaceBefore === 'number' && (SPACE_BEFORE_AFTER_PT as readonly number[]).includes(format.spaceBefore)) {
    fields.spaceBefore = format.spaceBefore;
  }
  if (typeof format.spaceAfter === 'number' && (SPACE_BEFORE_AFTER_PT as readonly number[]).includes(format.spaceAfter)) {
    fields.spaceAfter = format.spaceAfter;
  }
  if (typeof format.indentLeft === 'number') {
    fields.indentLeft = format.indentLeft;
  }
  if (typeof format.indentFirst === 'number') {
    fields.indentFirst = format.indentFirst;
  }
  if (typeof format.indentHanging === 'number') {
    fields.indentHanging = format.indentHanging;
  }
  if (Object.keys(fields).length === 0) {
    return () => false;
  }
  return setParagraphFieldsCommand(fields);
}

export function applyParagraphFormatForTest(
  state: EditorState,
  format: Record<string, unknown>,
): EditorState | null {
  return applyCommand(state, applyParagraphFormatCommand(format));
}

export function paragraphFieldsFromNode(node: ProseNode): Record<string, unknown> {
  const right = Number(node.attrs.indentRight ?? 0);
  const fields: Record<string, unknown> = {
    align: node.attrs.align ?? 'left',
    spaceBefore: node.attrs.spaceBefore ?? 0,
    spaceAfter: node.attrs.spaceAfter ?? 0,
    indents: {
      left: node.attrs.indentLeft ?? 0,
      right: right > 0 ? right : undefined,
      first: node.attrs.indentFirst ?? 0,
      hanging: node.attrs.indentHanging ?? 0,
    },
  };
  const indents = fields.indents as Record<string, unknown>;
  if (!indents.right) {
    delete indents.right;
  }
  if (typeof node.attrs.lineSpacing === 'string' && isLineSpacingRule(node.attrs.lineSpacing)) {
    fields.lineSpacing = node.attrs.lineSpacing;
    if (lineSpacingRuleNeedsAt(node.attrs.lineSpacing) && typeof node.attrs.lineSpacingAt === 'number') {
      fields.lineSpacingAt = node.attrs.lineSpacingAt;
    }
  }
  if (node.attrs.dontAddSpaceBetweenSameStyle === true) {
    fields.dontAddSpaceBetweenSameStyle = true;
  }
  return fields;
}

export type ParagraphDialogScope = 'document' | 'selection';

export interface ParagraphDialogApply {
  scope: ParagraphDialogScope;
  lineSpacing?: DialogLineSpacing;
  lineSpacingAt?: number | null;
  spaceBefore?: SpacePt;
  spaceAfter?: SpacePt;
  clearLineSpacingOverride?: boolean;
  align?: Align;
  indentLeft?: number;
  indentRight?: number;
  indentFirst?: number;
  indentHanging?: number;
  dontAddSpaceBetweenSameStyle?: boolean | null;
}

function paragraphsInScope(state: EditorState, scope: ParagraphDialogScope): Array<{ pos: number; node: ProseNode }> {
  const matches: Array<{ pos: number; node: ProseNode }> = [];
  const { $from, $to } = state.selection;
  const seen = new Set<number>();
  if (scope === 'selection') {
    state.doc.nodesBetween($from.pos, $to.pos, (node, pos) => {
      if (node.type.name !== 'paragraph' || seen.has(pos)) {
        return;
      }
      seen.add(pos);
      matches.push({ pos, node });
    });
    if (matches.length === 0) {
      const depth = paragraphDepth($from);
      if (depth !== null) {
        matches.push({ pos: $from.before(depth), node: $from.node(depth) });
      }
    }
    return matches;
  }
  state.doc.descendants((node, pos) => {
    if (node.type.name !== 'paragraph') {
      return;
    }
    matches.push({ pos, node });
  });
  return matches;
}

export function applyParagraphDialogCommand(options: ParagraphDialogApply): Command {
  return (state, dispatch) => {
    const targets = paragraphsInScope(state, options.scope);
    if (targets.length === 0) {
      return false;
    }
    const tr = state.tr;
    let changed = false;
    for (const { pos, node } of targets) {
      const nextAttrs: Record<string, unknown> = { ...node.attrs };
      let next = false;
      if (options.clearLineSpacingOverride) {
        nextAttrs.lineSpacing = null;
        nextAttrs.lineSpacingAt = null;
        next = true;
      } else if (typeof options.lineSpacing === 'string') {
        nextAttrs.lineSpacing = options.lineSpacing;
        if (lineSpacingRuleNeedsAt(options.lineSpacing)) {
          nextAttrs.lineSpacingAt = options.lineSpacingAt ?? null;
        } else {
          nextAttrs.lineSpacingAt = null;
        }
        next = true;
      }
      if (typeof options.spaceBefore === 'number') {
        nextAttrs.spaceBefore = options.spaceBefore;
        next = true;
      }
      if (typeof options.spaceAfter === 'number') {
        nextAttrs.spaceAfter = options.spaceAfter;
        next = true;
      }
      if (typeof options.align === 'string') {
        nextAttrs.align = options.align;
        next = true;
      }
      if (typeof options.indentLeft === 'number') {
        nextAttrs.indentLeft = options.indentLeft;
        next = true;
      }
      if (typeof options.indentFirst === 'number') {
        nextAttrs.indentFirst = options.indentFirst;
        next = true;
      }
      if (typeof options.indentHanging === 'number') {
        nextAttrs.indentHanging = options.indentHanging;
        next = true;
      }
      if (typeof options.indentRight === 'number') {
        nextAttrs.indentRight = options.indentRight;
        next = true;
      }
      if (options.dontAddSpaceBetweenSameStyle !== undefined) {
        nextAttrs.dontAddSpaceBetweenSameStyle = options.dontAddSpaceBetweenSameStyle;
        next = true;
      }
      if (!next) {
        continue;
      }
      updateParagraphAttrs(tr, pos, node, nextAttrs);
      changed = true;
    }
    if (!changed) {
      return false;
    }
    if (dispatch) {
      dispatch(tr);
    }
    return true;
  };
}
