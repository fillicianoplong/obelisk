import type { CSSProperties, ReactNode } from 'react';
import type { EditorState } from 'prosemirror-state';
import { EditorCore } from '../editor/EditorCore.js';
import type { PageMargins } from '../editor/layout/paginate.js';
import { DOCUMENT_LABEL } from './focus/regions.js';
import type { ZoomPreset } from '../../shared/zoom.js';

interface PageAreaProps {
  tabId: string;
  kind?: 'document' | 'settings';
  state: EditorState;
  viewMode: 'pages' | 'pageless';
  margins: PageMargins;
  zoom?: ZoomPreset;
  onChange: (tabId: string, state: EditorState) => void;
  onPageLabel: (label: string) => void;
  find?: ReactNode;
}

export function PageArea({
  tabId,
  kind = 'document',
  state,
  viewMode,
  margins,
  zoom = 100,
  onChange,
  onPageLabel,
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
          margins={margins}
          zoom={zoom}
          onChange={onChange}
          onPageLabel={onPageLabel}
        />
      </div>
    </section>
  );
}
