import type { NodeSpec } from 'prosemirror-model';
import { formatDateTime } from '../../../shared/date-time/format.js';
import type { DateChipFormat } from '../../../shared/date-time/format.js';

export const dateChipSpec: NodeSpec = {
  inline: true,
  atom: true,
  selectable: true,
  group: 'inline',
  attrs: {
    dateTime: { default: '' },
    format: { default: 'windows-short' },
  },
  toDOM(node) {
    const dateTime = String(node.attrs.dateTime);
    const format = String(node.attrs.format) as DateChipFormat;
    const label = formatDateTime(dateTime, format);
    return ['span', {
      class: 'date-time-item',
      'data-date-time': '',
      'data-date-time-value': dateTime,
      'data-date-time-format': format,
      contenteditable: 'false',
    }, label];
  },
  parseDOM: [{
    tag: 'span[data-date-time]',
    getAttrs(dom) {
      if (!(dom instanceof HTMLElement)) {
        return false;
      }
      return {
        dateTime: dom.dataset.dateTimeValue ?? '',
        format: dom.dataset.dateTimeFormat ?? 'windows-short',
      };
    },
  }],
};