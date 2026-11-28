import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { RecentsListEntry } from '../../../shared/ipc/types.js';
import iconUrl from '../../../../packaging/icons/sources/slash-window-16.svg';
import '../page-setup/page-setup.css';
import './start.css';

interface StartPageProps {
  onNew: () => void;
  onOpen: () => void;
  onOpenRecent: (id: string) => void;
}

async function loadRecents(): Promise<RecentsListEntry[]> {
  const result = await window.obelisk['recents:list']();
  if (result.status !== 'ok') {
    return [];
  }
  return result.entries;
}

export function StartPage({ onNew, onOpen, onOpenRecent }: StartPageProps) {
  const titleId = useId();
  const recentsLegendId = useId();
  const newButtonRef = useRef<HTMLButtonElement>(null);
  const [recents, setRecents] = useState<RecentsListEntry[] | null>(null);

  const refresh = useCallback(() => {
    void loadRecents().then((entries) => {
      setRecents(entries);
    });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    newButtonRef.current?.focus();
  }, []);

  return (
    <section
      className="start-page"
      data-region="page"
      data-page="start"
      aria-labelledby={titleId}
      tabIndex={-1}
    >
      <div className="start-panel">
        <img className="start-brand-icon" src={iconUrl} alt="" width={32} height={32} />
        <header className="start-header">
          <h1 className="start-title" id={titleId}>
            Obelisk
          </h1>
          <p className="start-lede">Create a document or open a file to begin.</p>
        </header>

        <div className="start-actions">
          <button
            type="button"
            ref={newButtonRef}
            className="page-setup-button page-setup-button-ok start-action-primary"
            onClick={onNew}
          >
            New document
          </button>
          <button type="button" className="page-setup-button start-action-secondary" onClick={onOpen}>
            Open…
          </button>
        </div>

        <section className="start-recents" aria-labelledby={recentsLegendId}>
          <h2 className="start-recents-heading" id={recentsLegendId}>
            Recent
          </h2>
          {recents === null ? (
            <p className="start-recents-empty">Loading recent files…</p>
          ) : recents.length === 0 ? (
            <p className="start-recents-empty">No recent files yet.</p>
          ) : (
            <ul className="start-recents-list">
              {recents.map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    className="start-recent-item"
                    onClick={() => onOpenRecent(entry.id)}
                  >
                    <span className="start-recent-name">{entry.name}</span>
                    <span className="start-recent-path">{entry.location}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </section>
  );
}