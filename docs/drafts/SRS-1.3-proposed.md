# Proposed SRS edits for version 1.3

Prepared by Filliciano Plong. These are drafts only. `docs/SRS.md` and `docs/ARCHITECTURE.md` stay at version 1.2 until I apply them.

Issue #16 asked for 1.2 edits. The next document version is 1.3, so this draft is named for 1.3. The architecture half is `docs/drafts/ARCHITECTURE-1.3-proposed.md`.

Each edit below gives the section, the current text, the proposed text, and the spike it comes from. The spike notes in `spikes/s01` through `spikes/s09` are the source. Where my running list said something shorter, the note wins. Those differences are in the pull request.

## Checklist

| Spike | Result | Build | Where the edits are |
|---|---|---|---|
| S-01 | Pass | Windows 11 Home 10.0.26300, Electron 45.0.0, commit 8f4c177, 27 October 2026 | SRS 5.2 below. Architecture 5.6, 6.1, 6.2, risks R-06 and R-07, 9.1. |
| S-02 | Pass | Windows 11 Home 10.0.26300, Electron 45.0.0, commit 0f95f5f, package Obelisk.SpikeS02 0.0.1.0, 27 October 2026 | SRS 6.3 (FR-18) below. Architecture 6.4, ADR-009, 9.1. |
| S-03 | Pass, with a condition. FR-57 is not cut. | mathml2omml 0.5.0, KaTeX 0.19.1, docx 9.14.0, commit 42279f4, CI run 40527700478. Word: Microsoft 365 Version 2610, 27 October 2026. The Word session was not the CI runner. | SRS 5.2 and 6.11 below. Architecture ADR-005, ADR-012, 9.1. |
| S-04 | Pass. APPROVED 27 October 2026: no elkjs, dagre layout, and strip `click` and `href` before render. FR-82 is not cut. | Mermaid 12.2.0, KaTeX 0.19.1, Electron 45.0.0. Measured run 40464232909 is commit 912eabd, Windows image 20261021.278.1. The allowlist is in the merged note, commit 5db8131. | SRS 6.18, 10.4, 11, and the license reference below. Architecture 6.4, section 9, OD-05, ADR-010, 9.1. |
| S-05 | Pass | Windows 11 Home 10.0.26300, Electron 45.0.0, commit 7ea3b12, 27 October 2026 | SRS 6.3 (FR-12) and the Export reference below. Architecture 6.2, 6.3, 6.9, 9.1. |
| S-06 | Pass | Electron 45.0.0, Chrome 156.0.8078.48, Windows image 20261021.278.1, Ubuntu image 20261023.334.3, CI run 40461995542 | SRS 6.10 and the Image reference below. Architecture 6.6, 9.1. |
| S-07 | Pass. The unsaved-signature fallback is not needed. | Windows 11 Home 10.0.26300, Electron 45.0.0, commit a9f8119, package Obelisk.SpikeS07 0.0.1.0, 27 October 2026. Smart App Control was off. | SRS 7.2 below. Architecture 5.6, 6.8, ADR-007, 9.1. |
| S-08 | Partial on the OS sandbox. Codec checks passed. APPROVED 27 October 2026: keep the utility process. ADR-013 stays. The main-process fallback is not taken. | yauzl 3.4.0, yazl 3.3.1, Electron 45.0.0, Node 22.23.4, Windows image 20261021.278.1, CI runs 40442767845 and 40443190314 | File format reference below. The caps, name rules, identical saves, and the utility-process answer are in the architecture draft (ADR-013, 6.4, 6.6, 6.10). |
| S-09 | Pass. ADR-012 is kept. | docx 9.14.0, Node 22.23.4, Microsoft 365 Version 2610. CI run 40522475439 packed an earlier file on Windows image 20261021.278.1. The findings note is commit 3be6bd6. | SRS 5.2 and the Export reference below. Architecture ADR-012, 6.9, H-26, 9.1. |

## On approval

Add this row to the revision history, and set the title date and version to 1.3. Do not add it in this pull request.

| Version | Date | Changes |
|---|---|---|
| 1.3 | The day these edits are applied | Recorded spikes S-01 to S-09. Closed the UNVERIFIED lines those spikes settled. |

