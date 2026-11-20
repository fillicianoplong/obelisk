import type { ReactNode } from 'react';
import type { EditorState } from 'prosemirror-state';
import { EditorCore } from '../editor/EditorCore.js';
import { DOCUMENT_LABEL } from './focus/regions.js';

interface PageAreaProps {
  tabId: string;
  kind?: 'document' | 'settings';
  state: EditorState;
  onChange: (tabId: string, state: EditorState) => void;
  find?: ReactNode;
}

export function PageArea({ tabId, kind = 'document', state, onChange, find = null }: PageAreaProps) {
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
      <div className="page-region">
        <EditorCore key={tabId} tabId={tabId} state={state} onChange={onChange} />
      </div>
    </section>
  );
}
