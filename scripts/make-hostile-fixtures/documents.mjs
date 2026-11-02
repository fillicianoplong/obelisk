export function blockId(n) {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

function indents() {
  return { left: 0, first: 0, hanging: 0 };
}

function paragraphFields() {
  return {
    align: 'left',
    lineSpacing: 'single',
    spaceBefore: 0,
    spaceAfter: 0,
    indents: indents(),
  };
}

export function headerParagraph(n, content = []) {
  return { id: blockId(n), ...paragraphFields(), content };
}

export function minimalDocument(blocks = []) {
  return {
    view: 'pageless',
    page: {
      paper: 'letter',
      orientation: 'portrait',
      margins: { top: 1, right: 1, bottom: 1, left: 1 },
    },
    header: headerParagraph(1),
    footer: headerParagraph(2),
    blocks,
  };
}

export function paragraph(n, content) {
  return { type: 'paragraph', id: blockId(n), ...paragraphFields(), content };
}

export function textRun(text) {
  return { type: 'text', text };
}

export function linkRun(address, text = 'link') {
  return { type: 'link', address, text };
}

export function emptyManifest(writer) {
  return { format: 'obelisk', formatVersion: 1, writer, images: [] };
}

export function imageName(index, extension = 'png') {
  return `images/${index.toString(16).padStart(64, '0')}.${extension}`;
}

export function imageDocument(hash) {
  return minimalDocument([{
    type: 'image',
    id: blockId(3),
    sha256: hash,
    width: 1,
    rotation: 0,
    flipHorizontal: false,
    flipVertical: false,
    alt: 'figure',
  }]);
}

export function imageManifest(writer, image) {
  return {
    format: 'obelisk',
    formatVersion: 1,
    writer,
    images: [image],
  };
}
