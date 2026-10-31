# Architecture and Design: Obelisk

Prepared by: Filliciano Plong · Date: October 27, 2026 · Version: 1.3

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
| 1.3 | October 27, 2026 | Recorded spikes S-01 to S-09. Closed the UNVERIFIED lines those spikes settled. Applied the approved menu wording and added the link opener component. Based on SRS 1.3. |

## 1. Context and scope

This document shows how Obelisk will meet its SRS. It cites requirement IDs from the SRS (Plong_Obelisk_SRS.docx, version 1.3) instead of repeating them.

Everything here is a proposal until accepted. Technology versions still marked UNVERIFIED in section 9 stay so until a later check. Spikes S-01 to S-09 confirmed the rows named there.

### 1.1 Actors

| Actor | Role |
|---|---|
| User | Writes, saves, prints, and exports documents; one person in the student or professional role. |
| Windows | File Explorer, Open and Save dialogs, print spooler, clipboard, spell checker, DPAPI. |
| Microsoft Store | Installs, signs, and updates the MSIX package. |

### 1.2 External dependencies

- Electron (Chromium and Node.js), React, TypeScript.
- A ProseMirror-based editor core (proposal, ADR-004).
- KaTeX for equations; mathml2omml for Word equations (Should); docx for Word files (ADR-012).
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
| QS-01 | User types in a 50-page document with tables and equations, on the reference machine. | Character shows within 50 ms; equations re-render only when their source changes. | Test: input-latency trace | NFR-01, NFR-02 | EditorCore, FormulaRenderer |
| QS-02 | The app is ended or power is lost during Save or autosave of a large file. | The target holds the old bytes or the complete new file; 20 of 20 runs. | Test: kill during save | NFR-10, NFR-12, NFR-14 | FileService |
| QS-03 | User opens a crafted .obk file, or pastes HTML with scripts and remote images. | Nothing runs and no request is sent; a bad file opens nothing and stays unchanged. | Test: hostile sample set (section 6.10) under Node and in the app | FR-09, FR-36, NFR-06, NFR-07 | FormatCodec, ClipboardBridge |
| QS-04 | Another program changes an open file, then autosave fires. | Autosave is skipped; the user chooses Overwrite, Save as, or Cancel; nothing is overwritten silently. | Test: change the file in Notepad | FR-13, FR-15 | AutosaveService, FileService |
| QS-05 | User exports a document with 20 equations to Word. | Each equation is an editable equation, or an image if conversion fails; done within 10 s. | Test: open in Word | FR-56, FR-57, NFR-04 | ExportService |
| QS-06 | Another Windows user on the same PC reads Obelisk's app data. | Saved signatures are unreadable without the owner's DPAPI key. Other apps of the same user are out of scope. | Inspection: read the file as another user | NFR-08, NFR-09 | SignatureStore |
| QS-07 | A script runs in a renderer (an assumed bug) and calls the IPC bridge with made-up handles, IDs, and documents. | Main refuses what it did not issue; nothing outside user-picked files and app data is read, written, or deleted. | Test: fake renderer under Node (H-30) | NFR-07, NFR-22 | IPC bridge, FileService |

## 4. Architectural style

Local-first modular monolith. Dialogs, disk writes, print, and export stay in main. Decoding an .obk file runs in a utility process (spike S-08). One sandboxed renderer per window owns the editor. They talk only over a narrow, typed IPC bridge exposed by the preload script. Every disk write goes through one tested helper (ADR-001, ADR-002). Untrusted content stays away from Node, and no server is needed, which matches NFR-05.

| Component | Process | Responsibility |
|---|---|---|
| Shell and Tabs | Renderer | Window regions, menus, tab strip, status bar (including Autosave paused), Settings and About tabs, prompts. |
| EditorCore | Renderer | Document model, typing, shortcuts, slash menu, undo, selection, block moves, find and replace, page layout. New block IDs on paste and duplicate. |
| BlockViews | Renderer | Views for tables (with the TableMath module), images, columns, drawing, signatures, date and time items, and diagrams (Mermaid, strict). Makes first-frame PNGs of animated images for export. |
| FormulaRenderer | Renderer | KaTeX rendering for equation blocks and inline equations with fixed settings (section 6.4), live preview, errors; MathML and PNG for export. |
| ClipboardBridge | Renderer | Copy and paste of blocks. Pasted HTML is parsed inert and mapped into the schema; pasted Obelisk blocks are checked like an opened file. |
| AutosaveService | Renderer | Per-tab 30 s timer after the last edit. Saved tabs: calls file:save like Ctrl+S. Never-saved tabs: sends recovery:put. Pauses on conflict. |
| IPC bridge | Preload | The only path from renderer to main: named, typed calls. Main checks the sender and every argument; handles, never paths. |
| Link opener | Main | Owns `link:open` (`src/main/security/links.ts`): shows the full address, asks the user, and opens only allowlisted schemes in the default browser or mail app. |
| FileService | Main | Open, Save, and Export dialogs; the handle-to-path map; disk-change check; file activation and session restore; the shared atomic-write helper writeAtomic. |
| FormatCodec | Utility process | Encode and decode .obk files: archive caps, entry allowlist, schema, limits, image headers, and version conversion. Decoding runs in an Electron utilityProcess so a crash or a large inflate stays off main and off the editor. yazl encoding was checked in that same process. Electron 45 does not OS-sandbox it (spike S-08). APPROVED 27 October 2026: decoding stays in that process. The main-process fallback is not taken. FileService still does the disk rename. |
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

