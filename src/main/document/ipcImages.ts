import type { Document } from '../../shared/schema/index.js';
import type { DocumentMessage, IpcImagePayload } from '../../shared/ipc/types.js';

export function toDocumentMessage(document: Document): DocumentMessage {
  const copy = structuredClone(document);
  return {
    view: copy.view,
    page: copy.page as unknown as DocumentMessage['page'],
    header: copy.header as unknown as DocumentMessage['header'],
    footer: copy.footer as unknown as DocumentMessage['footer'],
    blocks: copy.blocks as unknown as DocumentMessage['blocks'],
  };
}

export function ipcImagesFromDecoded(
  manifest: { images: readonly { sha256: string; type: IpcImagePayload['type']; width: number; height: number; frames: number }[] },
  packed: readonly { sha256: string; bytes: Uint8Array }[],
): IpcImagePayload[] {
  const byHash = new Map(packed.map((entry) => [entry.sha256, entry.bytes]));
  return manifest.images.map((image) => {
    const bytes = byHash.get(image.sha256);
    const data = bytes ? Buffer.from(bytes).toString('base64') : '';
    return {
      sha256: image.sha256,
      type: image.type,
      data,
      pixelWidth: image.width,
      pixelHeight: image.height,
      frames: image.frames,
    };
  });
}