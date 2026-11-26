import {
  CSS_PX_PER_INCH,
  PAGE_GAP_PX,
  PAGE_HEIGHT_IN,
  PAGE_MARGIN_IN,
  PAGE_WIDTH_IN,
  cssPixelsAt96Dpi,
} from './page.js';

// One page of body text, then the next. A line that does not fit moves whole.
// Print and PDF can call this with the same measured lines (FR-62, FR-74).

export interface PageBox {
  pageWidth: number;
  pageHeight: number;
  marginTop: number;
  marginRight: number;
  marginBottom: number;
  marginLeft: number;
  gap: number;
}

export interface PageMargins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface FlowUnit {
  /** Document position of this line, or of the page-break node. */
  pos: number;
  /** Position before the block that owns the line. */
  blockPos: number;
  height: number;
  kind: 'line' | 'page-break';
  /** The line is the first line of its block, so the gap before it travels with the block. */
  startsBlock: boolean;
}

export interface LayoutSpacer {
  pos: number;
  height: number;
  /** A page break grows to this height. A widget is inserted before a line. */
  where: 'widget' | 'break';
}

export interface PageLayout {
  pageCount: number;
  spacers: LayoutSpacer[];
  /** 0-based page for each unit, in the same order as the input. */
  unitPage: number[];
}

// A line may land a fraction over the text area from subpixel rounding.
const TEXT_SLACK_PX = 1;

export function letterPageBox(margins?: Partial<PageMargins>): PageBox {
  const margin = cssPixelsAt96Dpi(PAGE_MARGIN_IN);
  return {
    pageWidth: cssPixelsAt96Dpi(PAGE_WIDTH_IN),
    pageHeight: cssPixelsAt96Dpi(PAGE_HEIGHT_IN),
    marginTop: margins?.top ?? margin,
    marginRight: margins?.right ?? margin,
    marginBottom: margins?.bottom ?? margin,
    marginLeft: margins?.left ?? margin,
    gap: PAGE_GAP_PX,
  };
}

export function pageBoxFromMargins(margins: PageMargins): PageBox {
  return {
    pageWidth: cssPixelsAt96Dpi(PAGE_WIDTH_IN),
    pageHeight: cssPixelsAt96Dpi(PAGE_HEIGHT_IN),
    marginTop: cssPixelsAt96Dpi(margins.top),
    marginRight: cssPixelsAt96Dpi(margins.right),
    marginBottom: cssPixelsAt96Dpi(margins.bottom),
    marginLeft: cssPixelsAt96Dpi(margins.left),
    gap: PAGE_GAP_PX,
  };
}

// Sheets, text, gaps, and margins grow together. 100% leaves the box unchanged.
export function scalePageBox(box: PageBox, zoomPercent: number): PageBox {
  const factor = zoomPercent / 100;
  if (!Number.isFinite(factor) || factor === 1) {
    return box;
  }
  return {
    pageWidth: box.pageWidth * factor,
    pageHeight: box.pageHeight * factor,
    marginTop: box.marginTop * factor,
    marginRight: box.marginRight * factor,
    marginBottom: box.marginBottom * factor,
    marginLeft: box.marginLeft * factor,
    gap: box.gap * factor,
  };
}

export function marginsFromUnknown(margins: unknown): PageMargins {
  const record = margins !== null && typeof margins === 'object'
    ? margins as Record<string, unknown>
    : {};
  const side = (key: string) => {
    const value = record[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : PAGE_MARGIN_IN;
  };
  return {
    top: side('top'),
    right: side('right'),
    bottom: side('bottom'),
    left: side('left'),
  };
}

export function textAreaHeight(box: PageBox): number {
  return Math.max(1, box.pageHeight - box.marginTop - box.marginBottom);
}

export function sheetStackHeight(pageCount: number, box: PageBox): number {
  const count = Math.max(1, pageCount);
  return count * box.pageHeight + (count - 1) * box.gap;
}

export function pageCountLabel(page: number, total: number): string {
  const pages = Math.max(1, Math.floor(total));
  const current = Math.min(pages, Math.max(1, Math.floor(page)));
  return `Page ${current} of ${pages}`;
}

function gapAfterUsed(used: number, box: PageBox): number {
  const remain = Math.max(0, textAreaHeight(box) - used);
  return remain + box.marginBottom + box.gap + box.marginTop;
}

export function paginateFlow(units: readonly FlowUnit[], box: PageBox): PageLayout {
  const limit = textAreaHeight(box);
  const spacers: LayoutSpacer[] = [];
  const unitPage: number[] = [];
  let page = 0;
  let used = 0;

  const advance = (pos: number, where: LayoutSpacer['where']) => {
    spacers.push({ pos, height: gapAfterUsed(used, box), where });
    page += 1;
    used = 0;
  };

  for (const unit of units) {
    if (unit.kind === 'page-break') {
      advance(unit.pos, 'break');
      unitPage.push(page);
      continue;
    }
    const height = Math.max(0, unit.height);
    if (height <= TEXT_SLACK_PX) {
      unitPage.push(page);
      continue;
    }
    if (used > TEXT_SLACK_PX && used + height > limit + TEXT_SLACK_PX) {
      advance(unit.startsBlock ? unit.blockPos : unit.pos, 'widget');
    }
    unitPage.push(page);
    used += height;
  }

  return {
    pageCount: page + 1,
    spacers,
    unitPage,
  };
}

/** 0-based page that holds a document position. The selection's focus end uses this. */
export function pageIndexAt(
  units: readonly FlowUnit[],
  unitPage: readonly number[],
  pos: number,
): number {
  let page = 0;
  for (let index = 0; index < units.length; index += 1) {
    const unit = units[index];
    if (unit === undefined || unitPage[index] === undefined) {
      continue;
    }
    if (unit.kind === 'page-break') {
      if (pos >= unit.pos) {
        page = unitPage[index];
      }
      continue;
    }
    if (unit.pos <= pos) {
      page = unitPage[index];
    }
  }
  return page;
}

export const PAGE_PX_PER_INCH = CSS_PX_PER_INCH;