## S-01. MSIX save paths

### SRS 5.2 Assumptions, the save-path row

**Spike:** S-01

**Section:** 5.2 Assumptions

**Current text:**

> Saving files to the user's folders is not redirected by MSIX. | Spike S-01 in the architecture.

**Proposed text:**

> Saving files to the user's folders is not redirected by MSIX. | Checked in spike S-01 on 27 October 2026, Windows 11 Home 10.0.26300, Electron 45.0.0, commit 8f4c177. Documents on that PC is OneDrive Known Folder Move, and a local Desktop folder was the second folder. Both writes landed on the real path. App data was redirected, and a document must not default to that folder. See architecture section 5.6.

The FR text for save is unchanged. NFR-10 and NFR-12 stay as written.

## S-03 and S-09. Word opens the export

### SRS 5.2 Assumptions, the Word row

**Spike:** S-03 and S-09

**Section:** 5.2 Assumptions

**Current text:**

> Word for Windows opens the exported .docx, including OMML equations. | Open test exports in current Word.

**Proposed text:**

> Word for Windows opens the exported .docx, including OMML equations. | Checked in Microsoft 365 Version 2610. Spike S-03 opened the six Formula reference samples as editable equations. Spike S-09 opened the Export reference rows, the same six samples as equations and as images, and a 50-page file.

## S-02. Double-click and the second instance

### SRS 6.3 Files, the note under FR-18

**Spike:** S-02

**Section:** 6.3 Files, the UNVERIFIED paragraph under the table

**Current text:**

> **UNVERIFIED:** Opening a double-clicked file in the running instance (FR-18) relies on the MSIX file-type association and app.requestSingleInstanceLock with the second-instance event. Check both in a packaged MSIX build.

**Proposed text:**

> Checked in spike S-02 on 27 October 2026, Windows 11 Home 10.0.26300, Electron 45.0.0, commit 0f95f5f, package Obelisk.SpikeS02 0.0.1.0. A double-clicked file reached the process on a cold start through argv. A second double-click reached the running process through `app.requestSingleInstanceLock` and the `second-instance` event. One window stayed open.
>
> Selecting three files and pressing Enter delivered three `second-instance` events, one path each. Open with, and the app execution alias, also put the path on argv.
>
> The `second-instance` argv includes Chromium switches before the path. Main takes the file paths out of argv. It does not read a fixed index.
>
> Explorer set the working directory to `C:\WINDOWS\System32`. A relative path is not resolved against that directory.
>
> FR-18 keeps this design (ADR-009). The unused fallback was to drop FR-18, or to use an MSIX activation object. This run did not need that. `Windows.ApplicationModel.AppInstance.GetActivatedEventArgs` is not on Electron's `app` object.

The FR-18 row is unchanged.

## S-03. Word equations

### SRS 6.11 Formulas, the note under FR-57

**Spike:** S-03

**Section:** 6.11 Formulas, the UNVERIFIED paragraph under the table

**Current text:**

> **UNVERIFIED:** How faithfully mathml2omml converts KaTeX MathML (matrices, accents, alignment) is unchecked. Check the samples in the Formula reference in Word.

**Proposed text:**

> Checked in spike S-03 (mathml2omml 0.5.0, KaTeX 0.19.1, docx 9.14.0, Microsoft 365 Version 2610 on Windows, 27 October 2026). The six Formula reference samples open in Word as editable equations, display and inline. FR-57 keeps mathml2omml 0.5.0.
>
> The exporter still cleans the OMML before it is written.
>
> - The sum's n-ary body is empty, and Word shows an empty placeholder with the summand beside it. The following sibling moves into that body.
> - Matrix parentheses are plain math runs and do not stretch. Stretchy fences around a matrix, and stretchy `mo` fences in general, become a delimiter with `begChr` and `endChr`.
> - Display equations are wrapped in `m:oMathPara`. In one sample the display matrix sat at the right edge and the closing parenthesis was cut off.
>
> The dropped thin space in the integral, and the combining circumflex on theta, looked right. They stay as they are.
>
> A formula whose MathML contains `<` uses `mml2omml` with `disableDecode` set, so the XML stays well-formed.
>
> `ImportedXmlComponent.fromXmlString()` in docx 9.14.0 returns a document node. Inserting that node writes an element named `undefined`, and Word refuses the file. The `m:oMath` child is what goes in the paragraph. Spike S-09 saw the same refusal.
>
> Alignment is still unchecked. The Formula reference has no alignment sample.
>
> FR-56 stays the image fallback when a conversion fails.

