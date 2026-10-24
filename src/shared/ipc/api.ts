import type { InvokeChannel } from './channels.js';
import type { FileOpenResult, RequestMap, ResultMap } from './types.js';

export interface FileActivatedApi {
  subscribe(listener: (payload: FileOpenResult) => void): number;
  unsubscribe(id: number): void;
}

export type ObeliskApi = {
  [C in InvokeChannel]: RequestMap[C] extends void
    ? () => Promise<ResultMap[C]>
    : (request: RequestMap[C]) => Promise<ResultMap[C]>;
} & {
  'file:activated': FileActivatedApi;
};
