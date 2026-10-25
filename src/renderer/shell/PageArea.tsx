import type { EditorState } from 'prosemirror-state';
import { EditorCore } from '../editor/EditorCore.js';

interface PageAreaProps {
  tabId: string;
  state: EditorState;
  onChange: (tabId: string, state: EditorState) => void;
}

export function PageArea({ tabId, state, onChange }: PageAreaProps) {
  return (
    <section
      className="page-region"
      data-region="page"
      role="tabpanel"
      id={`panel-${tabId}`}
      aria-labelledby={`tab-${tabId}`}
    >
      <EditorCore key={tabId} tabId={tabId} state={state} onChange={onChange} />
    </section>
  );
}