The FR-56 and FR-57 rows are unchanged.

**Not taken.** If Word had refused the samples, the fallback would have been images only (FR-56) and a cut of FR-57. The samples opened and edited, so that fallback is not proposed. No FR is cut. The cleanup is part of building FR-57, in issue #75, with tests.

## S-04. Mermaid and the style policy

### SRS 6.18 Diagram block, the note under FR-82

**Spike:** S-04

**Section:** 6.18 Diagram block

**Current text:**

> **UNVERIFIED:** Mermaid's license, bundle size, and fully offline rendering inside a sandboxed Electron renderer (OD-05). Check: mermaid.js.org and its repository.

**Proposed text:**

> Spike S-04 checked Mermaid 12.2.0. The license is MIT. The renderer bundle was 12,325,210 bytes, plus 1,076,572 bytes of KaTeX fonts. A sandboxed Electron 45 renderer made no network request.
>
> A readable flowchart uses a post-process: style attributes move into the diagram stylesheet, only drawing properties are kept, every selector is prefixed with the diagram id, and one style element is allowed with a per-render nonce. `style-src-elem` is `app:` plus that nonce. `style-src-attr` is `'none'`. There is no `'unsafe-inline'`.
>
> APPROVED 27 October 2026. Diagrams use Mermaid's dagre layout. That layout is MIT. elkjs is not shipped, and there is no ELK layout option. Spike S-04 left the layout unset, and Mermaid 12.2.0 then used elk. That choice is not kept.
>
> APPROVED 27 October 2026. Before a diagram is rendered, `click` lines and `href` values are removed from its source. A link cannot be left on the picture.

The FR-82 and FR-83 rows are unchanged.

**Not taken.** Cutting the diagram block (FR-82) was one of the options. It is not proposed. Shipping elkjs is not proposed.

### SRS 10.4 Software libraries, the Mermaid row and the note

**Spike:** S-04

**Section:** 10.4 Software libraries

**Current text:**

> Mermaid | Diagram block (proposed) | MIT (UNVERIFIED) | mermaid.js.org
>
> **UNVERIFIED:** Licenses other than mathml2omml, docx, JSZip, yauzl, and yazl (checked on npm) are as published by each project, not yet rechecked. Versions are set in the architecture document.

**Proposed text:**

> Mermaid | Diagram block (proposed) | MIT for 12.2.0, checked in spike S-04. Layout is dagre, which is MIT. elkjs is not shipped (APPROVED 27 October 2026). Mermaid still uses DOMPurify 3.4.17 (MPL-2.0 OR Apache-2.0). | mermaid.js.org
>
> **UNVERIFIED:** mathml2omml, docx, JSZip, yauzl, and yazl were checked on npm. Spike S-04 also checked Mermaid 12.2.0 (MIT) and KaTeX 0.19.1 (MIT). Other licenses are as published by each project and are not yet rechecked. Versions are set in the architecture document.

### Open-source license reference, the Mermaid row

**Spike:** S-04

**Section:** Open-source license reference

**Current text:**

> Mermaid | MIT (UNVERIFIED) | About

**Proposed text:**

> Mermaid | MIT for 12.2.0 (spike S-04). Layout is dagre (MIT). elkjs is not shipped. | About

The LGPL note under that table is not changed. S-03 did not settle what LGPL-3.0 requires inside an MSIX.

### SRS 11, OD-05

**Spike:** S-04

**Section:** 11 Open decisions, OD-05

**Current text:**

> OD-05 | Diagram engine and syntax | Mermaid (wide use, large); PlantUML (needs Java); none | Mermaid, bundled, offline; license to verify | Open

**Proposed text:**

> OD-05 | Diagram engine and syntax | Mermaid (wide use, large); PlantUML (needs Java); none | Mermaid 12.2.0, bundled, offline, dagre layout (MIT). No elkjs. Style post-process and per-render nonce from spike S-04. `click` and `href` are stripped before render. | Decided 2026-10-27. APPROVED 27 October 2026.

