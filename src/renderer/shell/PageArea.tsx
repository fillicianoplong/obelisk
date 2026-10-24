import { useEffect, useRef } from 'react';

interface PageAreaProps {
  tabId: string;
  text: string;
  onText: (text: string) => void;
}

export function PageArea({ tabId, text, onText }: PageAreaProps) {
  const editorRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const editor = editorRef.current;
    if (editor === null) {
      return;
    }
    editor.focus();
    const end = editor.value.length;
    editor.setSelectionRange(end, end);
  }, [tabId]);

  return (
    <section
      className="page-region"
      data-region="page"
      role="tabpanel"
      id={`panel-${tabId}`}
      aria-labelledby={`tab-${tabId}`}
    >
      <textarea
        key={tabId}
        ref={editorRef}
        className="page-sheet"
        data-region="page-editor"
        aria-label="Page"
        defaultValue={text}
        spellCheck
        onChange={(event) => {
          onText(event.target.value);
        }}
      />
    </section>
  );
}
