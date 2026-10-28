# Architecture and Design: Obelisk

Prepared by: Filliciano Plong · Date: October 26, 2026 · Version: 1.2

**Readers:** Filliciano Plong, sole developer. Helps decide module boundaries, the save path, and the export pipeline before code starts.

## Contents

- [Revision history](#revision-history)
- [1. Context and scope](#1-context-and-scope)
- [2. Goals and constraints](#2-goals-and-constraints)
- [3. Quality-attribute scenarios](#3-quality-attribute-scenarios)
- [4. Architectural style](#4-architectural-style)
- [5. Architecture views](#5-architecture-views)
- [6. Behavior and contract](#6-behavior-and-contract)
- [7. Architecture decisions](#7-architecture-decisions)
- [8. Risks](#8-risks)
- [9. Technology stack](#9-technology-stack)
- [10. Traceability](#10-traceability)
- [11. Open decisions](#11-open-decisions)
- [12. Maintenance and references](#12-maintenance-and-references)

## Revision history

| Version | Date | Changes |
|---|---|---|
| 1.0 | October 23, 2026 | First release of the architecture. |
| 1.1 | October 23, 2026 | Applied the design, data model, and security review fixes. Based on SRS 1.1. |
| 1.2 | October 26, 2026 | Added ADR-012 (docx for Word export) and ADR-013 (yauzl and yazl for .obk files). Set the Word file and ZIP rows in the stack table. Added spike S-09 and widened S-08. Based on SRS 1.2. |

## 1. Context and scope

This document shows how Obelisk will meet its SRS. It cites requirement IDs from the SRS (Plong_Obelisk_SRS.docx, version 1.2) instead of repeating them.

Everything here is a proposal until accepted. Technology versions marked UNVERIFIED stay so until the spikes in section 9 confirm them.

### 1.1 Actors

| Actor | Role |
|---|---|
| User | Writes, saves, prints, and exports documents; one person in the student or professional role. |
| Windows | File Explorer, Open and Save dialogs, print spooler, clipboard, spell checker, DPAPI. |
| Microsoft Store | Installs, signs, and updates the MSIX package. |

### 1.2 External dependencies

- Electron (Chromium and Node.js), React, TypeScript.
- A ProseMirror-based editor core (proposal, ADR-004).
- KaTeX for formulas; mathml2omml for Word equations (Should); docx for Word files (ADR-012).
- yauzl and yazl for reading and writing .obk files (ADR-013).
- Mermaid for the diagram block (Should, OD-05).
- Bundled fonts: the LibreOffice Latin set plus Dancing Script (OD-08).

### 1.3 Included and excluded

**Included:** SRS sections 6 and 7: every FR and NFR, Must and Should.

**Excluded:** The SRS out-of-scope list (section 2.2) and future features (section 13).

## 2. Goals and constraints

### 2.1 Top quality goals

| Rank | Goal | Requirements |
|---|---|---|
| 1 | No lost or half-written files | NFR-10, NFR-11, NFR-12, NFR-13, NFR-14 |
| 2 | Fast typing and opening in long documents | NFR-01, NFR-02, NFR-03, NFR-04 |
| 3 | Safe with untrusted files and pastes | NFR-06, NFR-07, FR-09, FR-36 |
| 4 | Faithful print and export | FR-62, FR-63, FR-64, FR-56 |

### 2.2 Constraints

| Constraint | Source |
|---|---|
| Electron, React, and TypeScript | Developer decision |
| Microsoft Store MSIX is the only release channel | Developer decision; ADR-008 |
| Solo developer; Shoulds cut in the SRS drop order | Project plan |
| English interface; Letter paper | SRS section 5 |
| mathml2omml is LGPL and ships as a separate module | NFR-29 |

## 3. Quality-attribute scenarios

Each scenario names a stimulus and environment, the expected response, a measure, and how it is checked.

| ID | Stimulus and environment | Response and measure | Verification | IDs | Component |
|---|---|---|---|---|---|
| QS-01 | User types in a 50-page document with tables and formulas, on the reference machine. | Character shows within 50 ms; formulas re-render only when their source changes. | Test: input-latency trace | NFR-01, NFR-02 | EditorCore, FormulaRenderer |
| QS-02 | The app is ended or power is lost during Save or autosave of a large file. | The target holds the old bytes or the complete new file; 20 of 20 runs. | Test: kill during save | NFR-10, NFR-12, NFR-14 | FileService |
| QS-03 | User opens a crafted .obk file, or pastes HTML with scripts and remote images. | Nothing runs and no request is sent; a bad file opens nothing and stays unchanged. | Test: hostile sample set (section 6.10) under Node and in the app | FR-09, FR-36, NFR-06, NFR-07 | FormatCodec, ClipboardBridge |
| QS-04 | Another program changes an open file, then autosave fires. | Autosave is skipped; the user chooses Overwrite, Save As, or Cancel; nothing is overwritten silently. | Test: change the file in Notepad | FR-13, FR-15 | AutosaveService, FileService |
| QS-05 | User exports a document with 20 formulas to Word. | Each formula is an editable equation, or an image if conversion fails; done within 10 s. | Test: open in Word | FR-56, FR-57, NFR-04 | ExportService |
| QS-06 | Another Windows user on the same PC reads Obelisk's app data. | Saved signatures are unreadable without the owner's DPAPI key. Other apps of the same user are out of scope. | Inspection: read the file as another user | NFR-08, NFR-09 | SignatureStore |
| QS-07 | A script runs in a renderer (an assumed bug) and calls the IPC bridge with made-up handles, IDs, and documents. | Main refuses what it did not issue; nothing outside user-picked files and app data is read, written, or deleted. | Test: fake renderer under Node (H-30) | NFR-07, NFR-22 | IPC bridge, FileService |

## 4. Architectural style

Local-first modular monolith. One Electron main process owns all file, print, and export work. One sandboxed renderer per window owns the editor. They talk only over a narrow, typed IPC bridge exposed by the preload script. Every disk write goes through one tested helper (ADR-001, ADR-002). Untrusted content stays away from Node, and no server is needed, which matches NFR-05.

| Component | Process | Responsibility |
|---|---|---|
| Shell and Tabs | Renderer | Window regions, menus, tab strip, status bar (including Autosave paused), Preferences and About tabs, prompts. |
| EditorCore | Renderer | Document model, typing, shortcuts, slash menu, undo, selection, block moves, find and replace, page layout. New block IDs on paste and duplicate. |
| BlockViews | Renderer | Views for tables (with the TableMath module), images, columns, drawing, signatures, date chips, and diagrams (Mermaid, strict). Makes first-frame PNGs of animated images for export. |
| FormulaRenderer | Renderer | KaTeX rendering with fixed settings (section 6.4), live preview, errors; MathML and PNG for export. |
| ClipboardBridge | Renderer | Copy and paste of blocks. Pasted HTML is parsed inert and mapped into the schema; pasted Obelisk blocks are checked like an opened file. |
| AutosaveService | Renderer | Per-tab 30 s timer after the last edit. Saved tabs: calls file:save like Ctrl+S. Never-saved tabs: sends recovery:put. Pauses on conflict. |
| IPC bridge | Preload | The only path from renderer to main: named, typed calls. Main checks the sender and every argument; handles, never paths. |
| FileService | Main | Open, Save, and Export dialogs; the handle-to-path map; disk-change check; file activation and session restore; the shared atomic-write helper writeAtomic. |
| FormatCodec | Main | Encode and decode .obk files: archive caps, entry allowlist, schema, limits, image headers, and version conversion. Runs under Node. |
| ExportService | Main | Print, PDF, Word, and Markdown exporters behind one interface, export(format, document, assets, target); writes through writeAtomic. |
| SignatureStore | Main | Saved signatures: one PNG per file, encrypted with the async safeStorage API; writes through writeAtomic. |
| PreferencesStore | Main | Preferences and the session in app data; bad values fall back to defaults; writes through writeAtomic. |
| RecoveryService | Main | Recovery copies of never-saved tabs in app data, named by UUIDs that main makes; checked by FormatCodec on restore. |

## 5. Architecture views

Each view is a PlantUML source in docs/diagrams/. Component names match the table in section 4.

### 5.1 Use case view

![Obelisk use cases](images/01-use-case.png)

*Figure 1. Obelisk use cases*

**Purpose:** Shows who uses Obelisk for what; details are in SRS section 8.

**Assumption:** One user; Windows and the Store are supporting actors.

**Limitation:** No flows or errors; see the sequences.

### 5.2 Component view

![Components and dependencies](images/02-component.png)

*Figure 2. Components and dependencies*

**Purpose:** Shows which component owns each responsibility, the one path to disk, and who uses writeAtomic.

**Assumption:** One window with many tabs; one renderer per window.

**Limitation:** Sub-modules such as TableMath and the exporters are not drawn.

### 5.3 Sequence: save and autosave

![Save and autosave, with conflict, timeout, and error](images/03-sequence-save.png)

*Figure 3. Save and autosave, with conflict, timeout, and error*

**Purpose:** Shows the critical write path and its failure branches.

**Assumption:** The target is on a local NTFS disk; main finds the path from the tab handle.

**Limitation:** Save As and the first Save add the Save dialog and the replace prompt before this flow.

### 5.4 Sequence: export to Word

![Word export with equation fallback](images/03-sequence-export-word.png)

*Figure 4. Word export with equation fallback*

**Purpose:** Shows how formulas reach Word as equations or images, through the IPC bridge.

**Assumption:** KaTeX MathML and PNGs are made in the renderer, where KaTeX runs.

**Limitation:** Other blocks are mapped per the SRS Export reference; other results are in section 6.3.

### 5.5 Class view

![Document domain model](images/04-class.png)

*Figure 5. Document domain model*

**Purpose:** Shows the manifest, the document, and every block kind stored in an .obk file.

**Assumption:** Format version 1 (OD-02); fields are in section 6.5.

**Limitation:** Lists, quotes, code, and headings are shown as TextBlock; inline items are not drawn.

### 5.6 Deployment view

![Deployment on a Windows PC](images/05-deployment.png)

*Figure 6. Deployment on a Windows PC*

**Purpose:** Shows where each artifact lives and which folders MSIX redirects.

**Assumption:** Per-user MSIX install from the Store.

**Limitation:** MSIX redirection of app data is from Microsoft docs, not yet tested here.

**UNVERIFIED:** MSIX redirects writes to app data but not to user folders such as Documents. Check in spike S-01; source: Microsoft MSIX docs.

### 5.7 Screen flow

![Screen flow](images/06-screen-flow.png)

*Figure 7. Screen flow*

**Purpose:** Shows how the user moves between the editor, dialogs, and tabs.

**Assumption:** Preferences and About open as tabs, not windows.

**Limitation:** Menus and context menus are not drawn.

### 5.8 State machine: document

![Document save states](images/07-state-document.png)

*Figure 8. Document save states*

**Purpose:** Shows the save state of one tab and when autosave applies.

**Assumption:** One tab per document; edits during a save are allowed.

**Limitation:** Recovery copies are a NeverSaved self-transition; Autosave paused is a flag, not a state.

## 6. Behavior and contract

The critical operation is saving a document (FR-10, FR-11, FR-14). Figure 3 shows the flow. Sections 6.5 to 6.10 set the file format and the checks on untrusted input.

### 6.1 Save contract

| Field | Rule |
|---|---|
| Operation | file:save, called by Save, Save As, and the renderer's autosave timer; one path (ADR-002) |
| Inputs | Tab handle; document model; revision number; expected stat (size and modified time) or none; replaceConfirmed |
| Authorization | Main maps the handle to a path it issued from a dialog, an activation, or the session. Any other handle returns PATH_NOT_ALLOWED |
| Validation | Main checks the document against the schema and limits (sections 6.5 and 6.6) before encoding; a failure returns ENCODE_FAILED and writes nothing |
| Before writing | stat the target. A changed stat returns conflict. A new target that exists without replaceConfirmed returns exists |
| Atomicity | writeAtomic: a temp file `.~obk-<128-bit hex>.tmp` in the same folder, made with exclusive create, then flush and one rename over the target |
| Timeout | 5 s (NFR-11), checked just before the rename. Past the deadline, the temp file is removed and nothing is renamed. A rename that has started finishes and returns ok |
| Retry | On EPERM or EBUSY during the rename (antivirus, indexer): 3 tries, 100 ms apart, then EBUSY_EXHAUSTED |
| Outputs | ok with the new stat and the saved revision; conflict with the current stat; exists; timeout (retryable); error with code, message, and retryable |
| Error codes | ENOSPC, EBUSY_EXHAUSTED (retryable); EACCES, ENOENT, PATH_NOT_ALLOWED, ENCODE_FAILED (not retryable) |
| State changes | Saving to Clean on ok only if the revision is unchanged, else Changed. Timeout or error: back to Changed, or NeverSaved after a failed first save |
| Autosave | Same call with the tab handle. On conflict it shows the choice once, pauses autosave for that tab, and the status bar shows Autosave paused. It resumes after the next successful Save, Overwrite, or Save As |
| Cleanup | On launch and after each save, only files matching the temp pattern and older than 10 minutes are removed (NFR-14) |

**UNVERIFIED:** That fs.rename over an existing file maps to an atomic replace (MoveFileEx with replace) on NTFS from an MSIX-packaged app. Check in spike S-01; source: Node.js fs docs and libuv.

### 6.2 Alternatives

| Case | Trigger | Result |
|---|---|---|
| Conflict | Another program changed the file | Return conflict; the user picks Overwrite (save with the new stat), Save As, or Cancel |
| Exists | A new target exists and the replace was not confirmed | Return exists; write nothing; file:saveAs shows the replace prompt and calls again after Replace |
| Timeout | No completion within 5 s (slow or network folder) | Return timeout; tab stays changed; status bar says Not saved; Retry offered |
| Error | Disk full, access denied, path gone, retries used up, document fails the schema | Return error with its code; temp file removed; Retry offered when retryable |
| Not allowed | A handle main did not issue, or one for a closed tab | Return error PATH_NOT_ALLOWED; nothing is read or written |
| Cancelled | The user cancels the Save dialog or the replace prompt | Return cancelled; a never-saved tab stays NeverSaved |

### 6.3 IPC surface

| Channel | Direction | Payload | Results |
|---|---|---|---|
| `file:open` | R to M | None; main shows the Open dialog | ok with handle, name, document, stat; cancelled; refused with reason and message; error; alreadyOpen with tabId |
| `file:save` | R to M | Handle, document, revision, expected stat | ok, conflict, exists, timeout, error (section 6.1) |
| `file:saveAs` | R to M | Handle or none, document, revision | Main shows the Save dialog and replace prompt, then saves: file:save results with a new handle and name, or cancelled |
| `file:activated` | M to R | One file:open result per file: double-click, second instance, or session restore | None |
| `session:set` | R to M | Handles in tab order, active handle | ok; main stores paths only while Restore tabs is on |
| `export:run` | R to M | Format, handle or none, document, assets: MathML, formula PNGs, first-frame PNGs | ok with name and formulasAsImages; cancelled; error; timeout after 60 s |
| `print:run` | R to M | Document, assets | ok; cancelled; error |
| `prefs:get, prefs:set` | R to M | Key, value | Values; refused for an unknown key or bad value |
| `sig:list` | R to M | None | ok with IDs and names only; unavailable with a message |
| `sig:get` | R to M | Signature ID | ok with the PNG; unavailable; notFound |
| `sig:save` | R to M | Name, PNG | ok with the new ID; unavailable; limitReached; refused with reason; error |
| `sig:delete` | R to M | Signature ID | ok; notFound |
| `recovery:put` | R to M | Recovery ID or none, document, first line | ok with the recovery ID; error |
| `recovery:list` | R to M | None | IDs, first lines, and times, from the metadata records only |
| `recovery:restore` | R to M | Recovery ID | file:open results, as a never-saved tab; refused offers Discard only |
| `recovery:drop` | R to M | Recovery ID | ok; notFound |
| `link:open` | R to M | Address | ok after the user confirms; cancelled; refused for a scheme off the allowlist |

R to M: renderer to main. M to R: main to renderer. Every error carries a code, a message, and retryable. Handles and IDs are made by main and looked up in its own lists; the renderer never sends a path.

### 6.4 Security baseline

These settings follow the Electron security checklist.

- contextIsolation on, sandbox on, nodeIntegration off in every renderer, including the hidden window used for print and PDF.
- The app loads from its own app: protocol, not file://.
- Content Security Policy: default-src 'none'; scripts, styles, and fonts from app: only; images from app:, data:, and blob:; no connect, frame, or object sources.
- A session-wide request filter in main cancels every request that is not app:, data:, or blob:. No crash reporter or updater runs; the Store updates the app.
- Every permission request is denied. Navigation, new windows, and webview tags are blocked.
- Links: only http, https, and mailto, checked on load, paste, and Ctrl+K, and again in main before opening. The prompt shows the full address (OD-20).
- The IPC bridge exposes named functions only. Main checks that each message comes from the app's own frame, validates every argument, and never passes the raw event to the renderer.
- The renderer never sends a path. Main shows every file dialog, keeps a handle-to-path map, and makes every recovery and signature ID itself.
- Documents are decoded from JSON into the schema; no stored HTML is ever rendered. KaTeX and Mermaid output enters the page only through FormulaRenderer and BlockViews.
- Command-line arguments: only existing regular .obk files are taken, up to 20 per launch; other arguments are ignored.
- Electron fuses runAsNode and nodeCliInspect are off, checked in the build.
- Dependencies are pinned by a lockfile and audited in every build. An Electron security release ships to the Store within 30 days (target).

Library settings for untrusted formula and diagram source:

| Library | Setting | Why |
|---|---|---|
| KaTeX | trust false, set explicitly | Keeps \\href, \\url, \\includegraphics, and the HTML commands off |
| KaTeX | maxSize 50, maxExpand 1000 | Caps rule and box sizes, and macro expansion |
| KaTeX | throwOnError true | The editor shows KaTeX's own message (FR-55) |
| KaTeX | strict handler that refuses htmlExtension | HTML extensions are errors |
| KaTeX | A new, empty macros object for each render | A \\gdef in one formula cannot change another |
| Mermaid | securityLevel strict (OD-19) | HTML tags in diagram text are encoded; click handlers are off |
| Mermaid | startOnLoad false, htmlLabels false | Diagrams render only when BlockViews asks; labels are SVG text |
| Mermaid | secure list adds themeCSS, themeVariables, fontFamily, htmlLabels, dompurifyConfig, theme | An init directive in a diagram cannot change them |
| Mermaid | maxTextSize 50,000 and maxEdges left at their defaults | Caps the work per diagram |

**UNVERIFIED:** Which style-src KaTeX output needs under this policy, and whether Mermaid strict output needs any. Check in spike S-04.

**UNVERIFIED:** Fuses other than runAsNode and nodeCliInspect, and Mermaid's security advisories. Check when versions are pinned.

**UNVERIFIED:** How printToPDF sets up its window, how the parser used for pasted HTML treats scripts, and how custom clipboard formats behave. Check in the chosen Electron version.

**UNVERIFIED:** Decoding .obk files in a sandboxed utilityProcess instead of main. Check in spike S-08.

### 6.5 Document schema

Format version 1. One machine-readable schema file in the repository is the single source for FormatCodec, the editor schema, and the Node tests (NFR-21). Unknown fields are refused (FR-09).

**manifest.json**

| Field | Type | Rule |
|---|---|---|
| `format` | String | Must be obelisk |
| `formatVersion` | Integer | 1 up to this app's version; newer is refused (section 6.7) |
| `writer` | String | App version, such as 1.0.0; information only |
| `images` | List | One item per image entry; may be empty |
| `images: sha256` | String | 64 lowercase hex digits; matches the entry name and its bytes |
| `images: type` | png, jpeg, gif, webp | Matches the first bytes and the extension |
| `images: bytes` | Integer | 1 byte to 20 MB; matches the real size |
| `images: width, height` | Integer | 1 to 8000 pixels; matches the image header |
| `images: frames` | Integer | 1 for still images; up to 1,000 for animated GIF and WebP |

**document.json, top level**

| Field | Type | Rule |
|---|---|---|
| `view` | pages or pageless | Required |
| `page` | Orientation, margins in inches | Required; text width and height at least 2 in |
| `header, footer` | One paragraph each | Text with marks and page-number fields only; may be empty |
| `blocks` | List of blocks | Required; may be empty; up to 20,000 blocks in all |

**Blocks**

| Block | Fields | Rule |
|---|---|---|
| paragraph | Inline content; alignment; line spacing; space before and after; indents | First-line and hanging indents are not both set |
| heading | Level 1 to 6; inline content | None |
| list | Bulleted, numbered, or checklist; items with level 0 to 5, checked, content | checked only in checklists |
| quote, code | Inline content; code is plain text | Code has no marks |
| divider, pageBreak | No fields | pageBreak not inside column rows |
| table | Rows of cells; cell text or formula; column widths | Up to 200 by 26; cell up to 10,000 characters |
| image | sha256; width in inches; rotation 0, 90, 180, 270; flips; alt; drawing layer (Should) | sha256 is in the manifest |
| formula | LaTeX source | Up to 10,000 characters |
| columns (Should) | 2 to 4 columns; shares; blocks per column | No column rows or page breaks inside |
| drawing (Should) | Strokes of points, width, color; size | Up to 2,000 strokes and 100,000 points |
| signature (Should) | PNG sha256; line; width; label lines; alignment; blank mode | Label up to 100 characters per line, 2 lines |
| diagram (Should) | Mermaid source | Up to 50,000 characters |

**Inline content**

| Item | Fields | Rule |
|---|---|---|
| text | Text and marks: bold, italic, underline, strike, code, font, size, color | Up to 100,000 characters per block |
| link | Address and text | http, https, or mailto; up to 2,048 characters |
| inlineFormula | LaTeX source | Up to 10,000 characters |
| dateChip (Should) | Date and time as YYYY-MM-DDTHH:MM, no zone; format | Static; never updates on its own |
| pageField | page or pages; number format | Header and footer only |

**Units and IDs**

| Item | Rule |
|---|---|
| Lengths | Inches as decimal numbers, up to 3 places |
| Font size | Points, one of the sizes in the SRS Formatting reference, 8 to 72 |
| Colors | #RRGGBB |
| Strokes | Points in the block's own pixel space |
| IDs | Each block has an id: a random version 4 UUID in lowercase, unique in the file. Paste and duplicate make new IDs; a repeated ID is refused |

A block marked Should is removed from format 1 before release if its feature is cut, so no released file holds it.

### 6.6 File checks and limits

| Item | Limit |
|---|---|
| File on disk | 200 MB |
| Archive entries | 2,000 |
| document.json, uncompressed | 25 MB (OD-21) |
| Each image, uncompressed | 20 MB |
| All entries, uncompressed | 250 MB |
| Image size | 8000 by 8000 pixels, read from the header before decoding |
| Animated image | 1,000 frames; 250 million pixels across all frames; each frame inside the image size |
| Blocks, text, tables, formulas, diagrams, drawings | As in section 6.5 |
| Font family name; alt text | 1 to 64 characters; up to 500 characters |

Limits are targets, to tune against NFR-03 and NFR-02. Caps count the bytes actually read, not the sizes the archive headers claim.

- Entries are read as streams in memory and never unpacked to disk. A read stops as soon as a cap is passed.
- Only stored and deflate entries. Encrypted entries, multi-disk archives, and nested archives are refused. Central and local headers must agree.
- Only the exact names manifest.json, document.json, and images/ followed by 64 hex digits and .png, .jpg, .gif, or .webp. Folders, repeated names, and links are refused. This rules out backslashes, drive letters, network paths, and case duplicates.
- JSON: duplicate keys, unpaired surrogates, and numbers that are not finite are refused; a byte order mark is ignored. Writes use a fixed key order, so the same document gives the same bytes.
- Images: type from the first bytes; width, height, and frames from the header before decoding; SVG refused. Pixels are decoded only in the sandboxed renderer.
- Animated GIF and WebP: FormatCodec walks the GIF blocks or WebP chunks to count frames and read each frame's size, without decoding pixels. A file over a limit is refused (OD-18).
- The same checks run on open, on recovery and session restore, on pasted Obelisk blocks, and on every document main receives to save.

| Rule | Where enforced | How verified |
|---|---|---|
| Archive caps and entry allowlist | FormatCodec, on open and restore | H-01 to H-09 |
| Schema, unknown fields, duplicate keys, IDs | FormatCodec; EditorCore schema | H-10 to H-15 |
| Image type, size, and header | FormatCodec; ClipboardBridge on paste | H-16 to H-19 |
| Animated frames and pixel budget | FormatCodec; ClipboardBridge on paste | H-27 to H-29 |
| Link schemes | EditorCore; main before opening | H-20, H-21 |
| Formula and diagram settings | FormulaRenderer; BlockViews | H-22 to H-24 |
| Handles and IDs from main only | IPC bridge; FileService; RecoveryService; SignatureStore | H-25, H-30 |
| Export escaping and names | ExportService | H-26 |
| Stored text is never markup | EditorCore; FormatCodec | H-31 |
| App data checked on read | PreferencesStore; RecoveryService; SignatureStore | H-32 |

**UNVERIFIED:** Counting GIF and WebP frames without decoding, and making the first frame in the renderer. Check in spike S-06.

### 6.7 Format versions

- formatVersion is a whole number; each schema change raises it by 1. Format 1 is the first, so no conversion runs in version 1.0 of the app.
- An app opens every format up to its own, converting older ones in memory one step at a time. Each step is a pure function in FormatCodec with Node tests.
- A newer file is refused with "Made by a newer Obelisk; update it from the Microsoft Store" (FR-09).
- A converted document opens with autosave paused. The first save asks "Saving updates this file; older versions of Obelisk can't open it." After the user agrees, autosave resumes (OD-14).
- Within one format version, unknown fields are still refused.

### 6.8 App data records

All records live in the app data folder and are written through writeAtomic.

| Record | File | Contents | Checks on read |
|---|---|---|---|
| Preferences | `preferences.json` | version and each preference | A bad or unknown value uses the default for that key; the app always starts |
| Session | `session.json` | version, paths in tab order, active tab | Kept only while Restore tabs is on. Each path reopens through the file:open checks; missing files are named in one message (OD-17) |
| Saved signature | `signatures/<uuid>.sig` | Name, time, and PNG, encrypted as a whole | Decrypted only by sig:get, never to a temp file. Re-encrypted when safeStorage asks. Unavailable: nothing shown, nothing deleted (OD-15) |
| Signature index | `signatures/index.json` | IDs and order only, no names | A bad entry is skipped; the others still load |
| Recovery copy | `recovery/<uuid>.obk` and `.json` | A format 1 .obk; times and the first line, up to 80 characters | Restore runs the FormatCodec checks; a failing copy offers Discard only. Kept and offered at every launch until restored or discarded (OD-16) |
| Temp save file | `.~obk-<hex>.tmp` beside the target | Partial bytes of a save | Made with exclusive create; cleanup removes only this pattern (NFR-14) |

**UNVERIFIED:** safeStorage inside an MSIX package, including the temporarily unavailable state. Check in spike S-07.

### 6.9 Paste, export, and print

- Pasted HTML is parsed into a detached document and mapped through an allowlist into the schema; raw HTML never enters the page. Pasted Obelisk blocks pass the file checks and get new IDs. Pasted images follow the image limits; SVG is refused.
- Copy builds HTML from the schema and escapes it; it never copies the live page.
- One export interface, export(format, document, assets, target), reached only through export:run (ADR-006). Main shows the Export dialog and the replace prompt.
- Every export file goes through writeAtomic. A new Markdown images folder is written as a temp folder, then renamed into place. An existing one is named in the replace prompt; each image in it is replaced through writeAtomic and other files are left alone.
- Markdown escapes text, alt text, and link text; formulas are written only as LaTeX between dollar signs; no raw HTML. Images are named image-001.png and so on. Animated GIF and WebP are copied as their original, already checked, bytes.
- Word text goes through the library's text functions only. Word, PDF, and print use the first frame of an animated image: a PNG made in the renderer at export time, checked by main, never stored.
- PDF and print use one hidden window with the settings in section 6.4.
- An export stops after 60 s and returns timeout. The temp file or folder is removed, and a replaced file keeps its old bytes (NFR-04 sets the 10 s target).

### 6.10 Hostile sample set

Each sample runs under Node against FormatCodec and, where marked by the case, in the packaged app. No sample may change the file it opens.

| ID | Case | Expected |
|---|---|---|
| H-01 | File over 200 MB; archive with 2,001 entries | Refused before reading entries |
| H-02 | Entry that inflates past its cap (zip bomb), with a small declared size | Read stops at the cap; refused |
| H-03 | Encrypted entry; unknown compression method; multi-disk archive | Refused |
| H-04 | Entry names with ../, a leading slash, a backslash, or a drive letter | Refused; nothing written |
| H-05 | Entry names with a network path, a stream suffix, or a device name such as CON | Refused |
| H-06 | Two names that differ only by case; a repeated name | Refused |
| H-07 | Central and local headers that disagree | Refused |
| H-08 | A folder entry, a link entry, or a nested .zip | Refused |
| H-09 | Missing manifest.json or document.json | Refused |
| H-10 | Unknown field; wrong type; value out of range | Refused |
| H-11 | Duplicate JSON keys; unpaired surrogate; NaN or Infinity | Refused |
| H-12 | Repeated block ID | Refused |
| H-13 | Over 20,000 blocks; table over 200 by 26; text over its cap | Refused |
| H-14 | Columns inside columns; a page break inside a column row | Refused |
| H-15 | formatVersion newer than the app | Refused with the update message |
| H-16 | Image whose first bytes do not match its type or extension | Refused |
| H-17 | Image header over 8000 by 8000 pixels | Refused before decoding |
| H-18 | SVG entry, or SVG pasted | Refused; dropped from paste |
| H-19 | Image entry not in the manifest, or a hash that does not match | Refused |
| H-20 | Link with javascript:, file:, data:, or a custom scheme | Refused on open; dropped on paste |
| H-21 | Pasted HTML with script, event handlers, remote images, and iframes | Nothing runs; no request is sent |
| H-22 | Formula with \\href, \\url, \\includegraphics, or HTML commands | Shown as an error |
| H-23 | Formula with a huge size or deep macro expansion; a \\gdef carried to another formula | Error; other formulas unchanged |
| H-24 | Diagram with HTML in labels, a click handler, or an init directive | Encoded or ignored; nothing runs |
| H-25 | Command line with flags, a folder, or 21 files | Flags ignored; only .obk files; first 20 opened |
| H-26 | Export of text, alt text, and link text with Markdown and XML markup | Escaped; file opens cleanly |
| H-27 | Animated GIF with 1,001 frames | Refused on open and paste |
| H-28 | Animated WebP whose frames add up to over 250 million pixels | Refused |
| H-29 | Animated GIF with a frame outside the image size | Refused |
| H-30 | Fake renderer: unknown handle, a recovery ID that names another file | PATH_NOT_ALLOWED or notFound; nothing touched |
| H-31 | A paragraph whose text holds script and remote-image tags | Opens; shown as text; no request |
| H-32 | A damaged recovery copy, session.json, preferences.json, or signature index | Discard offered or defaults used; nothing deleted |

## 7. Architecture decisions

Decisions are based on SRS 1.2. They are Proposed until accepted. ADR-010 and ADR-011 were accepted on October 23, 2026, and ADR-012 and ADR-013 on October 26, 2026. Structure: ADR-001. Failure handling: ADR-002.

| ADR | Decision | Status |
|---|---|---|
| ADR-001 | The main process owns all file access | Proposed |
| ADR-002 | Save, Save As, and autosave share one save call and one atomic-write helper | Proposed |
| ADR-003 | One ZIP container per document | Proposed |
| ADR-004 | Editor built on a ProseMirror-based core with custom block views | Proposed |
| ADR-005 | Formulas: KaTeX on screen and PDF, OMML for Word, image fallback | Proposed |
| ADR-006 | Each exporter is a separate module behind one interface | Proposed |
| ADR-007 | Saved signatures encrypted with safeStorage in app data | Proposed |
| ADR-008 | Microsoft Store MSIX as the only release channel | Proposed |
| ADR-009 | Single instance with file activation, and recovery copies in app data | Proposed |
| ADR-010 | Diagrams render in the renderer with Mermaid at securityLevel strict | Accepted 2026-10-23 |
| ADR-011 | Older format versions convert forward; newer ones are refused | Accepted 2026-10-23 |
| ADR-012 | Word export uses the docx library | Accepted 2026-10-26 |
| ADR-013 | .obk files are read with yauzl and written with yazl | Accepted 2026-10-26 |

### ADR-001 The main process owns all file access

| Field | Content |
|---|---|
| Status | Proposed |
| Context | Untrusted files and pastes reach the renderer (NFR-06, NFR-07). Disk access must be in one place (NFR-22). |
| Decision | Only main-process services touch the disk. Renderers call named functions on the IPC bridge and never send paths: main shows the dialogs and hands out handles. Main checks the sender and validates every document before encoding. |
| Alternatives | Node in the renderer: simpler, but any script bug could reach the disk. A local server: needless for one user. |
| Consequences | Smaller attack surface and one place to test. Costs: IPC types to keep in step, and copying the document across IPC on save. |
| Revisit when | Saving very large documents across IPC misses NFR-03. |

### ADR-002 Save, Save As, and autosave share one save call and one atomic-write helper

| Field | Content |
|---|---|
| Status | Proposed |
| Context | A file must never be left half-written (NFR-10 to NFR-14). Autosave runs often without the user watching (FR-14, FR-15). |
| Decision | file:save checks the disk stat, then calls FileService.writeAtomic: an unpredictable temp name in the same folder, exclusive create, flush, one rename. Save, Save As, and the renderer's autosave timer all call file:save. Exports, recovery, signatures, and preferences use writeAtomic too. |
| Alternatives | Write in place: simpler, but a crash leaves part of a file. Autosave to a side copy: two stores to keep in step. |
| Consequences | One helper to test under Node (NFR-21); autosave inherits the conflict and timeout rules. Costs: a temp file per save and leftover cleanup (NFR-14). |
| Revisit when | Saves to network or cloud-synced folders show failures. |

### ADR-003 One ZIP container per document

| Field | Content |
|---|---|
| Status | Proposed |
| Context | A document holds blocks, images, and settings, and must be complete on its own (FR-49, FR-17). |
| Decision | An .obk file is a ZIP with manifest.json, document.json, and an images folder of hash-named files, per sections 6.5 and 6.6. |
| Alternatives | One JSON file with base64 images: simple, but large and slow. A folder per document: easy to break by moving files. |
| Consequences | Images stay compact and files are easy to inspect. Costs: size caps, an entry allowlist, and schema checks against hostile archives (OD-21); older formats convert forward (OD-14). |
| Revisit when | Format version 2 is needed (OD-02). |

### ADR-004 Editor built on a ProseMirror-based core with custom block views

| Field | Content |
|---|---|
| Status | Proposed |
| Context | Blocks, typed shortcuts, undo, and schema checks are core needs (FR-32, FR-35, FR-37). |
| Decision | Use a ProseMirror-based core with a strict schema. Each block kind is a custom node view in BlockViews. |
| Alternatives | contenteditable from scratch: too much work for one developer. Other editor frameworks: less control over the schema. |
| Consequences | A proven model for undo and input rules. Costs: learning curve; pagination is custom (FR-74). |
| Revisit when | Pages view layout cannot meet NFR-02. |

### ADR-005 Formulas: KaTeX on screen and PDF, OMML for Word, image fallback

| Field | Content |
|---|---|
| Status | Proposed |
| Context | Formulas are the standout feature (FR-53). Word needs native equations (FR-57), but conversion may fail (FR-56). |
| Decision | KaTeX renders on screen and in PDF, with the fixed settings in section 6.4. For Word, KaTeX MathML goes through mathml2omml; on failure, or if not built, the formula is a PNG. |
| Alternatives | MathJax: heavier. Images only: Word users cannot edit equations. |
| Consequences | Word export never fails because of a formula. Costs: an LGPL module (NFR-29) and possible fidelity gaps (R-01). |
| Revisit when | mathml2omml fidelity is poor on the SRS samples. |

### ADR-006 Each exporter is a separate module behind one interface

| Field | Content |
|---|---|
| Status | Proposed |
| Context | PDF, Word, and Markdown map every block differently (SRS Export reference). HTML and .txt may come later. |
| Decision | ExportService calls one interface, export(format, document, assets, target), reached only through export:run. Each format is a module testable under Node, except PDF, which uses printToPDF. Files go through writeAtomic. |
| Alternatives | One exporter with format switches: grows tangled. |
| Consequences | Formats are tested and cut on their own; HTML can be added later. Cost: some shared mapping code. |
| Revisit when | A future format needs a different input than the block tree. |

### ADR-007 Saved signatures encrypted with safeStorage in app data

| Field | Content |
|---|---|
| Status | Proposed |
| Context | Signatures are sensitive (NFR-08, NFR-09). The app has no account or key store. |
| Decision | SignatureStore keeps each signature as a PNG in its own file, encrypted with the async safeStorage API (OD-15). sig:list returns names only; sig:get decrypts one. Unavailable or temporarily unavailable: save and show nothing, delete nothing, say so. |
| Alternatives | Plain files: readable by any user with access. Own key file: the key sits next to the data. |
| Consequences | Uses DPAPI with no key handling. Limitation: DPAPI guards against other Windows users, not other apps of the same user (Electron safeStorage docs). |
| Revisit when | Electron changes the safeStorage API again. |

### ADR-008 Microsoft Store MSIX as the only release channel

| Field | Content |
|---|---|
| Status | Proposed |
| Context | Release is Store only (NFR-24, NFR-31, NFR-27). |
| Decision | Package as MSIX, per-user, with the .obk file-type association; updates only through the Store. |
| Alternatives | A separate installer: needs code signing and an updater. |
| Consequences | Free signing and updates; clean uninstall. Costs: certification time (R-04) and MSIX file-system rules (R-06). |
| Revisit when | Users ask for a download outside the Store. |

### ADR-009 Single instance with file activation, and recovery copies in app data

| Field | Content |
|---|---|
| Status | Proposed |
| Context | Double-clicked files open as tabs (FR-18). Never-saved tabs need crash safety (FR-19 to FR-21). |
| Decision | Main takes the single-instance lock; a second launch passes its arguments through the second-instance event, and main keeps only .obk files. RecoveryService writes recovery copies through writeAtomic, named by UUIDs main makes; the renderer's timer sends them (OD-16). |
| Alternatives | Many windows, one per file: breaks the tab model. Recovery in the user's folder: leaves files the user never asked for. |
| Consequences | One window, one place for recovery. Costs: the lock must release on crash, and the activation path needs an MSIX test (R-06). |
| Revisit when | Users want one window per document. |

### ADR-010 Diagrams render in the renderer with Mermaid at securityLevel strict

| Field | Content |
|---|---|
| Status | Accepted 2026-10-23 |
| Context | Diagram sources come from untrusted files (FR-82). Mermaid output is SVG placed in the page. |
| Decision | BlockViews sets Mermaid up once with securityLevel strict, startOnLoad false, htmlLabels false, and an extended secure list (section 6.4) (OD-19). |
| Alternatives | sandbox level: renders in a frame, whose fit with the policy, print, and PDF is unchecked. loose or antiscript: allow HTML in labels. |
| Consequences | Labels are plain text and click handlers are off. Cost: some styling a diagram could set is ignored. |
| Revisit when | Mermaid changes its security settings, or a needed diagram type requires HTML labels. |

### ADR-011 Older format versions convert forward; newer ones are refused

| Field | Content |
|---|---|
| Status | Accepted 2026-10-23 |
| Context | Files outlive app versions, and unknown fields are refused within a version (FR-09, OD-14). |
| Decision | FormatCodec opens every format up to its own through tested one-step conversions, refuses newer formats, and asks before the first save upgrades a file (section 6.7). |
| Alternatives | Refuse every other version: simplest, but each schema change cuts off old files. Ignore unknown fields: weakens the hostile-file checks. |
| Consequences | Old files keep opening and users are told before an upgrade. Cost: conversion code kept for every past version. |
| Revisit when | A change cannot be written as a one-way conversion. |

### ADR-012 Word export uses the docx library

| Field | Content |
|---|---|
| Status | Accepted 2026-10-26 |
| Context | The Word export maps each block as listed in the SRS Export reference (FR-63).<br>Formulas become editable Word equations through mathml2omml (FR-57), or images when conversion is off or fails (FR-56).<br>Each image carries its alt text into the .docx (FR-52).<br>The Word exporter is one module behind the shared interface (ADR-006). |
| Decision | The Word exporter builds the .docx with the `docx` package (MIT; 9.14.0 tested). It runs in main under Node.<br>OMML from mathml2omml goes into a paragraph through `ImportedXmlComponent.fromXmlString()`. |
| Alternatives | docxtemplater: fills placeholders in an existing template instead of building a document, and images need a paid module.<br>Write the OOXML ourselves: full control, but weeks of work (content types, relationships, numbering, styles, image sizing, headers and footers, escaping). Possible later behind the ADR-006 interface if docx falls short.<br>html-to-docx: stale (last release March 2023) and has no OMML path. |
| Consequences | Letter is not the default, so the exporter sets Letter page size and margins itself.<br>The package is about 21 MB unpacked because it ships several builds; only one is loaded.<br>It depends on JSZip, which is MIT or GPLv3; Obelisk uses it under MIT. Both notices go on the About page (NFR-28).<br>mathml2omml stays a separate LGPL module (NFR-29); docx does not change that.<br>Word fidelity is checked by hand in Word (spike S-09). |
| Revisit when | docx fails spike S-09, stops being maintained, or cannot write a block the Export reference needs. |

### ADR-013 .obk files are read with yauzl and written with yazl

| Field | Content |
|---|---|
| Status | Accepted 2026-10-26 |
| Context | An .obk file is one ZIP container (ADR-003).<br>Section 6.6: caps count the bytes actually read, entries are read in memory only, and entry names are strict.<br>A file that fails a check opens nothing and stays unchanged (FR-09).<br>Decoding may move to a sandboxed utilityProcess (R-08, spike S-08). |
| Decision | FormatCodec reads .obk files with `yauzl` (3.4.0, MIT) and writes them with `yazl` (3.3.1, MIT). Types come from DefinitelyTyped.<br>yauzl reads the central directory first, so names and declared sizes are known before anything is inflated.<br>It errors when the real bytes pass the declared size, refuses ../ and absolute paths by default, and never writes to disk.<br>yazl writes with a fixed modified time, so the same document gives the same bytes. |
| Alternatives | @zip.js/zip.js (BSD-3-Clause): a close second. No dependencies, bundled types, and clean caps, but larger and built on Web Streams.<br>fflate: in a test it read about 67 MB past a 25 MB cap, and it does no name checks.<br>JSZip: silently renamed a ../evil.txt entry to evil.txt.<br>adm-zip: inflated a whole 300 MB bomb into memory, with no cap. |
| Consequences | Our own checks are still needed for the name allowlist, case duplicates, encrypted entries, and headers that disagree (H-03, H-06, H-07).<br>yauzl's callback API is wrapped in a small promise helper inside FormatCodec.<br>yazl's last release was November 2024. It is small and stable, but worth watching. |
| Revisit when | Either package is abandoned or has an unfixed security issue, spike S-08 fails, or format version 2 needs features they lack. |

## 8. Risks

| ID | Risk | Likelihood | Impact | Mitigation | Owner |
|---|---|---|---|---|---|
| R-01 | mathml2omml output differs from KaTeX for some formulas | Medium | Medium | Test the SRS formula samples in Word early; the image fallback covers failures (FR-56) | Developer |
| R-02 | LGPL terms for mathml2omml inside the MSIX are not met | Low | High | Ship it unbundled as its own module, with source link and license text (NFR-29); check the LGPL text | Developer |
| R-03 | Column rows split across pages differently on screen and in PDF | High | Medium | One layout module used by Pages view and print; PDF compare tests (FR-74) | Developer |
| R-04 | Store certification is delayed near release | Medium | High | Submit a private test build one month before release (NFR-31); allow certification time in security updates | Developer |
| R-05 | Some LibreOffice fonts are not OFL | Medium | Medium | Check each license file before bundling; drop any font that does not fit (OD-08) | Developer |
| R-06 | MSIX file activation or file writes behave differently than expected | Medium | Medium | Spikes S-01 and S-02 in a packaged build before the file features are built | Developer |
| R-07 | Antivirus or indexers lock the target during replace | Medium | Medium | Retry 3 times at 100 ms, then report; never leave a partial file (NFR-10) | Developer |
| R-08 | A Chromium, KaTeX, or Mermaid bug lets a crafted file run code in a renderer | Low | High | Sandbox and policy (section 6.4); main refuses what it did not issue; security releases within 30 days (QS-07) | Developer |

## 9. Technology stack

| Layer | Technology | Version | Why | License |
|---|---|---|---|---|
| Desktop runtime | Electron | UNVERIFIED (45 or later) | Chromium layout and printToPDF; one codebase | MIT |
| Interface | React, TypeScript | UNVERIFIED | Common and typed | MIT; Apache-2.0 |
| Editor core | ProseMirror-based library (proposal) | UNVERIFIED | Schema, undo, input rules | MIT |
| Math | KaTeX | UNVERIFIED | Fast, offline, MathML output | MIT |
| Word math | mathml2omml | 0.5.0 (npm) | MathML to OMML | LGPL-3.0-or-later |
| Word file | docx | 9.14.0 (tested); pin at implementation | Builds .docx under Node, including OMML and alt text (ADR-012) | MIT |
| PDF and print | Electron printToPDF and print | With Electron | Same layout as the screen | MIT |
| Diagram | Mermaid, securityLevel strict | UNVERIFIED | Text diagrams, offline | MIT (UNVERIFIED) |
| ZIP | yauzl (read) + yazl (write) | 3.4.0 + 3.3.1 | Reads and writes .obk with real-byte caps (ADR-013) | MIT |
| Tests | A Node test runner with coverage (proposal) | UNVERIFIED | NFR-21, NFR-23 | UNVERIFIED |
| Packaging | MSIX tooling for Electron (proposal) | UNVERIFIED | Store package | UNVERIFIED |

**UNVERIFIED:** Versions and licenses still marked UNVERIFIED. The Word math, Word file, and ZIP rows were checked on npm. Fix the rest after the spikes below, from each project's package page.

### 9.1 Spikes

| Spike | Question | Settles |
|---|---|---|
| S-01 | In a packaged MSIX build, save to Documents and confirm the write is not redirected and the rename replaces the file in one step. | R-06, R-07 |
| S-02 | Double-click an .obk file with Obelisk running; confirm the path arrives through the second-instance event. | R-06 |
| S-03 | Convert the SRS formula samples with mathml2omml and open them in Word. | R-01 |
| S-04 | Render a Mermaid flowchart at securityLevel strict in a sandboxed renderer with the network off, and find the style-src KaTeX and Mermaid output need. | OD-05, OD-19 |
| S-05 | Confirm whether the Windows Save dialog asks before replacing a file, as Electron sets it. | FR-12 |
| S-06 | Count frames and read frame sizes of animated GIF and WebP files without decoding, and make a first-frame PNG in the renderer. | OD-18 |
| S-07 | In a packaged MSIX build, encrypt and decrypt a signature with the async safeStorage API, and force the unavailable and re-encrypt states. | OD-15 |
| S-08 | Decode .obk files in a sandboxed Electron utilityProcess instead of main. Run FormatCodec on yauzl and yazl under Node and inside an Electron 45 utilityProcess:<br>Hostile samples H-01 to H-09 are refused, including a bomb with a forged small size, stopped at the 25 MB, 20 MB, and 250 MB real-byte caps.<br>Bad names are refused: ../, a leading slash, a backslash, drive letters, network paths, stream suffixes, CON, and case duplicates.<br>Saving a 200-image document twice gives byte-identical files.<br>Each refused file stays unchanged (FR-09). | R-08, ADR-013, FR-09 |
| S-09 | Export with docx and open the results in current Word for Windows:<br>The formula samples stay editable with conversion on (AC-11), and appear as images with conversion off.<br>Each Export reference row opens cleanly in Word.<br>Image alt text shows in Word's Alt Text pane.<br>Hostile text (`<`, `&`, `]]>`, control characters, unpaired surrogates) stays text, not markup (H-26).<br>A large export finishes in under 10 seconds with no network calls (NFR-04). | ADR-012, FR-52, FR-56, FR-57, FR-63 |

## 10. Traceability

Every Must FR maps to at least one component. Package-wide requirements map to the build and release process.

| Requirement | Priority | Component | ADR | Verification |
|---|---|---|---|---|
| FR-01 | Must | Shell and Tabs | - | Demo |
| FR-02 | Must | Shell and Tabs | - | Inspection |
| FR-03 | Must | Shell and Tabs | - | Test |
| FR-04 | Must | Shell and Tabs | - | Test |
| FR-05 | Must | Shell and Tabs | - | Inspection |
| FR-06 | Must | PreferencesStore | - | Test |
| FR-07 | Must | Shell and Tabs | - | Test |
| FR-08 | Must | FileService | - | Test |
| FR-09 | Must | FormatCodec | ADR-011, ADR-013 | Test |
| FR-10 | Must | FileService | - | Test |
| FR-11 | Must | FileService | - | Demo |
| FR-12 | Must | FileService | - | Test |
| FR-13 | Must | FileService | - | Test |
| FR-14 | Must | AutosaveService, FileService | ADR-002 | Test |
| FR-15 | Must | AutosaveService, FileService | ADR-002 | Test |
| FR-16 | Must | Shell and Tabs | - | Test |
| FR-17 | Must | FormatCodec | ADR-003 | Test |
| FR-18 | Should | FileService | ADR-009 | Demo |
| FR-19 | Should | AutosaveService, RecoveryService | ADR-009 | Inspection |
| FR-20 | Should | Shell and Tabs | - | Test |
| FR-21 | Should | RecoveryService | ADR-009 | Inspection |
| FR-22 | Must | EditorCore | - | Test |
| FR-23 | Must | Shell and Tabs | - | Test |
| FR-24 | Must | EditorCore | - | Test |
| FR-25 | Must | EditorCore | - | Test |
| FR-26 | Must | EditorCore | - | Test |
| FR-27 | Must | EditorCore | - | Inspection |
| FR-28 | Must | EditorCore | - | Test |
| FR-29 | Must | EditorCore | - | Test |
| FR-30 | Must | EditorCore | - | Test |
| FR-31 | Must | EditorCore | - | Demo |
| FR-32 | Must | EditorCore | ADR-004 | Test |
| FR-33 | Must | EditorCore | - | Demo |
| FR-34 | Must | EditorCore | - | Test |
| FR-35 | Must | EditorCore | ADR-004 | Test |
| FR-36 | Must | ClipboardBridge | - | Test |
| FR-37 | Must | EditorCore | ADR-004 | Test |
| FR-38 | Must | EditorCore | - | Test |
| FR-39 | Must | ClipboardBridge | - | Test |
| FR-40 | Must | EditorCore | - | Test |
| FR-41 | Must | ClipboardBridge | - | Test |
| FR-42 | Must | EditorCore | - | Test |
| FR-43 | Must | EditorCore | - | Test |
| FR-44 | Must | EditorCore | - | Inspection |
| FR-45 | Must | BlockViews | - | Test |
| FR-46 | Must | BlockViews | - | Test |
| FR-47 | Must | BlockViews | - | Test |
| FR-48 | Must | BlockViews | - | Test |
| FR-49 | Must | BlockViews | ADR-003 | Test |
| FR-50 | Must | BlockViews | - | Test |
| FR-51 | Must | BlockViews | - | Test |
| FR-52 | Must | BlockViews | ADR-012 | Inspection |
| FR-53 | Must | FormulaRenderer | ADR-005 | Test |
| FR-54 | Must | FormulaRenderer | - | Demo |
| FR-55 | Must | FormulaRenderer | - | Test |
| FR-56 | Must | ExportService | ADR-005, ADR-012 | Test |
| FR-57 | Should | ExportService | ADR-005, ADR-012 | Test |
| FR-58 | Must | EditorCore | - | Test |
| FR-59 | Must | EditorCore | - | Test |
| FR-60 | Must | EditorCore | - | Test |
| FR-61 | Must | ExportService | - | Demo |
| FR-62 | Must | ExportService | - | Test |
| FR-63 | Must | ExportService | ADR-012 | Test |
| FR-64 | Must | ExportService | - | Test |
| FR-65 | Must | ExportService | - | Test |
| FR-66 | Must | ExportService | - | Test |
| FR-67 | Should | BlockViews | - | Test |
| FR-68 | Should | BlockViews | - | Test |
| FR-69 | Should | BlockViews | - | Test |
| FR-70 | Should | BlockViews | - | Test |
| FR-71 | Should | BlockViews | - | Test |
| FR-72 | Should | BlockViews | - | Test |
| FR-73 | Should | BlockViews | - | Test |
| FR-74 | Should | BlockViews | ADR-004 | Test |
| FR-75 | Should | BlockViews | - | Test |
| FR-76 | Should | BlockViews | - | Test |
| FR-77 | Should | ExportService | - | Inspection |
| FR-78 | Should | BlockViews | - | Test |
| FR-79 | Should | SignatureStore | - | Test |
| FR-80 | Should | BlockViews | - | Inspection |
| FR-81 | Should | ExportService | - | Test |
| FR-82 | Should | BlockViews | ADR-010 | Test |
| FR-83 | Should | BlockViews | - | Test |
| NFR-01 | Must | Build and release | - | Test |
| NFR-02 | Must | EditorCore | ADR-004 | Test |
| NFR-03 | Must | FileService | ADR-001 | Test |
| NFR-04 | Must | ExportService | - | Test |
| NFR-05 | Must | Build and release | - | Analysis |
| NFR-06 | Must | ClipboardBridge | ADR-001 | Test |
| NFR-07 | Must | FormatCodec | ADR-001 | Test |
| NFR-08 | Should | SignatureStore | ADR-007 | Inspection |
| NFR-09 | Should | SignatureStore | ADR-007 | Test |
| NFR-10 | Must | FileService | ADR-002 | Test |
| NFR-11 | Must | FileService | - | Test |
| NFR-12 | Must | FileService | - | Test |
| NFR-13 | Must | AutosaveService | - | Test |
| NFR-14 | Must | FileService | ADR-002 | Test |
| NFR-15 | Must | Shell and Tabs | - | Test |
| NFR-16 | Must | Shell and Tabs | - | Test |
| NFR-17 | Must | Shell and Tabs | - | Analysis |
| NFR-18 | Must | Shell and Tabs | - | Inspection |
| NFR-19 | Must | Shell and Tabs | - | Inspection |
| NFR-20 | Should | Shell and Tabs | - | Demo |
| NFR-21 | Must | FormatCodec | ADR-002 | Inspection |
| NFR-22 | Must | IPC bridge | ADR-001 | Inspection |
| NFR-23 | Should | Build and release | - | Analysis |
| NFR-24 | Must | Build and release | ADR-008 | Test |
| NFR-25 | Must | Build and release | - | Test |
| NFR-26 | Must | PreferencesStore | - | Inspection |
| NFR-27 | Must | Build and release | ADR-008 | Test |
| NFR-28 | Must | Build and release | ADR-012 | Inspection |
| NFR-29 | Must | Build and release | ADR-005, ADR-012 | Inspection |
| NFR-30 | Must | Build and release | - | Inspection |
| NFR-31 | Must | Build and release | ADR-008 | Demo |

### 10.1 Quality scenarios

| QS | Component | View | Verification |
|---|---|---|---|
| QS-01 | EditorCore, FormulaRenderer | Figure 2 | Test: input-latency trace |
| QS-02 | FileService | Figures 2, 3 | Test: kill during save |
| QS-03 | FormatCodec, ClipboardBridge | Figure 5 | Test: hostile sample set (section 6.10) under Node and in the app |
| QS-04 | AutosaveService, FileService | Figures 3, 8 | Test: change the file in Notepad |
| QS-05 | ExportService | Figure 4 | Test: open in Word |
| QS-06 | SignatureStore | Figure 2 | Inspection: read the file as another user |
| QS-07 | IPC bridge, FileService | Figure 2 | Test: fake renderer under Node (H-30) |

## 11. Open decisions

These SRS open decisions affect the architecture. IDs match the SRS.

| ID | Question | Proposed default | Status |
|---|---|---|---|
| OD-02 | File extension and format version | .obk, format 1, after checking it is not widely used | Open |
| OD-03 | Autosave interval | Within 30 s of the last edit, as a target | Open |
| OD-05 | Diagram engine and syntax | Mermaid, bundled, offline; license to verify | Open |
| OD-08 | Exact bundled fonts and licenses | LibreOffice Latin set plus Dancing Script, each license checked | Open |
| OD-11 | Supported Windows versions | Windows 11 and Windows 10 22H2, x64 | Open |
| OD-07 | Crash safety for never-saved tabs | Should: recovery copy every 30 s | Decided 2026-10-23 |
| OD-12 | Open from File Explorer | Should: one window, new tab per file | Decided 2026-10-23 |
| OD-13 | Do table references follow row and column insert and delete? | Rewrite them; a reference to a deleted cell becomes #REF! | Decided 2026-10-23 |
| OD-14 | How are other format versions opened? | Convert older versions on open, refuse newer ones, and confirm before the first save upgrades a file | Decided 2026-10-23 |
| OD-15 | How are saved signatures stored? | A PNG for every kind, one encrypted file each | Decided 2026-10-23 |
| OD-16 | A recovery copy neither restored nor discarded | Keep it and offer it at every launch | Decided 2026-10-23 |
| OD-17 | Restore tabs on launch | Keep; open paths are stored in session.json (section 9) | Decided 2026-10-23 |
| OD-18 | Animated GIF and WebP images | Keep the original and play it in the editor; PDF, Word, and print use the first frame; Markdown keeps the original file | Decided 2026-10-23 |
| OD-19 | Mermaid security level | strict, which a diagram cannot change | Decided 2026-10-23 |
| OD-20 | Open link | Keep; http, https, and mailto only, after a prompt | Decided 2026-10-23 |
| OD-21 | Uncompressed size caps for .obk files | document.json 25 MB, each image 20 MB, 250 MB in total | Decided 2026-10-23 |

## 12. Maintenance and references

| Item | Detail |
|---|---|
| Author | Filliciano Plong |
| Version and date | 1.2, October 26, 2026 |
| Based on | SRS version 1.2 |
| Update when | An ADR changes status, a component is added or renamed, or a spike changes a decision |
| Security updates | Lockfile and dependency audit in every build; fuses checked in the build; Electron security releases shipped within 30 days (target) |
| Diagram sources | docs/diagrams/*.puml, rendered to docs/images/; shipped in Plong_Obelisk_DiagramSources.zip |

### 12.1 References

- Obelisk SRS (Plong_Obelisk_SRS.docx), version 1.2.
- arc42 template: arc42.org. C4 model: c4model.com.
- Electron security checklist: electronjs.org/docs/latest/tutorial/security.
- Electron safeStorage: electronjs.org/docs/latest/api/safe-storage.
- Electron app.requestSingleInstanceLock: electronjs.org/docs/latest/api/app.
- MSIX file system behavior: learn.microsoft.com/windows/msix/desktop/desktop-to-uwp-behind-the-scenes.
- mathml2omml: npmjs.com/package/mathml2omml.
- docx: npmjs.com/package/docx. yauzl and yazl: npmjs.com/package/yauzl and npmjs.com/package/yazl.
- KaTeX options: katex.org/docs/options.
- Mermaid configuration schema: mermaid.js.org/config/schema-docs/config.