## S-05. The Windows replace prompt

### SRS 6.3 Files, the note under FR-12

**Spike:** S-05

**Section:** 6.3 Files, the UNVERIFIED paragraph under the table

**Current text:**

> **UNVERIFIED:** Whether the Windows Save dialog itself asks before replacing a file depends on dialog options Electron sets. Until checked, Obelisk shows its own confirmation for FR-12. Check: Electron dialog.showSaveDialog docs and a test on Windows 11.

**Proposed text:**

> Checked in spike S-05 on 27 October 2026, Windows 11 Home 10.0.26300, Electron 45.0.0, commit 7ea3b12. For Save As (`.obk`) and Export (`.docx`), `dialog.showSaveDialog` is owned by the app window. The Windows replace prompt appeared and stayed until a click. That includes a name typed without the extension, when the filter supplied `.obk` or `.docx`.
>
> Replace returned the existing path. Cancel returned canceled and left the file unchanged. The dialog did not write the file.
>
> Obelisk relies on that Windows prompt for Save As and Export. It does not show a second prompt. Obelisk's own prompt stays the fallback for another platform, or if a later Windows build stops asking.

The FR-12 row is unchanged.

### Export reference, the extension

**Spike:** S-05

**Section:** Export reference, a new bullet after the existing bullets

**Current text:** There is no sentence about the Save dialog filter and the extension. The bullets cover Markdown escaping, image folder names, the replace prompt for an existing images folder, and a failed export.

**Proposed text:**

> Spike S-05 checked an existing `.obk` name with a Word `.docx` filter. Windows kept the `.obk` name and asked to replace that file. The filter did not change the extension. Export sets the extension itself. It does not rely on the filter to turn a name into `.docx` or `.obk`.

## S-06. GIF and WebP frames

### SRS 6.10 Images, the note under FR-49

**Spike:** S-06

**Section:** 6.10 Images

**Current text:**

> **UNVERIFIED:** Counting frames and reading frame sizes from GIF and WebP headers before decoding, and taking the first frame for export, are unchecked. Check against the GIF89a and WebP container specifications in spike S-06 of the architecture.

**Proposed text:**

> Checked in spike S-06 (Electron 45.0.0, Windows image 20261021.278.1, Ubuntu image 20261023.334.3, CI run 40461995542). Frame counts and frame sizes for GIF and WebP, including animated WebP, are read from the GIF89a blocks and the WebP RIFF chunks before any pixel decode. The first frame used for Word, PDF, and print is a PNG made in the sandboxed renderer from `ImageDecoder` frame 0. See architecture section 6.6.

### Image reference, the export row

**Spike:** S-06

**Section:** Image reference, "Animated in exports"

**Current text:**

> PDF, Word, and print use the first frame; Markdown keeps the original file

**Proposed text:**

> PDF, Word, and print use a PNG of the first frame, made in the sandboxed renderer at export time (spike S-06). Markdown keeps the original file.

OD-18 stays decided. The fallback that refuses animated WebP and keeps GIF only is not proposed.

## S-07. Saved signatures

### SRS 7.2 Security and privacy, the note under NFR-09

**Spike:** S-07

**Section:** 7.2 Security and privacy

**Current text:**

> **UNVERIFIED:** The synchronous safeStorage API is deprecated from Electron 45 and due for removal in Electron 46, so Obelisk uses the async API and its temporarily unavailable state. Check that behavior in the Electron version chosen, and DPAPI inside an MSIX package (architecture spike S-07).

**Proposed text:**

> Checked in spike S-07 on 27 October 2026, Windows 11 Home 10.0.26300, Electron 45.0.0, commit a9f81193dc9a9e668a11510128986084c26bb1cb, package Obelisk.SpikeS07 0.0.1.0. Obelisk uses the async safeStorage API. The sync methods are deprecated in Electron 45 and due for removal in Electron 46.
>
> DPAPI inside the MSIX package encrypted and decrypted the signature, including after a restart. The ciphertext held no readable name or image. `shouldReEncrypt` was false.
>
> While encryption is unavailable, nothing is saved or deleted (NFR-09). Check `isEncryptionAvailable` before saving a signature. `isAsyncEncryptionAvailable` stayed true even when the key was bad, so it is not the unavailable check.
>
> A stored key that does not start with `DPAPI` makes `isEncryptionAvailable` false, and encrypt fails too. A bad key otherwise shows up only as `Error while decrypting the ciphertext provided to safeStorage.decryptStringAsync.` The "temporarily unavailable" string did not appear. Treat any decrypt failure as signature unavailable: save nothing and delete nothing.

