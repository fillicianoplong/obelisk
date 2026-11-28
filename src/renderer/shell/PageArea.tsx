import type { CSSProperties, ReactNode } from 'react';
import type { EditorState } from 'prosemirror-state';
import type { JsonObject } from '../../shared/ipc/types.js';
import { EditorCore } from '../editor/EditorCore.js';
import type { BandEdit } from '../editor/header/PageBands.js';
import type { PageMargins } from '../editor/layout/paginate.js';
import type { PagelessWidth } from '../../shared/pageless-width.js';
import { AboutView } from './about/AboutView.js';
import { DOCUMENT_LABEL } from './focus/regions.js';
import type { ZoomPreset } from '../../shared/zoom.js';
import { PreferencesPanel } from './preferences/PreferencesPanel.js';

interface PageAreaProps {
  tabId: string;
  kind?: 'document' | 'settings' | 'about';
  state: EditorState;
  viewMode: 'pages' | 'pageless';
  pagelessWidth?: PagelessWidth;
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
  onShowPageEdgesChange?: (enabled: boolean) => void;
  onSpellingPrefChange?: (enabled: boolean) => void;
}

export function PageArea({
  tabId,
  kind = 'document',
  state,
  viewMode,
  pagelessWidth = 'medium',
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
  onShowPageEdgesChange,
  onSpellingPrefChange,
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
        <PreferencesPanel
          onShowPageEdgesChange={onShowPageEdgesChange}
          onSpellingChange={onSpellingPrefChange}
        />
      </section>
    );
  }
  if (kind === 'about') {
    return (
      <section
        className="page-region page-region-about"
        data-region="page"
        data-page="about"
        role="tabpanel"
        id={`panel-${tabId}`}
        aria-label="About Obelisk"
        tabIndex={-1}
      >
        <AboutView />
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
        data-pageless-width={viewMode === 'pageless' ? pagelessWidth : undefined}
        style={{ '--page-zoom': String(zoom / 100) } as CSSProperties}
      >
        <EditorCore
          key={tabId}
          tabId={tabId}
          state={state}
          viewMode={viewMode}
          pagelessWidth={pagelessWidth}
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
