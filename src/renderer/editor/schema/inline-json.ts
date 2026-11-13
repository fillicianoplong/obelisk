import type { Mark, Node as ProseNode, Schema } from 'prosemirror-model';
import type { JsonObject, JsonValue } from '../../../shared/ipc/types.js';
import type { TextMarks } from '../../../shared/schema/types.js';
import {
  DEFAULT_FONT_FAMILY,
  DEFAULT_FONT_SIZE,
} from '../format/reference.js';

export function marksFromJson(marks: TextMarks | undefined, schema: Schema): readonly Mark[] {
  if (!marks) {
    return [];
  }
  const result: Mark[] = [];
  if (marks.bold) {
    result.push(schema.marks.bold.create());
  }
  if (marks.italic) {
    result.push(schema.marks.italic.create());
  }
  if (marks.underline) {
    result.push(schema.marks.underline.create());
  }
  if (marks.strike) {
    result.push(schema.marks.strike.create());
  }
  if (marks.code) {
    result.push(schema.marks.code.create());
  }
  if (marks.superscript) {
    result.push(schema.marks.superscript.create());
  }
  if (marks.subscript) {
    result.push(schema.marks.subscript.create());
  }
  if (typeof marks.font === 'string' && marks.font !== DEFAULT_FONT_FAMILY) {
    result.push(schema.marks.fontFamily.create({ family: marks.font }));
  }
  if (typeof marks.size === 'number' && marks.size !== DEFAULT_FONT_SIZE) {
    result.push(schema.marks.fontSize.create({ pt: marks.size }));
  }
  if (typeof marks.color === 'string') {
    result.push(schema.marks.textColor.create({ color: marks.color }));
  }
  if (typeof marks.highlight === 'string') {
    result.push(schema.marks.highlight.create({ color: marks.highlight }));
  }
  return result;
}

export function textNodeFromRun(text: string, marks: TextMarks | undefined, schema: Schema): ProseNode {
  return schema.text(text, marksFromJson(marks, schema));
}

export function jsonMarksFromPm(marks: readonly Mark[]): TextMarks | undefined {
  const json: TextMarks = {};
  for (const mark of marks) {
    switch (mark.type.name) {
      case 'bold':
        json.bold = true;
        break;
      case 'italic':
        json.italic = true;
        break;
      case 'underline':
        json.underline = true;
        break;
      case 'strike':
        json.strike = true;
        break;
      case 'code':
        json.code = true;
        break;
      case 'superscript':
        json.superscript = true;
        break;
      case 'subscript':
        json.subscript = true;
        break;
      case 'fontFamily':
        if (mark.attrs.family !== DEFAULT_FONT_FAMILY) {
          json.font = String(mark.attrs.family);
        }
        break;
      case 'fontSize':
        if (mark.attrs.pt !== DEFAULT_FONT_SIZE) {
          json.size = Number(mark.attrs.pt) as TextMarks['size'];
        }
        break;
      case 'textColor':
        json.color = String(mark.attrs.color);
        break;
      case 'highlight':
        json.highlight = String(mark.attrs.color);
        break;
      default:
        break;
    }
  }
  if (Object.keys(json).length === 0) {
    return undefined;
  }
  return json;
}

function runFromTextNode(node: ProseNode): JsonObject {
  const marks = jsonMarksFromPm(node.marks);
  const run: JsonObject = { type: 'text', text: node.text ?? '' };
  if (marks !== undefined) {
    run.marks = marks as JsonValue;
  }
  return run;
}

export function inlineRunsFromFragment(fragment: ProseNode['content']): JsonObject[] {
  const runs: JsonObject[] = [];
  fragment.forEach((child) => {
    if (!child.isText) {
      return;
    }
    const text = child.text ?? '';
    if (text.length === 0) {
      return;
    }
    runs.push(runFromTextNode(child));
  });
  return runs;
}

export function mergeAdjacentRuns(runs: JsonObject[]): JsonObject[] {
  if (runs.length === 0) {
    return runs;
  }
  const merged: JsonObject[] = [];
  for (const run of runs) {
    const previous = merged.at(-1);
    if (
      previous
      && previous.type === 'text'
      && run.type === 'text'
      && JSON.stringify(previous.marks ?? null) === JSON.stringify(run.marks ?? null)
    ) {
      previous.text = String(previous.text) + String(run.text);
    } else {
      merged.push({ ...run });
    }
  }
  return merged;
}

export function inlineContentFromJson(content: JsonValue | undefined, schema: Schema): ProseNode[] {
  if (!Array.isArray(content)) {
    return [];
  }
  const nodes: ProseNode[] = [];
  for (const part of content) {
    if (typeof part !== 'object' || part === null || Array.isArray(part)) {
      continue;
    }
    const record = part as JsonObject;
    if (record.type === 'text' && typeof record.text === 'string' && record.text.length > 0) {
      nodes.push(textNodeFromRun(record.text, record.marks as TextMarks | undefined, schema));
    }
    if (record.type === 'link' && typeof record.text === 'string' && record.text.length > 0) {
      nodes.push(schema.text(record.text));
    }
  }
  return nodes;
}

export function inlineJsonEqual(left: JsonValue | undefined, right: JsonValue | undefined): boolean {
  return JSON.stringify(left ?? []) === JSON.stringify(right ?? []);
}
