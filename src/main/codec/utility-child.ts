import { readArchive, type ArchiveResult } from './archive/index.js';

// Electron's utility process keeps a pipe to main, so the child does not
// drain its event loop on its own. Main closes the process after the reply.

interface ArchiveRequest {
  id: number;
  filePath: string;
}

interface ArchiveResponse {
  id: number;
  result: ArchiveResult;
}

interface ParentMessage {
  data: unknown;
}

interface UtilityParentPort {
  on(event: 'message', listener: (event: ParentMessage) => void): void;
  postMessage(message: ArchiveResponse): void;
}

export async function archiveResponse(request: ArchiveRequest): Promise<ArchiveResponse> {
  return { id: request.id, result: await readArchive(request.filePath) };
}

function utilityParentPort(): UtilityParentPort | null {
  const candidate = (process as NodeJS.Process & { parentPort?: UtilityParentPort }).parentPort;
  return candidate ?? null;
}

function isRequest(value: unknown): value is ArchiveRequest {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as { id?: unknown; filePath?: unknown };
  return typeof record.id === 'number' && Number.isInteger(record.id) && typeof record.filePath === 'string';
}

const port = utilityParentPort();
if (port) {
  port.on('message', (event) => {
    const request = event.data;
    if (!isRequest(request)) {
      return;
    }
    void archiveResponse(request)
      .then((response) => {
        port.postMessage(response);
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        port.postMessage({
          id: request.id,
          result: {
            ok: false,
            reason: 'unreadable',
            path: '',
            message,
            opened: false,
            entriesRead: 0,
            payloadsRead: 0,
            bytesRead: 0,
            cappedEntryBytesRead: null,
          },
        });
      });
  });
}
