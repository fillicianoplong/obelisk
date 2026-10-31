import type { MarkSpec } from 'prosemirror-model';

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

function hexColorAttr(value: unknown): string | undefined {
  if (typeof value !== 'string' || !HEX_COLOR.test(value)) {
    return undefined;
  }
  return value.toLowerCase();
}

function booleanMark(tag: string): MarkSpec {
  return {
    parseDOM: [{ tag }],
    toDOM() {
      return [tag, 0];
    },
  };
}

export const markSpecs: { [name: string]: MarkSpec } = {
  bold: booleanMark('strong'),
  italic: booleanMark('em'),
  underline: {
    parseDOM: [{ tag: 'span[data-underline="true"]' }],
    toDOM() {
      return ['span', { 'data-underline': 'true' }, 0];
    },
  },
  strike: booleanMark('s'),
  code: {
    parseDOM: [{ tag: 'code' }],
    toDOM() {
      return ['code', { class: 'inline-code' }, 0];
    },
  },
  superscript: {
    excludes: 'subscript',
    parseDOM: [{ tag: 'sup' }],
    toDOM() {
      return ['sup', 0];
    },
  },
  subscript: {
    excludes: 'superscript',
    parseDOM: [{ tag: 'sub' }],
    toDOM() {
      return ['sub', 0];
    },
  },
  fontFamily: {
    attrs: { family: {} },
    parseDOM: [{
      tag: 'span[data-font-family]',
      getAttrs(dom) {
        if (!(dom instanceof HTMLElement)) {
          return false;
        }
        const family = dom.dataset.fontFamily;
        return family ? { family } : false;
      },
    }],
    toDOM(mark) {
      return ['span', {
        'data-font-family': mark.attrs.family,
      }, 0];
    },
  },
  fontSize: {
    attrs: { pt: {} },
    parseDOM: [{
      tag: 'span[data-font-size]',
      getAttrs(dom) {
        if (!(dom instanceof HTMLElement)) {
          return false;
        }
        const pt = dom.dataset.fontSize;
        return pt ? { pt: Number(pt) } : false;
      },
    }],
    toDOM(mark) {
      return ['span', {
        'data-font-size': String(mark.attrs.pt),
      }, 0];
    },
  },
  textColor: {
    attrs: { color: {} },
    parseDOM: [{
      tag: 'span[data-text-color]',
      getAttrs(dom) {
        if (!(dom instanceof HTMLElement)) {
          return false;
        }
        const color = dom.dataset.textColor;
        return color ? { color } : false;
      },
    }],
    toDOM(mark) {
      const color = hexColorAttr(mark.attrs.color);
      return ['span', { 'data-text-color': color ?? mark.attrs.color }, 0];
    },
  },
  highlight: {
    attrs: { color: {} },
    parseDOM: [{
      tag: 'span[data-highlight]',
      getAttrs(dom) {
        if (!(dom instanceof HTMLElement)) {
          return false;
        }
        const color = dom.dataset.highlight;
        return color ? { color } : false;
      },
    }],
    toDOM(mark) {
      const color = hexColorAttr(mark.attrs.color);
      return ['span', {
        'data-highlight': color ?? mark.attrs.color,
      }, 0];
    },
  },
};

export const CHARACTER_MARK_NAMES = Object.keys(markSpecs);