The NFR-08 and NFR-09 rows are unchanged.

**Not taken.** If the packaged round trip had failed, saved signatures would stay unsaved while encryption is unavailable (NFR-09). That fallback is not proposed.

Smart App Control is a test note, not an SRS requirement. It is in the architecture draft, section 5.6.

## S-08. yauzl, yazl, and the utility process

### File format reference, a note after the table

**Spike:** S-08

**Section:** File format reference

**Current text:** The table already sets the entry names, the 200 MB file cap, the 2,000-entry cap, and the 25 MB, 20 MB, and 250 MB uncompressed caps. There is no UNVERIFIED line on this table. The open question was architecture section 6.4 (a sandboxed utility process) and ADR-013.

**Proposed text:** Add this note after the table.

> Checked in spike S-08 (yauzl 3.4.0, yazl 3.3.1, Electron 45.0.0, Windows image 20261021.278.1). Hostile samples H-01 to H-09 were refused. That includes a bomb whose headers claim a tiny size, stopped at the real-byte caps. Bad names were refused: `../`, a leading slash, a backslash, drive letters, network paths, stream suffixes, `CON`, and case duplicates. Two saves of a 200-image document were the same bytes. A refused file was unchanged (FR-09).
>
> Decoding runs in a utility process. Electron 45 does not OS-sandbox that process. The checks above are the defence. ADR-013 stays. APPROVED 27 October 2026: the main-process fallback is not taken. No FR is cut.

## S-09. Word export with docx

### Export reference, new bullets

**Spike:** S-09. ADR-012 is kept. The fallback, writing the OOXML ourselves behind the ADR-006 interface, does not apply. No FR is cut.

**Section:** Export reference, new bullets after the current ones. The table row for lists and checklist changes. The formula, image, and page-break rows stay.

**Current text:**

> Lists and checklist | As on the page | Word lists; checkbox symbols | -, 1., - [ ]
>
> The bullets after the table do not mention control characters, picture crop, the document font, table width, or a checkbox choice. Letter paper is already required in section 5.1.

**Proposed text:**

> Lists and checklist | As on the page | Word lists. Checkboxes are an option: a read-only Segoe UI Symbol mark, or a clickable Word checkbox content control. | -, 1., - [ ]
>
> New bullets:
>
> - Before Word text, alt text, or link text is written, XML 1.0-illegal control characters are removed. docx escapes `<`, `&`, and `]]>`. Unpaired surrogates do not survive as surrogates. Spike S-09: Word and LibreOffice both refused a file that still contained those control characters.
> - Exported pictures of equations, drawings, and diagrams are cropped to their content, with a small margin, and rendered at 2× or more.
> - The Word exporter sets Letter page size and the margins itself. The docx library's default page is A4. It also sets the document's font and each table's width. It does not leave those to the library. The spike files used Calibri 11 pt only because they were not Obelisk documents. Obelisk uses the document font, Liberation Serif 12 pt unless the user changed it.

mathml2omml fidelity stays with spike S-03. The equations in S-09 were Office Math written for the samples, not mathml2omml output.

## Left unchanged

These UNVERIFIED lines were not settled by S-01 to S-09. They stay.

- FR-31, the Windows spell checker.
- FR-41, the HTML clipboard and Word.
- NFR-25 and OD-11, the Store minimum Windows version.
- The LGPL-3.0 note for mathml2omml inside an MSIX, and the font licenses (OD-08).
- The keyboard note on Ctrl+Space and a non-US layout.
- The MLA Handbook check.
- The paste note on detached HTML and custom clipboard formats.
- The date-format note on Region settings.
- Alignment in the Formula reference, called out under S-03 above. It stays unchecked on purpose.
