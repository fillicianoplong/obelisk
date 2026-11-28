import { useEffect, useState } from 'react';
import { APP_VERSION } from '../../../shared/app-version.js';
import { BUNDLED_FONT_FAMILIES } from '../../../shared/fonts/manifest.js';
import { ABOUT_NOTICES, type AboutNotice } from './notices.js';

interface NoticeState {
  readonly notice: AboutNotice;
  readonly text: string;
  readonly error?: string;
}

async function loadText(path: string): Promise<string> {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Could not load ${path}.`);
  }
  return response.text();
}

async function loadNotice(notice: AboutNotice): Promise<string> {
  const primary = await loadText(notice.noticePath);
  if (notice.fullTextPath === undefined) {
    return primary;
  }
  const full = await loadText(notice.fullTextPath);
  return `${primary.trim()}\n\n${full.trim()}\n`;
}

export function AboutView() {
  const [notices, setNotices] = useState<NoticeState[] | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [expandedFont, setExpandedFont] = useState<string | null>(null);
  const [fontLicenseText, setFontLicenseText] = useState<Record<string, string>>({});

  useEffect(() => {
    let active = true;
    void (async () => {
      const loaded = await Promise.all(
        ABOUT_NOTICES.map(async (notice) => {
          try {
            const text = await loadNotice(notice);
            return { notice, text };
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { notice, text: '', error: message };
          }
        }),
      );
      if (active) {
        setNotices(loaded);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="about-page">
      <header className="about-header">
        <h1 className="about-title">About Obelisk</h1>
        <p className="about-version">Version {APP_VERSION}</p>
        <p className="about-tagline">
          Obelisk is a Windows document editor by Filliciano Plong.
        </p>
      </header>

      <section className="about-section" aria-labelledby="about-fonts-heading">
        <h2 id="about-fonts-heading" className="about-section-title">Bundled fonts</h2>
        <p className="about-lede">
          Each font ships under the SIL Open Font License. License text lives next to the font files in the app package.
        </p>
        <ul className="about-font-list">
          {BUNDLED_FONT_FAMILIES.map((row) => {
            const open = expandedFont === row.family;
            return (
              <li key={row.family} className="about-font-item">
                <button
                  type="button"
                  className="about-font-toggle"
                  aria-expanded={open}
                  onClick={() => {
                    const next = open ? null : row.family;
                    setExpandedFont(next);
                    if (next !== null && fontLicenseText[row.licenseFile] === undefined) {
                      void loadText(`/fonts/${row.licenseFile}`).then((text) => {
                        setFontLicenseText((current) => ({ ...current, [row.licenseFile]: text }));
                      }).catch(() => {
                        setFontLicenseText((current) => ({
                          ...current,
                          [row.licenseFile]: `Could not load /fonts/${row.licenseFile}.`,
                        }));
                      });
                    }
                  }}
                >
                  <span className="about-font-family">{row.family}</span>
                  <span className="about-font-license">{row.licenseFile}</span>
                </button>
                {open ? (
                  <pre className="about-notice-text about-font-license-text">
                    {fontLicenseText[row.licenseFile] ?? 'Loading…'}
                  </pre>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="about-section" aria-labelledby="about-notices-heading">
        <h2 id="about-notices-heading" className="about-section-title">Open-source notices</h2>
        {notices === null ? (
          <p className="about-lede">Loading notices…</p>
        ) : (
          <ul className="about-notice-list">
            {notices.map(({ notice, text, error }) => {
              const open = expanded === notice.id;
              return (
                <li key={notice.id} className="about-notice-item">
                  <button
                    type="button"
                    className="about-notice-toggle"
                    aria-expanded={open}
                    onClick={() => setExpanded(open ? null : notice.id)}
                  >
                    <span className="about-notice-name">{notice.name}</span>
                    <span className="about-notice-meta">{notice.licenseId}</span>
                  </button>
                  {open ? (
                    <>
                      {notice.sourceUrl !== undefined ? (
                        <p className="about-source-link">
                          Source:{' '}
                          <a href={notice.sourceUrl}>{notice.sourceUrl}</a>
                        </p>
                      ) : null}
                      <pre className="about-notice-text">
                        {error !== undefined ? error : text}
                      </pre>
                    </>
                  ) : (
                    <p className="about-notice-summary">{notice.summary}</p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}