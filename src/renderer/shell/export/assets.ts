import type { ExportAssets } from '../../../shared/ipc/types.js';

// OBL-66 fills in MathML, formula PNGs, and first-frame PNGs at export time.
export function emptyExportAssets(): ExportAssets {
  return { mathml: [], formulaPngs: [], firstFramePngs: [] };
}