import type { Node as ProseNode } from 'prosemirror-model';
import type { EditorView, NodeView } from 'prosemirror-view';
import { activeImageStore } from './assets.js';
import { parseImagePayload } from './document.js';
import { tableNodeViews } from '../table/view.js';

const MIME: Record<string, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

async function stillFrameUrl(bytes: Uint8Array, mime: string): Promise<string | null> {
  if (typeof ImageDecoder === 'undefined') {
    return null;
  }
  try {
    const copy = new Uint8Array(bytes);
    const decoder = new ImageDecoder({ data: copy, type: mime });
    const { image } = await decoder.decode({ frameIndex: 0 });
    const canvas = document.createElement('canvas');
    canvas.width = image.displayWidth;
    canvas.height = image.displayHeight;
    const ctx = canvas.getContext('2d');
    if (ctx === null) {
      return null;
    }
    ctx.drawImage(image, 0, 0);
    return await new Promise((resolve) => {
      canvas.toBlob((blob) => {
        if (blob === null) {
          resolve(null);
          return;
        }
        resolve(URL.createObjectURL(blob));
      }, 'image/png');
    });
  } catch {
    return null;
  }
}

export class ImageBlockView implements NodeView {
  dom: HTMLElement;

  private figure: HTMLElement;

  private img: HTMLImageElement;

  private node: ProseNode;

  private objectUrl: string | null = null;

  private stillUrl: string | null = null;

  constructor(node: ProseNode, _view: EditorView) {
    this.node = node;
    this.dom = document.createElement('div');
    this.dom.className = 'image-block';
    this.dom.dataset.blockType = 'image';
    this.figure = document.createElement('figure');
    this.figure.className = 'image-block-figure';
    this.img = document.createElement('img');
    this.img.className = 'image-block-img';
    this.img.draggable = false;
    this.figure.append(this.img);
    this.dom.append(this.figure);
    void this.render(node);
  }

  private revokeUrls(): void {
    if (this.objectUrl !== null) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
    if (this.stillUrl !== null) {
      URL.revokeObjectURL(this.stillUrl);
      this.stillUrl = null;
    }
  }

  private async render(node: ProseNode): Promise<void> {
    this.node = node;
    const image = parseImagePayload(node.attrs);
    if (image === null) {
      return;
    }
    const asset = activeImageStore().get(image.sha256);
    if (!asset) {
      this.img.removeAttribute('src');
      this.img.alt = image.alt;
      return;
    }
    const widthIn = `${image.width}in`;
    this.figure.style.width = widthIn;
    this.img.style.width = '100%';
    this.img.style.height = 'auto';
    this.img.alt = image.alt;
    const mime = MIME[asset.type] ?? 'application/octet-stream';
  const transforms: string[] = [];
    if (image.rotation) {
      transforms.push(`rotate(${image.rotation}deg)`);
    }
    if (image.flipHorizontal) {
      transforms.push('scaleX(-1)');
    }
    if (image.flipVertical) {
      transforms.push('scaleY(-1)');
    }
    this.img.style.transform = transforms.length > 0 ? transforms.join(' ') : '';
    this.revokeUrls();
    const copy = new Uint8Array(asset.bytes.byteLength);
    copy.set(asset.bytes);
    this.objectUrl = URL.createObjectURL(new Blob([copy], { type: mime }));
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const animated = asset.frames > 1 && (asset.type === 'gif' || asset.type === 'webp');
    this.dom.classList.toggle('image-block-animated', animated);
    if (animated && reduced) {
      const still = await stillFrameUrl(asset.bytes, mime);
      this.stillUrl = still;
      this.img.src = still ?? this.objectUrl;
    } else {
      this.img.src = this.objectUrl;
    }
  }

  update(node: ProseNode): boolean {
    if (node.type !== this.node.type || node.attrs.blockType !== 'image') {
      return false;
    }
    void this.render(node);
    return true;
  }

  destroy(): void {
    this.revokeUrls();
  }

  ignoreMutation(): boolean {
    return true;
  }

  selectNode(): void {
    this.dom.classList.add('ProseMirror-selectednode');
  }

  deselectNode(): void {
    this.dom.classList.remove('ProseMirror-selectednode');
  }
}

export function structuredNodeViews(): Record<string, (node: ProseNode, view: EditorView, getPos: () => number | undefined) => NodeView> {
  const tableViews = tableNodeViews();
  return {
    structured_block(node, view, getPos) {
      if (node.attrs.blockType === 'table') {
        return tableViews.structured_block(node, view, getPos);
      }
      if (node.attrs.blockType === 'image') {
        return new ImageBlockView(node, view);
      }
      return new (class implements NodeView {
        dom = document.createElement('div');
        constructor() {
          this.dom.className = 'structured-block';
          this.dom.textContent = String(node.attrs.blockType);
        }
        update() {
          return false;
        }
      })();
    },
  };
}