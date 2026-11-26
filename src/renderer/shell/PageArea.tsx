import type { CSSProperties, ReactNode } from 'react';
import type { EditorState } from 'prosemirror-state';
import type { JsonObject } from '../../shared/ipc/types.js';
import { EditorCore } from '../editor/EditorCore.js';
import type { BandEdit } from '../editor/header/PageBands.js';
import type { PageMargins } from '../editor/layout/paginate.js';
import { DOCUMENT_LABEL } from './focus/regions.js';
import type { ZoomPreset } from '../../shared/zoom.js';

interface PageAreaProps {
  tabId: string;
  kind?: 'document' | 'settings';
  state: EditorState;
  viewMode: 'pages' | 'pageless';
  orientation?: 'portrait' | 'landscape';
  margins: PageMargins;
  header?: JsonObject;
  footer?: JsonObject;
  bandEdit?: BandEdit | null;
  zoom?: ZoomPreset;
  onChange: (tabId: string, state: EditorState) => void;
  onPageLabel: (label: string) => void;
  onBandEdit?: (part: 'header' | 'footer', page: number) => void;
  onBandClose?: (reason?: 'escape') => void;
  onBandChange?: (part: 'header' | 'footer', paragraph: JsonObject) => void;
  onBandMove?: (direction: 1 | -1) => void;
  find?: ReactNode;
}

export function PageArea({
  tabId,
  kind = 'document',
  state,
  viewMode,
  orientation = 'portrait',
  margins,
  header,
  footer,
  bandEdit = null,
  zoom = 100,
  onChange,
  onPageLabel,
  onBandEdit,
  onBandClose,
  onBandChange,
  onBandMove,
  find = null,
}: PageAreaProps) {
  if (kind === 'settings') {
    return (
      <section
        className="page-region"
        data-region="page"
        data-page="settings"
        role="tabpanel"
        id={`panel-${tabId}`}
        aria-label={DOCUMENT_LABEL}
        tabIndex={-1}
      >
        <h1 className="settings-title">Settings</h1>
      </section>
    );
  }
  return (
    <section
      className="page-area"
      data-region="page"
      role="tabpanel"
      id={`panel-${tabId}`}
      aria-labelledby={`tab-${tabId}`}
    >
      {find}
      <div
        className="page-region"
        data-page-view={viewMode}
        style={{ '--page-zoom': String(zoom / 100) } as CSSProperties}
      >
        <EditorCore
          key={tabId}
          tabId={tabId}
          state={state}
          viewMode={viewMode}
          orientation={orientation}
          margins={margins}
          header={header}
          footer={footer}
          bandEdit={bandEdit}
          zoom={zoom}
          onChange={onChange}
          onPageLabel={onPageLabel}
          onBandEdit={onBandEdit}
          onBandClose={onBandClose}
          onBandChange={onBandChange}
          onBandMove={onBandMove}
        />
      </div>
    </section>
  );
}
