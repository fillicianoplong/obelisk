import { IPC_INVOKE_CHANNELS } from '../../shared/ipc/channels.js';
import type { IpcRegistry } from './registry.js';

export interface IpcSenderEvent {
  senderFrame?: { url?: string } | null;
}

export interface IpcMainLike {
  handle(
    channel: string,
    listener: (event: IpcSenderEvent, ...args: unknown[]) => unknown,
  ): void;
}

export function frameUrlFromEvent(event: IpcSenderEvent): string | null {
  const url = event.senderFrame?.url;
  return typeof url === 'string' ? url : null;
}

export function bindIpcHandlers(ipc: IpcMainLike, registry: IpcRegistry): string[] {
  const registered: string[] = [];
  for (const channel of IPC_INVOKE_CHANNELS) {
    ipc.handle(channel, (event, ...args) =>
      registry.dispatch({
        senderUrl: frameUrlFromEvent(event),
        channel,
        args,
      }),
    );
    registered.push(channel);
  }
  return registered;
}