**Limitation:** Save as and the first Save add the Save dialog and the replace prompt before this flow.

### 5.4 Sequence: export to Word

![Word export with equation fallback](images/03-sequence-export-word.png)

*Figure 4. Word export with equation fallback*

**Purpose:** Shows how equations reach Word as equations or images, through the IPC bridge.

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

**Limitation:** Checked in spike S-01. Documents and a local folder are not redirected. App data is.

Checked in spike S-01 on 27 October 2026, Windows 11 Home 10.0.26300, Electron 45.0.0, commit 8f4c177. MSIX did not redirect Documents or the local Desktop. Documents on that PC is OneDrive Known Folder Move, `C:\Users\filli\OneDrive\Documents`, and `app.getPath('documents')` returned that path. The second folder was the plain local Desktop.

It did redirect `app.getPath('userData')`, Roaming, and Local into the package LocalCache (`...\Packages\Obelisk.SpikeS01_09826e2d9xne4\LocalCache\`). Those files are private to the package and are removed on uninstall. Settings and recovery files can live there. A document must not default to AppData.

A dev-signed MSIX does not start while Smart App Control is enforcing, including through the app execution alias (spike S-07, Windows 11 Home 10.0.26300). Manual testing on that PC needs Smart App Control off, or a signature Windows trusts. Scripts launch the app through the alias, not the path under WindowsApps.

### 5.7 Screen flow

![Screen flow](images/06-screen-flow.png)

*Figure 7. Screen flow*

**Purpose:** Shows how the user moves between the editor, dialogs, and tabs.

**Assumption:** Settings and About open as tabs, not windows.

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
| Operation | file:save, called by Save, Save as, and the renderer's autosave timer; one path (ADR-002) |
| Inputs | Tab handle; document model; revision number; expected stat (size and modified time) or none; replaceConfirmed |
| Authorization | Main maps the handle to a path it issued from a dialog, an activation, or the session. Any other handle returns PATH_NOT_ALLOWED |
| Validation | Main checks the document against the schema and limits (sections 6.5 and 6.6) before encoding; a failure returns ENCODE_FAILED and writes nothing |
| Before writing | stat the target. A changed stat returns conflict. A new target that exists without replaceConfirmed returns exists |
| Atomicity | writeAtomic: a temp file `.~obk-<128-bit hex>.tmp` in the same folder, made with exclusive create, then flush and one rename over the target |
| Timeout | 5 s (NFR-11), checked just before the rename. Past the deadline, the temp file is removed and nothing is renamed. A rename that has started finishes and returns ok |
| Retry | On EPERM, EBUSY, or EACCES during the rename (antivirus, indexer, or a brief lock): 3 tries, 100 ms apart, then EBUSY_EXHAUSTED. One rename in the OneDrive Documents folder failed once with EPERM, and the next try replaced the file (spike S-01). If the tries are used up, show the error, keep the previous file, and delete the temp file. |
| Outputs | ok with the new stat and the saved revision; conflict with the current stat; exists; timeout (retryable); error with code, message, and retryable |
| Error codes | ENOSPC, EBUSY_EXHAUSTED (retryable); EACCES, ENOENT, PATH_NOT_ALLOWED, ENCODE_FAILED (not retryable) |
| State changes | Saving to Clean on ok only if the revision is unchanged, else Changed. Timeout or error: back to Changed, or NeverSaved after a failed first save |
| Autosave | Same call with the tab handle. On conflict it shows the choice once, pauses autosave for that tab, and the status bar shows Autosave paused. It resumes after the next successful Save, Overwrite, or Save as |
| Cleanup | On launch and after each save, only files matching the temp pattern and older than 10 minutes are removed (NFR-14) |

Checked in spike S-01 on the same build as section 5.6. In the packaged MSIX, writeAtomic's temp file and rename landed in the real Documents folder and in the second folder. Get-Item from outside the package opened those paths, the hashes matched, and the paths were not under the package LocalCache. The outside watcher saw only complete payloads during the replaces. `fs.rename` over the existing file is the one replace step on those folders.

### 6.2 Alternatives

| Case | Trigger | Result |
|---|---|---|
| Conflict | Another program changed the file | Return conflict; the user picks Overwrite (save with the new stat), Save as, or Cancel |
| Exists | A new target exists and the replace was not confirmed | Return exists; write nothing. On Windows, Electron 45 sets `FOS_OVERWRITEPROMPT` on every save dialog. `showSaveDialog` is owned by the app window, and that prompt is the confirmation (spike S-05). `showOverwriteConfirmation` is not read on Windows. Main sets replaceConfirmed when the dialog returns the path. A canceled dialog writes nothing. The dialog itself does not write the file. Obelisk does not show a second prompt. On another platform, or if the Windows prompt stops staying until a click, Main shows Obelisk's own prompt before writing. |
| Timeout | No completion within 5 s (slow or network folder) | Return timeout; tab stays changed; status bar says Not saved; Retry offered |
| Error | Disk full, access denied, path gone, retries used up, document fails the schema, a read-only target, or a file another program has open | Return error with its code; temp file removed; the previous file stays; Retry offered when retryable. A read-only target and a file held open both returned EPERM (errno -4048) in spike S-01. The message says which of those two it is. |
| Not allowed | A handle main did not issue, or one for a closed tab | Return error PATH_NOT_ALLOWED; nothing is read or written |
| Cancelled | The user cancels the Save dialog or the replace prompt | Return cancelled; a never-saved tab stays NeverSaved |

Spike S-05 also tried an existing `.obk` name with a Word `.docx` filter. Windows kept the `.obk` name and asked to replace that file. Export sets the extension itself. It does not rely on the filter.

### 6.3 IPC surface

| Channel | Direction | Payload | Results |
|---|---|---|---|
| `file:open` | R to M | None; main shows the Open dialog | ok with handle, name, document, stat; cancelled; refused with reason and message; error; alreadyOpen with tabId |
| `file:save` | R to M | Handle, document, revision, expected stat | ok, conflict, exists, timeout, error (section 6.1) |
| `file:saveAs` | R to M | Handle or none, document, revision | Main shows the Save dialog, owned by the app window. On Windows that dialog is the replace prompt (spike S-05). Main sets replaceConfirmed when it returns an existing path, then saves: file:save results with a new handle and name, or cancelled |
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
- Content Security Policy: default-src 'none'; script-src app:; style-src-elem app: plus a per-render nonce; style-src-attr 'none'; fonts from app: only; images from app:, data:, and blob:; no connect, frame, or object sources. No 'unsafe-inline' and no 'unsafe-eval'. Spike S-04.
- A session-wide request filter in main cancels every request that is not app:, data:, or blob:. No crash reporter or updater runs; the Store updates the app.
- Every permission request is denied. Navigation, new windows, and webview tags are blocked.
- Links: only http, https, and mailto, checked on load, paste, and Ctrl+K, and again in main before opening. The prompt shows the full address (OD-20).
- The IPC bridge exposes named functions only. Main checks that each message comes from the app's own frame, validates every argument, and never passes the raw event to the renderer.
- The renderer never sends a path. Main shows every file dialog, keeps a handle-to-path map, and makes every recovery and signature ID itself.
- Documents are decoded from JSON into the schema; no stored HTML is ever rendered. KaTeX and Mermaid output enters the page only through FormulaRenderer and BlockViews.
- Command-line arguments: only existing regular .obk files are taken, up to 20 per launch; other arguments are ignored. In `second-instance`, Chromium switches come before the path, so main picks file paths out of argv by filtering, never by a fixed index. A relative path is not resolved against the working directory. Explorer set that directory to `C:\WINDOWS\System32` (spike S-02). Selecting several files delivers one event per file.
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

Checked in spike S-04 (Mermaid 12.2.0, KaTeX 0.19.1, Electron 45.0.0). CI run 40464232909, commit 912eabd, measured the flowchart before the allowlist. The merged note (commit 5db8131) remeasures `rewrite-nonce` after the allowlist and the selector prefix, and the job fails if that check does not pass. On the local sandboxed host the flowchart was 186 by 467, fill `rgb(51, 51, 51)`, with no style attributes left.

Under `style-src app:`, with `script-src app:` and the network off, KaTeX rendered the Equation reference samples (HTML and MathML) from `app:` fonts. Mermaid at `securityLevel: 'strict'` returned an SVG for the diagram types tried. The flowchart's theme style element and its `max-width` attribute were both blocked.

The chosen path moves those style attributes into the diagram stylesheet. It keeps only drawing properties: fill, fill-opacity, fill-rule, stroke, stroke-width, stroke-dasharray, stroke-dashoffset, stroke-linecap, stroke-linejoin, stroke-miterlimit, stroke-opacity, opacity, color, font-family, font-size, font-weight, font-style, text-anchor, dominant-baseline, width, height, max-width, min-width, max-height, and min-height.

It drops `url()`, `@import`, `position`, `content`, `display`, and any declaration or selector that contains `{`, `}`, or `<`. Every selector is prefixed with the diagram id. That one style element is allowed with a per-render nonce. On that path the sample flowchart measured 186 by 467 with fill `#333`.

Layout is dagre. Do not set `layout` to elk, and do not ship elkjs (APPROVED 27 October 2026). Before render, strip `click` lines and `href` values from the diagram source.

Mermaid 12.2.0, checked in spike S-04 on 27 October 2026: every GitHub advisory for mermaid-js/mermaid was patched at or before 11.16.1 (10.9.8 on the 10.x line). That includes the sequence XSS, the architecture `iconText` XSS, the `classDef` CSS injection, and the sibling-CSS injection. `npm audit` of that tree reported 0 vulnerabilities. Check again when the app pins a version.

Checked in spike S-08 (Electron 45.0.0, yauzl 3.4.0, yazl 3.3.1, Windows image 20261021.278.1, CI runs 40442767845 and 40443190314). Decoding runs in a utilityProcess, for crash and memory isolation from main. That process is not OS-sandboxed in Electron 45. `utilityProcess.fork` has no sandbox option. On Windows, `getAppMetrics()` reports `sandboxed: false` and integrity level `high`. On Linux the command line contains `--service-sandbox-type=none` and Seccomp is 0.

The defence is the hostile-file checks and the real-byte caps. yauzl and yazl passed H-01 to H-09, those caps, a byte-identical 200-image save, and unchanged refused files, under Node 22.23.4 and inside that utility process. ADR-013 stays. APPROVED 27 October 2026: decoding stays in the utility process. The main-process fallback is not taken.

**UNVERIFIED:** Fuses other than runAsNode and nodeCliInspect. Check when versions are pinned.

**UNVERIFIED:** How printToPDF sets up its window, how the parser used for pasted HTML treats scripts, and how custom clipboard formats behave. Check in the chosen Electron version.

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
- Spike S-08 applied those rules with yauzl 3.4.0 and yazl 3.3.1. yauzl is opened with `validateEntrySizes` off, so a forged small declared size cannot hide a bomb from the 25 MB, 20 MB, and 250 MB caps. An entry that finishes under the cap but does not match its declared size is refused. The codec computes the CRC while it reads.
- Names are the central-directory bytes, read as Latin-1, and classified by FormatCodec. That is what refuses `../`, a leading slash, a backslash, a drive letter, a network path, a stream suffix, a device name such as CON, and a case duplicate. yauzl is not asked to rewrite names first.
- yazl writes a legitimate archive with a fixed modified time. Two saves of a 200-image document were byte-identical inside one runtime (spike S-08). They are not required to match across Node and Electron.

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

Checked in spike S-06 (Electron 45.0.0, Chrome 156.0.8078.48, Windows image 20261021.278.1, Ubuntu image 20261023.334.3, CI run 40461995542).

GIF and WebP frame counts and frame sizes come from a container walk, before any pixel decode. Do not scan for a separator byte or for the letters ANMF.

GIF blocks follow GIF89a. Image descriptors are frames. LZW sub-blocks are skipped by length. A Netscape loop count is not a frame count. A GIF with no trailer is refused.

WebP chunks follow the RIFF container. The canvas comes from VP8X. Each ANMF rectangle is read from the frame header. x and y are in 2-pixel units. The VP8 or VP8L header inside the frame is peeked for the coded size. The RIFF size bounds the count. Chromium and libwebp 1.3.2 both ignore an ANMF chunk past it.

The limits in this section apply to those sizes: 8000 pixels on a side, 1,000 frames, 250 million pixels across the frames, and each frame inside the canvas. A coded size that disagrees with the ANMF box is refused, and the pixel sum uses the larger box. ANMF chunks with the VP8X animation bit clear are still counted, and the file is refused, because the renderer cannot decode it.

The first-frame PNG for Word, PDF, and print is made in the sandboxed renderer: `ImageDecoder` frame 0, drawn to a canvas at the canvas size, then `canvas.toBlob('image/png')`. The page had no Node. `process.sandboxed` was true.

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
| Settings | `preferences.json` | version and each preference | A bad or unknown value uses the default for that key; the app always starts |
| Session | `session.json` | version, paths in tab order, active tab | Kept only while Restore tabs is on. Each path reopens through the file:open checks; missing files are named in one message (OD-17) |
| Saved signature | `signatures/<uuid>.sig` | Name, time, and PNG, encrypted as a whole | Decrypted only by sig:get, never to a temp file. Re-encrypted when safeStorage asks. Unavailable: nothing shown, nothing deleted (OD-15) |
| Signature index | `signatures/index.json` | IDs and order only, no names | A bad entry is skipped; the others still load |
| Recovery copy | `recovery/<uuid>.obk` and `.json` | A format 1 .obk; times and the first line, up to 80 characters | Restore runs the FormatCodec checks; a failing copy offers Discard only. Kept and offered at every launch until restored or discarded (OD-16) |
| Temp save file | `.~obk-<hex>.tmp` beside the target | Partial bytes of a save | Made with exclusive create; cleanup removes only this pattern (NFR-14) |

Checked in spike S-07 on 27 October 2026, Windows 11 Home 10.0.26300, Electron 45.0.0, commit a9f81193dc9a9e668a11510128986084c26bb1cb, package Obelisk.SpikeS07 0.0.1.0. `encryptStringAsync` and `decryptStringAsync` round-tripped a signature in the packaged MSIX. The same ciphertext decrypted after a new process. The file held no readable name or PNG.

`isEncryptionAvailable` was true on that path. `isAsyncEncryptionAvailable` was true too, including when the key was bad, so it is not the unavailable check. Check `isEncryptionAvailable` before saving a signature.

A stored key that does not start with `DPAPI` makes `isEncryptionAvailable` false, and both encrypt and decrypt throw a generic error. A `DPAPI` prefix that `CryptUnprotectData` cannot open leaves `isEncryptionAvailable` true, and the old ciphertext fails with `Error while decrypting the ciphertext provided to safeStorage.decryptStringAsync.`

The temporarily unavailable string did not appear. `shouldReEncrypt` was false. A bad key shows up only as a generic decrypt error, so any decrypt failure means the signature is unavailable: save nothing and delete nothing. Saved signatures keep ADR-007.

### 6.9 Paste, export, and print

- Pasted HTML is parsed into a detached document and mapped through an allowlist into the schema; raw HTML never enters the page. Pasted Obelisk blocks pass the file checks and get new IDs. Pasted images follow the image limits; SVG is refused.
- Copy builds HTML from the schema and escapes it; it never copies the live page.
- One export interface, export(format, document, assets, target), reached only through export:run (ADR-006). Main shows the Export dialog. On Windows the Save dialog's replace prompt is the confirmation, and Obelisk does not ask again (spike S-05). Export sets the file extension itself.
- Every export file goes through writeAtomic. A new Markdown images folder is written as a temp folder, then renamed into place. An existing one is named in the replace prompt; each image in it is replaced through writeAtomic and other files are left alone.
- Markdown escapes text, alt text, and link text; formulas are written only as LaTeX between dollar signs; no raw HTML. Images are named image-001.png and so on. Animated GIF and WebP are copied as their original, already checked, bytes.
- Word text goes through the library's text functions only, after XML 1.0-illegal control characters are stripped. docx escapes `<`, `&`, and `]]>`. Unpaired surrogates do not survive as surrogates (spike S-09). A file that still contains those control characters does not open in Word.
- The exporter sets Letter and the margins on the section. It sets the document font from the document, and each table to the text width (9360 twips on Letter with 1 inch margins). Pictures of equations, drawings, and diagrams are cropped to their content, with a small margin, and rendered at 2× or more.
- A checklist can export as a Segoe UI Symbol mark, read-only, or as a Word checkbox content control, clickable.
- Word, PDF, and print use the first frame of an animated image: a PNG made in the renderer at export time, checked by main, never stored.
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
| H-26 | Export of text, alt text, and link text with `<`, `&`, `]]>`, XML 1.0-illegal control characters, and unpaired surrogates | Markup is escaped. Those control characters are stripped before the text is written. Unpaired surrogates do not survive as surrogates. The file opens cleanly (spike S-09). |
| H-27 | Animated GIF with 1,001 frames | Refused on open and paste |
| H-28 | Animated WebP whose frames add up to over 250 million pixels | Refused |
| H-29 | Animated GIF with a frame outside the image size | Refused |
| H-30 | Fake renderer: unknown handle, a recovery ID that names another file | PATH_NOT_ALLOWED or notFound; nothing touched |
| H-31 | A paragraph whose text holds script and remote-image tags | Opens; shown as text; no request |
| H-32 | A damaged recovery copy, session.json, preferences.json, or signature index | Discard offered or defaults used; nothing deleted |

H-01 to H-09 passed in spike S-08, under Node and in the Electron 45 utility process, on Windows image 20261021.278.1 and on Linux. Refused files were unchanged. The three bombs stopped at 25 MB, 20 MB, and 250 MB of real bytes. A 200-image yazl save was byte-identical when encoded twice in the same runtime.

## 7. Architecture decisions

Decisions are based on SRS 1.3. They are Proposed until accepted. ADR-010 and ADR-011 were accepted on October 23, 2026, and ADR-012 and ADR-013 on October 26, 2026. Structure: ADR-001. Failure handling: ADR-002.

| ADR | Decision | Status |
|---|---|---|
| ADR-001 | The main process owns all file access | Proposed |
| ADR-002 | Save, Save as, and autosave share one save call and one atomic-write helper | Proposed |
| ADR-003 | One ZIP container per document | Proposed |
| ADR-004 | Editor built on a ProseMirror-based core with custom block views | Proposed |
| ADR-005 | Equations: KaTeX on screen and PDF, OMML for Word, image fallback | Proposed |
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

### ADR-002 Save, Save as, and autosave share one save call and one atomic-write helper

| Field | Content |
|---|---|
| Status | Proposed |
| Context | A file must never be left half-written (NFR-10 to NFR-14). Autosave runs often without the user watching (FR-14, FR-15). |
| Decision | file:save checks the disk stat, then calls FileService.writeAtomic: an unpredictable temp name in the same folder, exclusive create, flush, one rename. Save, Save as, and the renderer's autosave timer all call file:save. Exports, recovery, signatures, and preferences use writeAtomic too. |
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

### ADR-005 Equations: KaTeX on screen and PDF, OMML for Word, image fallback

| Field | Content |
|---|---|
| Status | Proposed |
| Context | Equations are the standout feature (FR-53). Word needs native equations (FR-57), but conversion may fail (FR-56). |
| Decision | KaTeX renders on screen and in PDF, with the fixed settings in section 6.4. For Word, KaTeX MathML goes through mathml2omml; on failure, or if not built, the equation is a PNG. |
| Alternatives | MathJax: heavier. Images only: Word users cannot edit equations. |
| Consequences | Word export never fails because of a formula. Costs: an LGPL module (NFR-29) and a small OMML cleanup before the equation is written (spike S-03). The sum's empty n-ary body, stretchy matrix fences, and a display `m:oMathPara` wrap are that cleanup. Alignment is still unchecked. |
| Revisit when | the cleanup cannot be done, or a later alignment sample looks wrong in Word. A conversion that still fails uses the image fallback (FR-56). |

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
| Decision | SignatureStore keeps each signature as a PNG in its own file, encrypted with the async safeStorage API (OD-15). The sync methods are not used. sig:list returns names only; sig:get decrypts one. Check `isEncryptionAvailable` before a save. Unavailable, a failed encrypt, or any failed decrypt: save and show nothing, delete nothing, say so. Spike S-07 did not produce the temporarily unavailable string, and `shouldReEncrypt` was false. |
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
| Decision | Main takes the single-instance lock. A second launch passes its arguments through the `second-instance` event. Main keeps only .obk files, picked out of argv by filtering. Several selected files are one event each. RecoveryService writes recovery copies through writeAtomic, named by UUIDs main makes; the renderer's timer sends them (OD-16). |
| Alternatives | Many windows, one per file: breaks the tab model. Recovery in the user's folder: leaves files the user never asked for. |
| Consequences | One window, one place for recovery. The lock must release on crash. Checked in spike S-02 on 27 October 2026, Windows 11 Home 10.0.26300, Electron 45.0.0, commit 0f95f5f. A cold start and a second double-click both delivered the path, and one window stayed open. Open with and the app execution alias did too. Explorer's working directory was `C:\WINDOWS\System32`, so a relative path is not resolved against it. `GetActivatedEventArgs` is not on Electron's `app` object. The path was already on argv, so this design does not call it. |
| Revisit when | Users want one window per document. |

### ADR-010 Diagrams render in the renderer with Mermaid at securityLevel strict

| Field | Content |
|---|---|
| Status | Accepted 2026-10-23 |
| Context | Diagram sources come from untrusted files (FR-82). Mermaid output is SVG placed in the page. |
| Decision | BlockViews sets Mermaid up once with securityLevel strict, startOnLoad false, htmlLabels false, layout dagre, and an extended secure list (section 6.4) (OD-19). Before render, `click` lines and `href` values are removed from the diagram source (APPROVED 27 October 2026). Before the SVG enters the page, style attributes move into one stylesheet, filtered and scoped as in section 6.4, and that sheet is allowed with a per-render nonce (spike S-04). elkjs is not shipped. |
| Alternatives | sandbox level: renders in a frame, whose fit with the policy, print, and PDF is unchecked. loose or antiscript: allow HTML in labels. |
| Consequences | Labels are plain text. Click links are stripped before render, and click handlers stay off. Some styling a diagram could set is dropped by the allowlist. The layout is dagre, which is MIT. |
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
| Context | The Word export maps each block as listed in the SRS Export reference (FR-63).<br>Equations become editable Word equations through mathml2omml (FR-57), or images when conversion is off or fails (FR-56).<br>Each image carries its alt text into the .docx (FR-52).<br>The Word exporter is one module behind the shared interface (ADR-006). |
| Decision | The Word exporter builds the .docx with the `docx` package (MIT; 9.14.0, checked in spike S-09). It runs in main under Node.<br>OMML goes into a paragraph through `ImportedXmlComponent.fromXmlString()`. In docx 9.14.0 that call returns the document node. Inserting the node writes an element named `undefined`, and Word refuses the file. The `m:oMath` child is what goes in the paragraph. Display equations are wrapped in `m:oMathPara` after conversion (spike S-03 and spike S-09). |
| Alternatives | docxtemplater: fills placeholders in an existing template instead of building a document, and images need a paid module.<br>Write the OOXML ourselves: full control, but weeks of work (content types, relationships, numbering, styles, image sizing, headers and footers, escaping). Possible later behind the ADR-006 interface if docx falls short.<br>html-to-docx: stale (last release March 2023) and has no OMML path. |
| Consequences | Letter is not the default, so the exporter sets Letter page size and margins itself.<br>The package is about 21 MB unpacked because it ships several builds; only one is loaded.<br>It depends on JSZip, which is MIT or GPLv3; Obelisk uses it under MIT. Both notices go on the About page (NFR-28).<br>mathml2omml stays a separate LGPL module (NFR-29); docx does not change that.<br>Checked in spike S-09 (docx 9.14.0) in Microsoft 365, Version 2610, on Windows. Pass. The Export reference samples opened and matched the rows. The six equation samples were editable equations with conversion on, and images with conversion off. Image alt text showed in the Alt Text pane. A 50-page Letter file packed in under 10 seconds with no network call. The exporter sets Letter itself, because the library's default page is A4. It sets the document font and the table widths. It inserts the `m:oMath` child, not the `fromXmlString` return value. It drops XML 1.0-illegal control characters before the text is written. Unpaired surrogates do not survive as surrogates. Exported pictures are cropped to their content, with a small margin, and rendered at 2× or more. Checklist checkboxes have an option: a read-only Segoe UI Symbol mark, or a clickable Word checkbox content control. mathml2omml fidelity stays with spike S-03. |
| Revisit when | docx stops being maintained, or it cannot write a block the Export reference needs. |

### ADR-013 .obk files are read with yauzl and written with yazl

| Field | Content |
|---|---|
| Status | Accepted 2026-10-26 |
| Context | An .obk file is one ZIP container (ADR-003).<br>Section 6.6: caps count the bytes actually read, entries are read in memory only, and entry names are strict.<br>A file that fails a check opens nothing and stays unchanged (FR-09).<br>Decoding runs in a utilityProcess. Spike S-08 found that an Electron 45 utilityProcess is not OS-sandboxed. The hostile-file checks and the real-byte caps are the defence. APPROVED 27 October 2026: that process stays. The main-process fallback is not taken. |
| Decision | FormatCodec reads .obk files with yauzl (3.4.0, MIT) and writes them with yazl (3.3.1, MIT). Types come from DefinitelyTyped. yauzl reads the central directory first. `validateEntrySizes` is off. FormatCodec counts inflated bytes and stops at the 25 MB, 20 MB, and 250 MB caps, so a bomb that claims a tiny size is still stopped at the cap. An entry that finishes under the cap but does not match its declared size is refused. Names are checked by FormatCodec, not by yauzl's rewrite: the allowlist, dot-dot, a leading slash, a backslash, drive letters, network paths, stream suffixes, device names, and case duplicates. yauzl never writes the file it is reading. yazl writes with a fixed modified time, so two saves of the same document in one runtime give the same bytes. Spike S-08 checked a 200-image document. |
| Alternatives | @zip.js/zip.js (BSD-3-Clause): a close second. No dependencies, bundled types, and clean caps, but larger and built on Web Streams.<br>fflate: in a test it read about 67 MB past a 25 MB cap, and it does no name checks.<br>JSZip: silently renamed a ../evil.txt entry to evil.txt.<br>adm-zip: inflated a whole 300 MB bomb into memory, with no cap. |
| Consequences | Our own checks are still needed, and S-08 is where they passed, including H-01 to H-09. yauzl's callback API is wrapped in a small promise helper inside FormatCodec. yazl's last release was November 2024. It is small and stable, but worth watching. The utility process is not an OS sandbox. |
| Revisit when | Either package is abandoned or has an unfixed security issue, or format version 2 needs features they lack. The main-process fallback was considered and is not taken (APPROVED 27 October 2026). |

## 8. Risks

| ID | Risk | Likelihood | Impact | Mitigation | Owner |
|---|---|---|---|---|---|
| R-01 | mathml2omml output differs from KaTeX for some equations | Medium | Medium | Test the SRS equation samples in Word early; the image fallback covers failures (FR-56) | Developer |
| R-02 | LGPL terms for mathml2omml inside the MSIX are not met | Low | High | Ship it unbundled as its own module, with source link and license text (NFR-29); check the LGPL text | Developer |
| R-03 | Column rows split across pages differently on screen and in PDF | High | Medium | One layout module used by Pages view and print; PDF compare tests (FR-74) | Developer |
| R-04 | Store certification is delayed near release | Medium | High | Submit a private test build one month before release (NFR-31); allow certification time in security updates | Developer |
| R-05 | Some LibreOffice fonts are not OFL | Medium | Medium | Check each license file before bundling; drop any font that does not fit (OD-08) | Developer |
| R-06 | MSIX file activation or file writes behave differently than expected | Medium | Medium | Spike S-01 passed. Documents (OneDrive) and a local folder were not redirected, and the rename replaced the file in one step. Spike S-02 passed. A double-clicked file arrived on argv, and a second file arrived through `second-instance`. Both on Windows 11 Home 10.0.26300, Electron 45.0.0. | Developer |
| R-07 | Antivirus or indexers lock the target during replace | Medium | Medium | Retry EPERM, EBUSY, and EACCES three times, 100 ms apart, then report. A read-only file and a file another program has open both returned EPERM. The old file stayed. Never leave a partial file (NFR-10). Checked in spike S-01. | Developer |
| R-08 | A Chromium, KaTeX, or Mermaid bug lets a crafted file run code in a renderer | Low | High | The renderer stays sandboxed (section 6.4). Spike S-08 found that the utility process which decodes .obk files is not OS-sandboxed in Electron 45. A hostile archive is stopped by the section 6.6 checks, which passed for H-01 to H-09, not by a sandbox on that process. Main refuses what it did not issue. Security releases ship within 30 days (QS-07). | Developer |

## 9. Technology stack

| Layer | Technology | Version | Why | License |
|---|---|---|---|---|
| Desktop runtime | Electron | 45.0.0 | Chromium layout and printToPDF; one codebase. Spikes S-01 to S-09 ran on this version (Chrome 156.0.8078.48, Node 24.22.0 inside Electron). | MIT |
| Interface | React, TypeScript | UNVERIFIED | Common and typed | MIT; Apache-2.0 |
| Editor core | ProseMirror-based library (proposal) | UNVERIFIED | Schema, undo, input rules | MIT |
| Math | KaTeX | 0.19.1 (checked in S-03 and S-04); pin when equations are built | Fast, offline, MathML output | MIT |
| Word math | mathml2omml | 0.5.0 (checked in S-03) | MathML to OMML | LGPL-3.0-or-later |
| Word file | docx | 9.14.0 (checked in S-09) | Builds .docx under Node, including OMML and alt text (ADR-012) | MIT |
| PDF and print | Electron printToPDF and print | With Electron | Same layout as the screen | MIT |
| Diagram | Mermaid, securityLevel strict, dagre layout | 12.2.0 (checked in spike S-04); pin when diagrams are built | Text diagrams, offline, with the style post-process in section 6.4. No ELK layout. | MIT for 12.2.0 and for dagre. elkjs is not shipped (APPROVED 27 October 2026). Mermaid still uses DOMPurify 3.4.17 (MPL-2.0 OR Apache-2.0). |
| ZIP | yauzl (read) + yazl (write) | 3.4.0 + 3.3.1 (checked in S-08) | Reads and writes .obk with real-byte caps (ADR-013) | MIT |
| Tests | A Node test runner with coverage (proposal) | UNVERIFIED | NFR-21, NFR-23 | UNVERIFIED |
| Packaging | MSIX tooling for Electron (proposal) | UNVERIFIED | Store package | UNVERIFIED |

JSZip is brought in by docx. S-03 saw 3.10.1 and S-09 saw 3.10.2. Both are used under MIT, chosen from the MIT or GPLv3 dual license. This draft does not pin a JSZip version of its own. hash.js 1.1.7 and nanoid 6.0.2, also under docx, are MIT (S-09).

**UNVERIFIED:** React, TypeScript, the editor core, the test runner, and the MSIX tooling are still unmarked. Electron, KaTeX, Mermaid, mathml2omml, docx, yauzl, and yazl are the versions above. elkjs is not shipped (APPROVED 27 October 2026).

### 9.1 Spikes

| Spike | Question | Settles |
|---|---|---|
| S-01 | Checked, pass, 27 October 2026, commit 8f4c177, Electron 45.0.0, Windows 11 Home 10.0.26300. Documents (OneDrive) and the local Desktop were not redirected. The rename replaced the file in one step. | R-06, R-07 |
| S-02 | Checked, pass, 27 October 2026, commit 0f95f5f, Electron 45.0.0, Windows 11 Home 10.0.26300. The path arrived on argv for a cold start, and through `second-instance` when the app was already running. | R-06 |
| S-03 | Checked, pass with a condition. Package checks: commit 42279f4, CI run 40527700478. Word: Microsoft 365 Version 2610 on a Windows desktop, 27 October 2026, not the CI runner. The six samples were editable. The exporter cleans the OMML as in ADR-005. Alignment is still unchecked. | R-01 |
| S-04 | Checked, pass, Electron 45.0.0, Mermaid 12.2.0, KaTeX 0.19.1. Sizes from CI run 40464232909 (commit 912eabd); the allowlist is in the merged note (commit 5db8131). Strict mode rendered offline. The readable path is the post-process and a per-render style nonce. APPROVED 27 October 2026: dagre layout, no elkjs, and `click` and `href` are stripped before render. | OD-05, OD-19 |
| S-05 | Checked, pass, 27 October 2026, Electron 45.0.0, Windows 11 Home 10.0.26300, commit 7ea3b12. The native prompt is the FR-12 confirmation on Windows. Obelisk does not ask again. | FR-12 |
| S-06 | Checked, pass, Electron 45.0.0, CI run 40461995542, Windows image 20261021.278.1 and Ubuntu image 20261023.334.3. Frame counts come from a container walk. The first-frame PNG is made in the sandboxed renderer. | OD-18 |
| S-07 | Checked, pass, 27 October 2026, commit a9f8119, Electron 45.0.0, Windows 11 Home 10.0.26300. The async API round-tripped in the MSIX, including after a restart. shouldReEncrypt was false. A bad key is a generic decrypt error, so any decrypt failure means the signature is unavailable. | OD-15 |
| S-08 | Checked, partial on the OS sandbox, Electron 45.0.0, yauzl 3.4.0, yazl 3.3.1, Windows image 20261021.278.1. H-01 to H-09, the real-byte caps, the name rules, the byte-identical 200-image save, and unchanged refused files all passed. The utility process is not OS-sandboxed. ADR-013 stays. APPROVED 27 October 2026: the main-process fallback is not taken. | R-08, ADR-013, FR-09 |
| S-09 | Checked, pass, docx 9.14.0. Word rounds were Microsoft 365 Version 2610. ADR-012 is kept. The exporter strips XML-illegal control characters, inserts the m:oMath child, sets Letter and the table widths, crops exported pictures, and offers a checkbox choice. The 50-page pack on the spike machine was under 10 seconds with no network call. CI run 40522475439 packed an earlier file, also under 10 seconds and with no network call. | ADR-012, FR-52, FR-56, FR-57, FR-63 |

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
| FR-44 | Must | EditorCore, Link opener | - | Inspection |
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
| NFR-05 | Must | Link opener | - | Analysis |
| NFR-06 | Must | ClipboardBridge, Link opener | ADR-001 | Test |
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
| OD-05 | Diagram engine and syntax | Mermaid 12.2.0, bundled, offline, dagre layout (MIT). No elkjs. Style post-process and per-render nonce from spike S-04. `click` and `href` are stripped before render. | Decided 2026-10-27. APPROVED 27 October 2026. |
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
| Version and date | 1.3, October 27, 2026 |
| Based on | SRS version 1.3 |
| Update when | An ADR changes status, a component is added or renamed, or a spike changes a decision |
| Security updates | Lockfile and dependency audit in every build; fuses checked in the build; Electron security releases shipped within 30 days (target) |
| Diagram sources | docs/diagrams/*.puml, rendered to docs/images/; shipped in Plong_Obelisk_DiagramSources.zip |

### 12.1 References

- Obelisk SRS (Plong_Obelisk_SRS.docx), version 1.3.
- arc42 template: arc42.org. C4 model: c4model.com.
- Electron security checklist: electronjs.org/docs/latest/tutorial/security.
- Electron safeStorage: electronjs.org/docs/latest/api/safe-storage.
- Electron app.requestSingleInstanceLock: electronjs.org/docs/latest/api/app.
- MSIX file system behavior: learn.microsoft.com/windows/msix/desktop/desktop-to-uwp-behind-the-scenes.
- mathml2omml: npmjs.com/package/mathml2omml.
- docx: npmjs.com/package/docx. yauzl and yazl: npmjs.com/package/yauzl and npmjs.com/package/yazl.
- KaTeX options: katex.org/docs/options.
- Mermaid configuration schema: mermaid.js.org/config/schema-docs/config.
