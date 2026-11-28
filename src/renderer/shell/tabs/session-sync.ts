import type { SessionHandles } from './save.js';
import { sessionHandles } from './save.js';
import type { PageTab } from './model.js';

const SESSION_SYNC_MS = 300;

type PageHandleTab = Pick<PageTab, 'id' | 'handle'>;

export function buildSessionHandles(tabs: readonly PageHandleTab[], activeId: string): SessionHandles {
  return sessionHandles(tabs, activeId);
}

export function createSessionSync() {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastKey = '';

  function cancel(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  async function push(handles: SessionHandles, immediate = false): Promise<void> {
    const key = JSON.stringify(handles);
    if (!immediate && key === lastKey) {
      return;
    }
    lastKey = key;
    cancel();
    const send = async () => {
      try {
        await window.obelisk['session:set']({
          handles: handles.handles,
          activeHandle: handles.activeHandle,
          ...(immediate ? { flush: true } : {}),
        });
      } catch {
        // The shell shows a message when a close or save path needs the user to know.
      }
    };
    if (immediate) {
      await send();
      return;
    }
    await new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        timer = null;
        void send().then(resolve, resolve);
      }, SESSION_SYNC_MS);
    });
  }

  return { push, cancel };
}