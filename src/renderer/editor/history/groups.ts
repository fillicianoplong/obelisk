import { closeHistory } from 'prosemirror-history';
import { Plugin } from 'prosemirror-state';
import type { Transaction } from 'prosemirror-state';
import { ReplaceStep } from 'prosemirror-transform';

const BOUNDARY_END = /[\s.,!?;:)\]]$/;

function insertedText(step: unknown): string | null {
  if (!(step instanceof ReplaceStep)) {
    return null;
  }
  const slice = step.slice;
  if (slice.content.childCount !== 1) {
    return null;
  }
  const child = slice.content.firstChild;
  if (child === null || !child.isText) {
    return null;
  }
  return child.text ?? '';
}

export function markCloseHistoryGroup(tr: Transaction): Transaction {
  return tr.setMeta('closeHistoryGroup', true);
}

export function historyGroupingPlugin(): Plugin {
  return new Plugin({
    appendTransaction(transactions, _oldState, newState) {
      if (transactions.some((tr) => tr.getMeta('closeHistoryGroup') === true)) {
        return closeHistory(newState.tr);
      }
      for (const tr of transactions) {
        if (!tr.docChanged) {
          continue;
        }
        for (const step of tr.steps) {
          const text = insertedText(step);
          if (text !== null && BOUNDARY_END.test(text)) {
            return closeHistory(newState.tr);
          }
        }
      }
      return null;
    },
  });
}