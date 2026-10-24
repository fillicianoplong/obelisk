import { isInvokeChannel, type InvokeChannel } from '../../shared/ipc/channels.js';
import { invalidArgument, senderNotAllowed, unknownChannel } from '../../shared/ipc/errors.js';
import type { IpcDispatchResult } from '../../shared/ipc/types.js';
import { parseInvokeRequest } from '../../shared/ipc/validate.js';
import { createStubHandlers, type IpcHandler, type IpcHandlerMap } from './handlers.js';
import { isAppPageSender } from './sender.js';

export interface IpcCall {
  senderUrl: string | null;
  channel: string;
  args: readonly unknown[];
}

type StoredHandler = (request: unknown) => unknown;

export interface IpcRegistry {
  setHandler<C extends InvokeChannel>(channel: C, handler: IpcHandler<C>): void;
  dispatch(call: IpcCall): Promise<IpcDispatchResult>;
}

export function createIpcRegistry(handlers: IpcHandlerMap = createStubHandlers()): IpcRegistry {
  const stored = {} as { [C in InvokeChannel]: StoredHandler };
  for (const channel of Object.keys(handlers) as InvokeChannel[]) {
    stored[channel] = handlers[channel] as StoredHandler;
  }

  return {
    setHandler(channel, handler) {
      if (!isInvokeChannel(channel)) {
        throw new TypeError('Unknown channel.');
      }
      stored[channel] = handler as unknown as StoredHandler;
    },
    async dispatch(call) {
      if (!isAppPageSender(call.senderUrl)) {
        return senderNotAllowed();
      }
      if (!isInvokeChannel(call.channel)) {
        return unknownChannel();
      }
      const parsed = parseInvokeRequest(call.channel, call.args);
      if (!parsed.ok) {
        return invalidArgument(call.channel);
      }
      return (await stored[call.channel](parsed.request)) as IpcDispatchResult;
    },
  };
}
