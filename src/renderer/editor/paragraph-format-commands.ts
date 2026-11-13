import { splitBlockAs } from 'prosemirror-commands';
import type { Node as ProseNode } from 'prosemirror-model';
import type { Command, EditorState, Transaction } from 'prosemirror-state';
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

type Align = (typeof ALIGNMENTS)[number];
type LineSpacing = (typeof LINE_SPACINGS)[number];
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
        return setFirstLineIndentCommand(INDENT_STEP_IN * 2)(state, dispatch);
      }
    }
    return stepLeftIndentCommand(1)(state, dispatch);
  };
}

function shiftTabIndentCommand(): Command {
  return (state, dispatch) => {
    if (isAtParagraphFirstLineStart(state)) {
      const depth = paragraphDepth(state.selection.$from);
      if (depth === null) {
        return false;
      }
      const node = state.selection.$from.node(depth);
      const currentFirst = Number(node.attrs.indentFirst ?? 0);
      if (currentFirst > 0) {
        return setFirstLineIndentCommand(0)(state, dispatch);
      }
    }
    return stepLeftIndentCommand(-1)(state, dispatch);
  };
}

export function splitParagraphKeepingFormat(): Command {
  const split = splitBlockAs((node) => {
    if (node.type.name !== 'paragraph') {
      return null;
    }
    return {
      type: node.type,
      attrs: {
        ...node.attrs,
        blockId: newBlockId(),
      },
    };
  });
  return (state, dispatch) => {
    const marks = state.storedMarks ?? state.selection.$from.marks();
    return split(state, (tr) => {
      if (marks.length > 0) {
        tr.setStoredMarks(marks);
      }
      dispatch?.(tr);
    });
  };
}

export function paragraphFormatKeymap(): Record<string, Command> {
  return {
    Enter: splitParagraphKeepingFormat(),
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
  if (typeof format.lineSpacing === 'string' && (LINE_SPACINGS as readonly string[]).includes(format.lineSpacing)) {
    fields.lineSpacing = format.lineSpacing;
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
  return {
    align: node.attrs.align ?? 'left',
    lineSpacing: node.attrs.lineSpacing ?? 'single',
    spaceBefore: node.attrs.spaceBefore ?? 0,
    spaceAfter: node.attrs.spaceAfter ?? 0,
    indents: {
      left: node.attrs.indentLeft ?? 0,
      first: node.attrs.indentFirst ?? 0,
      hanging: node.attrs.indentHanging ?? 0,
    },
  };
}
