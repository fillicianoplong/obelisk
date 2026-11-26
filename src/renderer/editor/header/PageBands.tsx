import { useId, useRef, useState } from 'react';
import type { JsonObject } from '../../../shared/ipc/types.js';
import { HeaderEditor, type HeaderEditorApi } from './HeaderEditor.js';
import { HeaderText } from './HeaderText.js';
import { headerHasContent } from './mapping.js';
import type { PageFieldFormat } from './page-field.js';

export interface BandEdit {
  part: 'header' | 'footer';
  page: number;
}

interface PageBandsProps {
  page: number;
  pageCount: number;
  header: JsonObject;
  footer: JsonObject;
  editing: BandEdit | null;
  headerOffsetPx: number;
  headerGapPx: number;
  footerGapPx: number;
  marginLeftPx: number;
  marginRightPx: number;
  onEdit: (part: 'header' | 'footer', page: number) => void;
  onClose: (reason?: 'escape') => void;
  onChange: (part: 'header' | 'footer', paragraph: JsonObject) => void;
  onMove: (direction: 1 | -1) => void;
}

const FORMATS: readonly { id: PageFieldFormat; label: string }[] = [
  { id: 'decimal', label: '1, 2, 3' },
  { id: 'roman', label: 'i, ii, iii' },
  { id: 'page-of-n', label: 'Page 1 of N' },
];

export function PageBands({
  page,
  pageCount,
  header,
  footer,
  editing,
  headerOffsetPx,
  headerGapPx,
  footerGapPx,
  marginLeftPx,
  marginRightPx,
  onEdit,
  onClose,
  onChange,
  onMove,
}: PageBandsProps) {
  return (
    <>
      <Band
        part="header"
        page={page}
        pageCount={pageCount}
        paragraph={header}
        editing={editing}
        style={{
          top: `${headerOffsetPx}px`,
          left: `${marginLeftPx}px`,
          right: `${marginRightPx}px`,
          minHeight: `${headerGapPx}px`,
        }}
        onEdit={onEdit}
        onClose={onClose}
        onChange={onChange}
        onMove={onMove}
      />
      <Band
        part="footer"
        page={page}
        pageCount={pageCount}
        paragraph={footer}
        editing={editing}
        style={{
          bottom: `${headerOffsetPx}px`,
          left: `${marginLeftPx}px`,
          right: `${marginRightPx}px`,
          minHeight: `${footerGapPx}px`,
        }}
        onEdit={onEdit}
        onClose={onClose}
        onChange={onChange}
        onMove={onMove}
      />
    </>
  );
}

function Band({
  part,
  page,
  pageCount,
  paragraph,
  editing,
  style,
  onEdit,
  onClose,
  onChange,
  onMove,
}: {
  part: 'header' | 'footer';
  page: number;
  pageCount: number;
  paragraph: JsonObject;
  editing: BandEdit | null;
  style: { top?: string; bottom?: string; left: string; right: string; minHeight?: string };
  onEdit: (part: 'header' | 'footer', page: number) => void;
  onClose: (reason?: 'escape') => void;
  onChange: (part: 'header' | 'footer', paragraph: JsonObject) => void;
  onMove: (direction: 1 | -1) => void;
}) {
  const apiRef = useRef<HeaderEditorApi | null>(null);
  const [menu, setMenu] = useState<{ checked: PageFieldFormat | null } | null>(null);
  const menuId = useId();
  const active = editing?.part === part && editing.page === page;
  const mirror = editing?.part === part && editing.page !== page;
  const label = part === 'header' ? 'Header' : 'Footer';
  const empty = !headerHasContent(paragraph);

  function openMenu(): void {
    setMenu({ checked: apiRef.current?.selectedPageFormat() ?? null });
  }

  function choose(format: PageFieldFormat): void {
    apiRef.current?.insertField('page', format);
    setMenu(null);
    apiRef.current?.focus();
  }

  return (
    <div
      className={`page-band page-band-${part}`}
      style={style}
      data-page-part={part}
      data-page-band-page={page}
      data-editing={active ? 'true' : undefined}
      data-mirror={mirror ? 'true' : undefined}
      data-empty={empty ? 'true' : undefined}
      onMouseDown={(event) => {
        if (active) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        onEdit(part, page);
      }}
    >
      <div className="page-band-chrome">
        <span className="page-band-label" data-band-label={label} />
        {active ? <span className="page-band-rule" aria-hidden="true" /> : null}
        {active ? (
          <div className="page-band-bar">
            <button
              type="button"
              className="page-band-button"
              data-insert-page-number=""
              aria-expanded={menu !== null}
              aria-controls={menu !== null ? menuId : undefined}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={openMenu}
            >
              Page number
              <span aria-hidden="true"> ▾</span>
            </button>
            <button
              type="button"
              className="page-band-button"
              data-insert-page-count=""
              onMouseDown={(event) => event.stopPropagation()}
              onClick={() => {
                apiRef.current?.insertField('pages', 'decimal');
                setMenu(null);
                apiRef.current?.focus();
              }}
            >
              Page count
            </button>
            <button
              type="button"
              className="page-band-button"
              data-insert-close=""
              onMouseDown={(event) => event.stopPropagation()}
              onClick={() => onClose()}
            >
              Close
            </button>
            {menu !== null ? (
              <div
                id={menuId}
                className="page-field-menu"
                role="menu"
                data-page-field-menu=""
                onMouseDown={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    setMenu(null);
                    apiRef.current?.focus();
                  }
                }}
              >
                {FORMATS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="menuitemradio"
                    className="page-field-menu-item"
                    aria-checked={menu.checked === item.id}
                    data-field-format={item.id}
                    onClick={() => choose(item.id)}
                  >
                    <span className="page-field-menu-check" aria-hidden="true">
                      {menu.checked === item.id ? '✓' : ''}
                    </span>
                    {item.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="page-band-hit">
        <div
          className="page-band-text"
          data-align={typeof paragraph.align === 'string' ? paragraph.align : 'left'}
        >
          {active ? (
            <HeaderEditor
              paragraph={paragraph}
              page={page}
              pageCount={pageCount}
              onChange={(next) => onChange(part, next)}
              onClose={onClose}
              onMove={onMove}
              onFieldMenu={() => openMenu()}
              apiRef={apiRef}
            />
          ) : (
            <HeaderText paragraph={paragraph} page={page} total={pageCount} />
          )}
        </div>
      </div>
    </div>
  );
}
