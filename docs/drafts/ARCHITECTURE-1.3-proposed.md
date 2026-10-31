# Proposed architecture edits for version 1.3

Prepared by Filliciano Plong. These are drafts only. `docs/SRS.md` and `docs/ARCHITECTURE.md` stay at version 1.2 until I apply them.

Issue #16 asked for 1.2 edits. The next document version is 1.3, so this draft is named for 1.3. The SRS half is `docs/drafts/SRS-1.3-proposed.md`.

Each edit gives the section, the current text, the proposed text, and the spike it comes from. The notes in `spikes/s01` through `spikes/s09` are the source.

## Checklist

| Spike | Result | Build | Where the edits are |
|---|---|---|---|
| S-01 | Pass | Windows 11 Home 10.0.26300, Electron 45.0.0, commit 8f4c177, 27 October 2026 | 5.6, 6.1, 6.2, R-06, R-07, 9.1 below. SRS 5.2. |
| S-02 | Pass | Windows 11 Home 10.0.26300, Electron 45.0.0, commit 0f95f5f, package Obelisk.SpikeS02 0.0.1.0, 27 October 2026 | 6.4, ADR-009, 9.1 below. SRS 6.3 (FR-18). |
| S-03 | Pass, with a condition. FR-57 is not cut. | mathml2omml 0.5.0, KaTeX 0.19.1, docx 9.14.0, commit 42279f4, CI run 40527700478. Word: Microsoft 365 Version 2610, 27 October 2026. The Word session was not the CI runner. | ADR-005, ADR-012, 9.1 below. SRS 5.2 and 6.11. |
| S-04 | Pass. APPROVED 27 October 2026: no elkjs, dagre layout, and strip `click` and `href` before render. FR-82 is not cut. | Mermaid 12.2.0, KaTeX 0.19.1, Electron 45.0.0. Measured run 40464232909 is commit 912eabd, Windows image 20261021.278.1. The allowlist is in the merged note, commit 5db8131. | 6.4, section 9, OD-05, ADR-010, 9.1 below. SRS 6.18, 10.4, 11, license reference. |
| S-05 | Pass | Windows 11 Home 10.0.26300, Electron 45.0.0, commit 7ea3b12, 27 October 2026 | 6.2, 6.3, 6.9, 9.1 below. SRS 6.3 (FR-12) and the Export reference. |
| S-06 | Pass | Electron 45.0.0, Chrome 156.0.8078.48, Windows image 20261021.278.1, Ubuntu image 20261023.334.3, CI run 40461995542 | 6.6, 9.1 below. SRS 6.10 and the Image reference. |
| S-07 | Pass. The unsaved-signature fallback is not needed. | Windows 11 Home 10.0.26300, Electron 45.0.0, commit a9f8119, package Obelisk.SpikeS07 0.0.1.0, 27 October 2026. Smart App Control was off. | 5.6, 6.8, ADR-007, 9.1 below. SRS 7.2. |
| S-08 | Partial on the OS sandbox. Codec checks passed. APPROVED 27 October 2026: keep the utility process. ADR-013 stays. The main-process fallback is not taken. | yauzl 3.4.0, yazl 3.3.1, Electron 45.0.0, Node 22.23.4, Windows image 20261021.278.1, CI runs 40442767845 and 40443190314 | Section 4, 6.4, 6.6, 6.10, ADR-013, R-08, 9.1 below. |
| S-09 | Pass. ADR-012 is kept. | docx 9.14.0, Node 22.23.4, Microsoft 365 Version 2610. CI run 40522475439 packed an earlier file on Windows image 20261021.278.1. The findings note is commit 3be6bd6. | ADR-012, 6.9, H-26, 9.1 below. SRS 5.2 and the Export reference. |

## On approval

Add this row to the revision history, and set the title date and version to 1.3. Do not add it in this pull request.

| Version | Date | Changes |
|---|---|---|
| 1.3 | The day these edits are applied | Recorded spikes S-01 to S-09. Closed the UNVERIFIED lines those spikes settled. Based on SRS 1.3. |

## S-01. MSIX save and rename

Pass. NFR-10, NFR-12, R-06, and R-07 keep the current design, with the retry and the error text below. The fail fallback (change writeAtomic) is not used.

### 5.6 Deployment view

**Spike:** S-01

**Section:** 5.6 Deployment view, the limitation and the UNVERIFIED line

**Current text:**

> **Limitation:** MSIX redirection of app data is from Microsoft docs, not yet tested here.
>
> **UNVERIFIED:** MSIX redirects writes to app data but not to user folders such as Documents. Check in spike S-01; source: Microsoft MSIX docs.

**Proposed text:**

> **Limitation:** Checked in spike S-01. Documents and a local folder are not redirected. App data is.
>
> Checked in spike S-01 on 27 October 2026, Windows 11 Home 10.0.26300, Electron 45.0.0, commit 8f4c177. MSIX did not redirect Documents or the local Desktop. Documents on that PC is OneDrive Known Folder Move, `C:\Users\filli\OneDrive\Documents`, and `app.getPath('documents')` returned that path. The second folder was the plain local Desktop.
>
> It did redirect `app.getPath('userData')`, Roaming, and Local into the package LocalCache (`...\Packages\Obelisk.SpikeS01_09826e2d9xne4\LocalCache\`). Those files are private to the package and are removed on uninstall. Settings and recovery files can live there. A document must not default to AppData.

### 6.1 Save contract, the retry row

**Spike:** S-01

**Section:** 6.1 Save contract, Retry

**Current text:**

> On EPERM or EBUSY during the rename (antivirus, indexer): 3 tries, 100 ms apart, then EBUSY_EXHAUSTED

**Proposed text:**

> On EPERM, EBUSY, or EACCES during the rename (antivirus, indexer, or a brief lock): 3 tries, 100 ms apart, then EBUSY_EXHAUSTED. One rename in the OneDrive Documents folder failed once with EPERM, and the next try replaced the file (spike S-01). If the tries are used up, show the error, keep the previous file, and delete the temp file.

The stress loop in the spike used twelve tries, 40 ms apart, so a short lock would show up. That count is the measurement, not the product rule. The product rule stays three tries, 100 ms apart, and gains EACCES.

### 6.1 Save contract, the UNVERIFIED line

**Spike:** S-01

**Section:** 6.1 Save contract, the paragraph under the table

**Current text:**

> **UNVERIFIED:** That fs.rename over an existing file maps to an atomic replace (MoveFileEx with replace) on NTFS from an MSIX-packaged app. Check in spike S-01; source: Node.js fs docs and libuv.

**Proposed text:**

> Checked in spike S-01 on the same build as section 5.6. In the packaged MSIX, writeAtomic's temp file and rename landed in the real Documents folder and in the second folder. Get-Item from outside the package opened those paths, the hashes matched, and the paths were not under the package LocalCache. The outside watcher saw only complete payloads during the replaces. `fs.rename` over the existing file is the one replace step on those folders.

### 6.2 Alternatives, the Error row

**Spike:** S-01

**Section:** 6.2 Alternatives, Error

**Current text:**

> Disk full, access denied, path gone, retries used up, document fails the schema | Return error with its code; temp file removed; Retry offered when retryable

**Proposed text:**

> Disk full, access denied, path gone, retries used up, document fails the schema, a read-only target, or a file another program has open | Return error with its code; temp file removed; the previous file stays; Retry offered when retryable. A read-only target and a file held open both returned EPERM (errno -4048) in spike S-01. The message says which of those two it is.

### 8. Risks, R-06 and R-07

**Spike:** S-01 for both. S-02 also closes the activation half of R-06.

**Section:** 8 Risks, the Mitigation cells

**Current text:**

> R-06: Spikes S-01 and S-02 in a packaged build before the file features are built
>
> R-07: Retry 3 times at 100 ms, then report; never leave a partial file (NFR-10)

**Proposed text:**

> R-06: Spike S-01 passed. Documents (OneDrive) and a local folder were not redirected, and the rename replaced the file in one step. Spike S-02 passed. A double-clicked file arrived on argv, and a second file arrived through `second-instance`. Both on Windows 11 Home 10.0.26300, Electron 45.0.0.
>
> R-07: Retry EPERM, EBUSY, and EACCES three times, 100 ms apart, then report. A read-only file and a file another program has open both returned EPERM. The old file stayed. Never leave a partial file (NFR-10). Checked in spike S-01.

### 9.1 Spikes, the S-01 row

**Spike:** S-01

**Section:** 9.1 Spikes

**Current text:**

> In a packaged MSIX build, save to Documents and confirm the write is not redirected and the rename replaces the file in one step. | R-06, R-07

**Proposed text:**

> Checked, pass, 27 October 2026, commit 8f4c177, Electron 45.0.0, Windows 11 Home 10.0.26300. Documents (OneDrive) and the local Desktop were not redirected. The rename replaced the file in one step. | R-06, R-07

## S-02. Explorer open and the second instance

Pass. FR-18 and ADR-009 stay. The fail fallback (drop FR-18, or use another activation path) is not used.

### 6.4 Security baseline, command-line arguments

**Spike:** S-02

**Section:** 6.4 Security baseline, the command-line bullet

**Current text:**

> Command-line arguments: only existing regular .obk files are taken, up to 20 per launch; other arguments are ignored.

**Proposed text:**

> Command-line arguments: only existing regular .obk files are taken, up to 20 per launch; other arguments are ignored. In `second-instance`, Chromium switches come before the path, so main picks file paths out of argv by filtering, never by a fixed index. A relative path is not resolved against the working directory. Explorer set that directory to `C:\WINDOWS\System32` (spike S-02). Selecting several files delivers one event per file.

### ADR-009

**Spike:** S-02

**Section:** ADR-009, Decision and Consequences

**Current text:**

> Decision: Main takes the single-instance lock; a second launch passes its arguments through the second-instance event, and main keeps only .obk files. RecoveryService writes recovery copies through writeAtomic, named by UUIDs main makes; the renderer's timer sends them (OD-16).
>
> Consequences: One window, one place for recovery. Costs: the lock must release on crash, and the activation path needs an MSIX test (R-06).

**Proposed text:**

> Decision: Main takes the single-instance lock. A second launch passes its arguments through the `second-instance` event. Main keeps only .obk files, picked out of argv by filtering. Several selected files are one event each. RecoveryService writes recovery copies through writeAtomic, named by UUIDs main makes; the renderer's timer sends them (OD-16).
>
> Consequences: One window, one place for recovery. The lock must release on crash. Checked in spike S-02 on 27 October 2026, Windows 11 Home 10.0.26300, Electron 45.0.0, commit 0f95f5f. A cold start and a second double-click both delivered the path, and one window stayed open. Open with and the app execution alias did too. Explorer's working directory was `C:\WINDOWS\System32`, so a relative path is not resolved against it. `GetActivatedEventArgs` is not on Electron's `app` object. The path was already on argv, so this design does not call it.

### 9.1 Spikes, the S-02 row

**Spike:** S-02

**Section:** 9.1 Spikes

**Current text:**

> Double-click an .obk file with Obelisk running; confirm the path arrives through the second-instance event. | R-06

**Proposed text:**

> Checked, pass, 27 October 2026, commit 0f95f5f, Electron 45.0.0, Windows 11 Home 10.0.26300. The path arrived on argv for a cold start, and through `second-instance` when the app was already running. | R-06

## S-03. mathml2omml in Word

Pass, with a condition. The condition is a small OMML cleanup in the exporter, covered by tests, when FR-57 is built (issue #75). mathml2omml 0.5.0 stays. FR-57 is not cut.

**Not taken.** If Word had refused the samples, the fallback would have been images only (FR-56) and a cut of FR-57. That fallback is not proposed.

Alignment is still unchecked. The Formula reference has no alignment sample. ADR-005 stays OMML, with the image fallback when a conversion fails. R-01's mitigation stays that fallback, not a second converter.

### ADR-005

**Spike:** S-03

**Section:** ADR-005, Consequences and Revisit when

**Current text:**

> Consequences: Word export never fails because of a formula. Costs: an LGPL module (NFR-29) and possible fidelity gaps (R-01).
>
> Revisit when: mathml2omml fidelity is poor on the SRS samples.

**Proposed text:**

> Consequences: Word export never fails because of a formula. Costs: an LGPL module (NFR-29) and a small OMML cleanup before the equation is written (spike S-03). The sum's empty n-ary body, stretchy matrix fences, and a display `m:oMathPara` wrap are that cleanup. Alignment is still unchecked.
>
> Revisit when: the cleanup cannot be done, or a later alignment sample looks wrong in Word. A conversion that still fails uses the image fallback (FR-56).

The decision row is unchanged: KaTeX on screen and in PDF, mathml2omml for Word, PNG on failure.

### 9.1 Spikes, the S-03 row

**Spike:** S-03

**Section:** 9.1 Spikes

**Current text:**

> Convert the SRS formula samples with mathml2omml and open them in Word. | R-01

**Proposed text:**

> Checked, pass with a condition. Package checks: commit 42279f4, CI run 40527700478. Word: Microsoft 365 Version 2610 on a Windows desktop, 27 October 2026, not the CI runner. The six samples were editable. The exporter cleans the OMML as in ADR-005. Alignment is still unchecked. | R-01

The `fromXmlString` wrapper is in the ADR-012 edit under S-09. S-03 found it first. Both spikes refused the raw return value in Word.

## S-04. Mermaid strict and the style policy

Pass on the chosen path. Mermaid 12.2.0 renders at `securityLevel: 'strict'`, offline, in the sandboxed renderer, with `script-src app:`. Under the current `style-src app:` the flowchart is not readable. The chosen fix is post-process, then one per-render nonce.

**Not taken.** Cutting the diagram block (FR-82) is not proposed. Opening `'unsafe-inline'` on style is not proposed. Shipping elkjs is not proposed.

**APPROVED 27 October 2026.** Two decisions from the owner.

1. Do not ship elkjs. Diagrams use Mermaid's dagre layout, which is MIT. There is no ELK layout option. Spike S-04 left `layout` unset, and Mermaid 12.2.0 then used elk. That choice is not kept.
2. Before a diagram is rendered, remove `click` lines and `href` values from its source. A link cannot be left on the picture.

The spike note calls the stack row "section 8". In version 1.2 that row is in section 9. The edit below is section 9.

### 6.4 Security baseline, the policy bullet

**Spike:** S-04

**Section:** 6.4 Security baseline, the Content Security Policy bullet

**Current text:**

> Content Security Policy: default-src 'none'; scripts, styles, and fonts from app: only; images from app:, data:, and blob:; no connect, frame, or object sources.

**Proposed text:**

> Content Security Policy: default-src 'none'; script-src app:; style-src-elem app: plus a per-render nonce; style-src-attr 'none'; fonts from app: only; images from app:, data:, and blob:; no connect, frame, or object sources. No 'unsafe-inline' and no 'unsafe-eval'. Spike S-04.

### 6.4 Security baseline, the style-src line

**Spike:** S-04

**Section:** 6.4 Security baseline, the first UNVERIFIED line under the library table

**Current text:**

> **UNVERIFIED:** Which style-src KaTeX output needs under this policy, and whether Mermaid strict output needs any. Check in spike S-04.

**Proposed text:**

> Checked in spike S-04 (Mermaid 12.2.0, KaTeX 0.19.1, Electron 45.0.0). CI run 40464232909, commit 912eabd, measured the flowchart before the allowlist. The merged note (commit 5db8131) remeasures `rewrite-nonce` after the allowlist and the selector prefix, and the job fails if that check does not pass. On the local sandboxed host the flowchart was 186 by 467, fill `rgb(51, 51, 51)`, with no style attributes left.
>
> Under `style-src app:`, with `script-src app:` and the network off, KaTeX rendered the Formula reference samples (HTML and MathML) from `app:` fonts. Mermaid at `securityLevel: 'strict'` returned an SVG for the diagram types tried. The flowchart's theme style element and its `max-width` attribute were both blocked.
>
> The chosen path moves those style attributes into the diagram stylesheet. It keeps only drawing properties: fill, fill-opacity, fill-rule, stroke, stroke-width, stroke-dasharray, stroke-dashoffset, stroke-linecap, stroke-linejoin, stroke-miterlimit, stroke-opacity, opacity, color, font-family, font-size, font-weight, font-style, text-anchor, dominant-baseline, width, height, max-width, min-width, max-height, and min-height.
>
> It drops `url()`, `@import`, `position`, `content`, `display`, and any declaration or selector that contains `{`, `}`, or `<`. Every selector is prefixed with the diagram id. That one style element is allowed with a per-render nonce. On that path the sample flowchart measured 186 by 467 with fill `#333`.
>
> Layout is dagre. Do not set `layout` to elk, and do not ship elkjs (APPROVED 27 October 2026). Before render, strip `click` lines and `href` values from the diagram source.

### 6.4 Security baseline, the advisories line

**Spike:** S-04, the Mermaid half only

**Section:** 6.4 Security baseline

**Current text:**

> **UNVERIFIED:** Fuses other than runAsNode and nodeCliInspect, and Mermaid's security advisories. Check when versions are pinned.

**Proposed text:**

> **UNVERIFIED:** Fuses other than runAsNode and nodeCliInspect. Check when versions are pinned.
>
> Mermaid 12.2.0, checked in spike S-04 on 27 October 2026: every GitHub advisory for mermaid-js/mermaid was patched at or before 11.16.1 (10.9.8 on the 10.x line). That includes the sequence XSS, the architecture `iconText` XSS, the `classDef` CSS injection, and the sibling-CSS injection. `npm audit` of that tree reported 0 vulnerabilities. Check again when the app pins a version.

The next UNVERIFIED line (printToPDF, pasted HTML, custom clipboard formats) is not changed. No spike settled it.

### Section 9, the Diagram row

**Spike:** S-04

**Section:** 9 Technology stack, Diagram. The spike note says "section 8".

**Current text:**

> Diagram | Mermaid, securityLevel strict | UNVERIFIED | Text diagrams, offline | MIT (UNVERIFIED)

**Proposed text:**

> Diagram | Mermaid, securityLevel strict, dagre layout | 12.2.0 (checked in spike S-04); pin when diagrams are built | Text diagrams, offline, with the style post-process in section 6.4. No ELK layout. | MIT for 12.2.0 and for dagre. elkjs is not shipped (APPROVED 27 October 2026). Mermaid still uses DOMPurify 3.4.17 (MPL-2.0 OR Apache-2.0).

### 11. Open decisions, OD-05

**Spike:** S-04

**Section:** 11 Open decisions, OD-05

**Current text:**

> OD-05 | Diagram engine and syntax | Mermaid, bundled, offline; license to verify | Open

**Proposed text:**

> OD-05 | Diagram engine and syntax | Mermaid 12.2.0, bundled, offline, dagre layout (MIT). No elkjs and no ELK option. Diagrams are inserted only after `click` and `href` are stripped and after the style post-process, the drawing-property allowlist, and a per-diagram selector prefix. style-src-elem is app: plus a per-render nonce. style-src-attr is 'none'. No 'unsafe-inline'. | Decided 2026-10-27. APPROVED 27 October 2026.

### ADR-010

**Spike:** S-04

**Section:** ADR-010, Decision and Consequences

**Current text:**

> Decision: BlockViews sets Mermaid up once with securityLevel strict, startOnLoad false, htmlLabels false, and an extended secure list (section 6.4) (OD-19).
>
> Consequences: Labels are plain text and click handlers are off. Cost: some styling a diagram could set is ignored.

**Proposed text:**

> Decision: BlockViews sets Mermaid up once with securityLevel strict, startOnLoad false, htmlLabels false, layout dagre, and an extended secure list (section 6.4) (OD-19). Before render, `click` lines and `href` values are removed from the diagram source (APPROVED 27 October 2026). Before the SVG enters the page, style attributes move into one stylesheet, filtered and scoped as in section 6.4, and that sheet is allowed with a per-render nonce (spike S-04). elkjs is not shipped.
>
> Consequences: Labels are plain text. Click links are stripped before render, and click handlers stay off. Some styling a diagram could set is dropped by the allowlist. The layout is dagre, which is MIT.

### 9.1 Spikes, the S-04 row

**Spike:** S-04

**Section:** 9.1 Spikes

**Current text:**

> Render a Mermaid flowchart at securityLevel strict in a sandboxed renderer with the network off, and find the style-src KaTeX and Mermaid output need. | OD-05, OD-19

**Proposed text:**

> Checked, pass, Electron 45.0.0, Mermaid 12.2.0, KaTeX 0.19.1. Sizes from CI run 40464232909 (commit 912eabd); the allowlist is in the merged note (commit 5db8131). Strict mode rendered offline. The readable path is the post-process and a per-render style nonce. APPROVED 27 October 2026: dagre layout, no elkjs, and `click` and `href` are stripped before render. | OD-05, OD-19

## S-05. The Windows replace prompt

Pass. On Windows, the Save dialog is the FR-12 confirmation. Obelisk does not ask again. The fail fallback (Obelisk's own prompt after the dialog) is not used on Windows. It stays for another platform, or if a later Windows build stops asking.

### 6.2 Alternatives, the Exists row, and the extension

**Spike:** S-05

**Section:** 6.2 Alternatives, Exists, plus a sentence after the table

**Current text:**

> A new target exists and the replace was not confirmed | Return exists; write nothing; file:saveAs shows the replace prompt and calls again after Replace

**Proposed text:**

> A new target exists and the replace was not confirmed | Return exists; write nothing. On Windows, Electron 45 sets `FOS_OVERWRITEPROMPT` on every save dialog. `showSaveDialog` is owned by the app window, and that prompt is the confirmation (spike S-05). `showOverwriteConfirmation` is not read on Windows. Main sets replaceConfirmed when the dialog returns the path. A canceled dialog writes nothing. The dialog itself does not write the file. Obelisk does not show a second prompt. On another platform, or if the Windows prompt stops staying until a click, Main shows Obelisk's own prompt before writing.
>
> After the table: Spike S-05 also tried an existing `.obk` name with a Word `.docx` filter. Windows kept the `.obk` name and asked to replace that file. Export sets the extension itself. It does not rely on the filter.

### 6.3 IPC surface, file:saveAs

**Spike:** S-05

**Section:** 6.3 IPC surface, `file:saveAs`

**Current text:**

> Main shows the Save dialog and replace prompt, then saves: file:save results with a new handle and name, or cancelled

**Proposed text:**

> Main shows the Save dialog, owned by the app window. On Windows that dialog is the replace prompt (spike S-05). Main sets replaceConfirmed when it returns an existing path, then saves: file:save results with a new handle and name, or cancelled

### 6.9 Paste, export, and print, the replace sentence

**Spike:** S-05. The S-09 rules are a separate edit below.

**Section:** 6.9, the export-dialog sentence

**Current text:**

> One export interface, export(format, document, assets, target), reached only through export:run (ADR-006). Main shows the Export dialog and the replace prompt.

**Proposed text:**

> One export interface, export(format, document, assets, target), reached only through export:run (ADR-006). Main shows the Export dialog. On Windows the Save dialog's replace prompt is the confirmation, and Obelisk does not ask again (spike S-05). Export sets the file extension itself.

### 9.1 Spikes, the S-05 row

**Spike:** S-05

**Section:** 9.1 Spikes

**Current text:**

> Confirm whether the Windows Save dialog asks before replacing a file, as Electron sets it. | FR-12

**Proposed text:**

> Checked, pass, 27 October 2026, Electron 45.0.0, Windows 11 Home 10.0.26300, commit 7ea3b12. The native prompt is the FR-12 confirmation on Windows. Obelisk does not ask again. | FR-12

## S-06. GIF and WebP frames

Pass. OD-18 stays: keep the animation and play it in the editor. Word, PDF, and print use a first-frame PNG made in the renderer. The fallback that refuses animated WebP and keeps GIF only is not proposed.

### 6.6 File checks and limits, the UNVERIFIED line

**Spike:** S-06

**Section:** 6.6 File checks and limits, the paragraph under the rules table

**Current text:**

> **UNVERIFIED:** Counting GIF and WebP frames without decoding, and making the first frame in the renderer. Check in spike S-06.

**Proposed text:**

> Checked in spike S-06 (Electron 45.0.0, Chrome 156.0.8078.48, Windows image 20261021.278.1, Ubuntu image 20261023.334.3, CI run 40461995542).
>
> GIF and WebP frame counts and frame sizes come from a container walk, before any pixel decode. Do not scan for a separator byte or for the letters ANMF.
>
> GIF blocks follow GIF89a. Image descriptors are frames. LZW sub-blocks are skipped by length. A Netscape loop count is not a frame count. A GIF with no trailer is refused.
>
> WebP chunks follow the RIFF container. The canvas comes from VP8X. Each ANMF rectangle is read from the frame header. x and y are in 2-pixel units. The VP8 or VP8L header inside the frame is peeked for the coded size. The RIFF size bounds the count. Chromium and libwebp 1.3.2 both ignore an ANMF chunk past it.
>
> The limits in this section apply to those sizes: 8000 pixels on a side, 1,000 frames, 250 million pixels across the frames, and each frame inside the canvas. A coded size that disagrees with the ANMF box is refused, and the pixel sum uses the larger box. ANMF chunks with the VP8X animation bit clear are still counted, and the file is refused, because the renderer cannot decode it.
>
> The first-frame PNG for Word, PDF, and print is made in the sandboxed renderer: `ImageDecoder` frame 0, drawn to a canvas at the canvas size, then `canvas.toBlob('image/png')`. The page had no Node. `process.sandboxed` was true.

### 9.1 Spikes, the S-06 row

**Spike:** S-06

**Section:** 9.1 Spikes

**Current text:**

> Count frames and read frame sizes of animated GIF and WebP files without decoding, and make a first-frame PNG in the renderer. | OD-18

**Proposed text:**

> Checked, pass, Electron 45.0.0, CI run 40461995542, Windows image 20261021.278.1 and Ubuntu image 20261023.334.3. Frame counts come from a container walk. The first-frame PNG is made in the sandboxed renderer. | OD-18

## S-07. safeStorage in the MSIX

Pass. NFR-08 and NFR-09 stay as written. ADR-007 stays. The fail fallback (keep signatures unsaved because encryption never works in the package) is not proposed.

The paragraph under NFR-09 is wider than the NFR row, on purpose. Any decrypt failure is treated as unavailable, not only the case where safeStorage says encryption is unavailable. The NFR rows themselves do not change.

### 6.8 App data records, the UNVERIFIED line

**Spike:** S-07

**Section:** 6.8 App data records

**Current text:**

> **UNVERIFIED:** safeStorage inside an MSIX package, including the temporarily unavailable state. Check in spike S-07.

**Proposed text:**

> Checked in spike S-07 on 27 October 2026, Windows 11 Home 10.0.26300, Electron 45.0.0, commit a9f81193dc9a9e668a11510128986084c26bb1cb, package Obelisk.SpikeS07 0.0.1.0. `encryptStringAsync` and `decryptStringAsync` round-tripped a signature in the packaged MSIX. The same ciphertext decrypted after a new process. The file held no readable name or PNG.
>
> `isEncryptionAvailable` was true on that path. `isAsyncEncryptionAvailable` was true too, including when the key was bad, so it is not the unavailable check. Check `isEncryptionAvailable` before saving a signature.
>
> A stored key that does not start with `DPAPI` makes `isEncryptionAvailable` false, and both encrypt and decrypt throw a generic error. A `DPAPI` prefix that `CryptUnprotectData` cannot open leaves `isEncryptionAvailable` true, and the old ciphertext fails with `Error while decrypting the ciphertext provided to safeStorage.decryptStringAsync.`
>
> The temporarily unavailable string did not appear. `shouldReEncrypt` was false. A bad key shows up only as a generic decrypt error, so any decrypt failure means the signature is unavailable: save nothing and delete nothing. Saved signatures keep ADR-007.

### ADR-007, the Decision

**Spike:** S-07

**Section:** ADR-007, Decision

**Current text:**

> SignatureStore keeps each signature as a PNG in its own file, encrypted with the async safeStorage API (OD-15). sig:list returns names only; sig:get decrypts one. Unavailable or temporarily unavailable: save and show nothing, delete nothing, say so.

**Proposed text:**

> SignatureStore keeps each signature as a PNG in its own file, encrypted with the async safeStorage API (OD-15). The sync methods are not used. sig:list returns names only; sig:get decrypts one. Check `isEncryptionAvailable` before a save. Unavailable, a failed encrypt, or any failed decrypt: save and show nothing, delete nothing, say so. Spike S-07 did not produce the temporarily unavailable string, and `shouldReEncrypt` was false.

### 5.6 Deployment view, Smart App Control

**Spike:** S-07. This is a finding, not an UNVERIFIED line. The S-07 note records it in the findings, and the running list records it too. The note's replacement paragraphs do not include a sentence for it, so this edit adds one.

**Section:** 5.6 Deployment view, a new sentence after the S-01 result

**Current text:** Section 5.6 has no Smart App Control sentence.

**Proposed text:**

> A dev-signed MSIX does not start while Smart App Control is enforcing, including through the app execution alias (spike S-07, Windows 11 Home 10.0.26300). Manual testing on that PC needs Smart App Control off, or a signature Windows trusts. Scripts launch the app through the alias, not the path under WindowsApps.

### 9.1 Spikes, the S-07 row

**Spike:** S-07

**Section:** 9.1 Spikes

**Current text:**

> In a packaged MSIX build, encrypt and decrypt a signature with the async safeStorage API, and force the unavailable and re-encrypt states. | OD-15

**Proposed text:**

> Checked, pass, 27 October 2026, commit a9f8119, Electron 45.0.0, Windows 11 Home 10.0.26300. The async API round-tripped in the MSIX, including after a restart. shouldReEncrypt was false. A bad key is a generic decrypt error, so any decrypt failure means the signature is unavailable. | OD-15

## S-08. yauzl, yazl, and the utility process

Partial. The question was two parts. The codec part passed. The sandbox part failed.

Passed, under Node 22.23.4 and inside the Electron 45 utility process, with the same reasons and the same byte counts on Windows and on Linux:

- Hostile samples H-01 to H-09 were refused. A bomb whose headers claim 64 bytes, and which really inflates past the cap, stopped at the cap. Reading did not continue to the real uncompressed size. A file over 200 MB and a 2,001-entry archive were refused before entry payloads were read.
- Real-byte caps. In this spike, 1 MB is 1024 × 1024 bytes. The document cap is 26,214,400 bytes (25 MB). The image cap is 20,971,520 bytes (20 MB). The total cap is 262,144,000 bytes (250 MB). The counted total stops on the cap. It does not include a chunk past it.
- Name rules. Refused: `../`, a nested `..`, a leading slash, a backslash, drive letters, a UNC path, `//server`, a stream suffix (`:Zone.Identifier`, `::$DATA`), and device names (`CON`, `CON.txt`, `con`, `images/CON.png`). `Manifest.json` beside `manifest.json` is a case duplicate. Two `document.json` entries are a repeated name. Names are the central-directory bytes, read as Latin-1. yauzl is not asked to rewrite `\` to `/`.
- Same bytes on save. Two yazl encodes of one 200-image document matched, in Node and in the utility process. Each archive was 64,677 bytes. The fixed modified time is what makes that true. Node's zlib and Electron's zlib are not required to match each other.
- Each refused file kept the same size, sha256, and mtime (FR-09). yauzl is opened read-only.

`validateEntrySizes` stays off. With it on, yauzl would stop a bomb at the forged declared size and never reach our caps. The codec counts the bytes it inflates. An entry that finishes under the cap, but whose count is not the declared size, is `declared-size-mismatch`. yauzl does not check the payload CRC, so the codec computes it while it reads.

Failed: Electron 45 does not OS-sandbox `utilityProcess.fork`. There is no sandbox option. On Windows, with the host not started with `--no-sandbox`, `getAppMetrics()` reported `sandboxed: false` and integrity level `high`. On Linux the command line contains `--service-sandbox-type=none` and Seccomp is 0.

**APPROVED 27 October 2026.** Keep ADR-013. Decode in the utility process for crash and memory isolation from main. Record that Electron 45 does not OS-sandbox that process. The defence is the checks and the caps. The main-process fallback is not taken. A hidden sandboxed renderer with a different ZIP library is not pursued. It would have no Node, so it could not run yauzl, and it would partly reverse ADR-013. No FR is cut. FR-09 stays.

### 4. Architectural style, FormatCodec

**Spike:** S-08

**Section:** 4 Architectural style, the opening paragraph and the FormatCodec row

**Current text:**

> One Electron main process owns all file, print, and export work.
>
> FormatCodec | Main | Encode and decode .obk files: archive caps, entry allowlist, schema, limits, image headers, and version conversion. Runs under Node.

**Proposed text:**

> Dialogs, disk writes, print, and export stay in main. Decoding an .obk file runs in a utility process (spike S-08).
>
> FormatCodec | Utility process | Encode and decode .obk files: archive caps, entry allowlist, schema, limits, image headers, and version conversion. Decoding runs in an Electron utilityProcess so a crash or a large inflate stays off main and off the editor. yazl encoding was checked in that same process. Electron 45 does not OS-sandbox it (spike S-08). APPROVED 27 October 2026: decoding stays in that process. The main-process fallback is not taken. FileService still does the disk rename.

### 6.4 Security baseline, the utility-process line

**Spike:** S-08

**Section:** 6.4 Security baseline

**Current text:**

> **UNVERIFIED:** Decoding .obk files in a sandboxed utilityProcess instead of main. Check in spike S-08.

**Proposed text:**

> Checked in spike S-08 (Electron 45.0.0, yauzl 3.4.0, yazl 3.3.1, Windows image 20261021.278.1, CI runs 40442767845 and 40443190314). Decoding runs in a utilityProcess, for crash and memory isolation from main. That process is not OS-sandboxed in Electron 45. `utilityProcess.fork` has no sandbox option. On Windows, `getAppMetrics()` reports `sandboxed: false` and integrity level `high`. On Linux the command line contains `--service-sandbox-type=none` and Seccomp is 0.
>
> The defence is the hostile-file checks and the real-byte caps. yauzl and yazl passed H-01 to H-09, those caps, a byte-identical 200-image save, and unchanged refused files, under Node 22.23.4 and inside that utility process. ADR-013 stays. APPROVED 27 October 2026: decoding stays in the utility process. The main-process fallback is not taken.

### 6.6 File checks and limits, how the caps and names are applied

**Spike:** S-08

**Section:** 6.6 File checks and limits, added sentences after the existing cap bullets. The cap numbers in the table stay.

**Current text:** The bullets already say that caps count bytes actually read, that a read stops when a cap is passed, and that names are an exact allowlist. They do not say that yauzl's declared-size check is left off, how a backslash is classified, or that a 200-image save was measured.

**Proposed text:**

> Spike S-08 applied those rules with yauzl 3.4.0 and yazl 3.3.1. yauzl is opened with `validateEntrySizes` off, so a forged small declared size cannot hide a bomb from the 25 MB, 20 MB, and 250 MB caps. An entry that finishes under the cap but does not match its declared size is refused. The codec computes the CRC while it reads.
>
> Names are the central-directory bytes, read as Latin-1, and classified by FormatCodec. That is what refuses `../`, a leading slash, a backslash, a drive letter, a network path, a stream suffix, a device name such as CON, and a case duplicate. yauzl is not asked to rewrite names first.
>
> yazl writes a legitimate archive with a fixed modified time. Two saves of a 200-image document were byte-identical inside one runtime (spike S-08). They are not required to match across Node and Electron.

### 6.10 Hostile sample set, H-01 to H-09

**Spike:** S-08

**Section:** 6.10 Hostile sample set, a note after the H-09 row. The expected cells already match the pass. H-10 to H-32 were out of scope for this spike.

**Current text:** The table lists H-01 to H-09 as refused, and the intro says no sample may change the file it opens. Nothing records that yauzl and yazl have been run against them.

**Proposed text:**

> H-01 to H-09 passed in spike S-08, under Node and in the Electron 45 utility process, on Windows image 20261021.278.1 and on Linux. Refused files were unchanged. The three bombs stopped at 25 MB, 20 MB, and 250 MB of real bytes. A 200-image yazl save was byte-identical when encoded twice in the same runtime.

### ADR-013

**Spike:** S-08

**Section:** ADR-013, Context, Decision, Consequences, and Revisit when

**Current text:**

> Context, last line: Decoding may move to a sandboxed utilityProcess (R-08, spike S-08).
>
> Decision, the yauzl lines: yauzl reads the central directory first, so names and declared sizes are known before anything is inflated. It errors when the real bytes pass the declared size, refuses ../ and absolute paths by default, and never writes to disk. yazl writes with a fixed modified time, so the same document gives the same bytes.
>
> Consequences: Our own checks are still needed for the name allowlist, case duplicates, encrypted entries, and headers that disagree (H-03, H-06, H-07).
>
> Revisit when: Either package is abandoned or has an unfixed security issue, spike S-08 fails, or format version 2 needs features they lack.

**Proposed text:**

> Context, last line: Decoding runs in a utilityProcess. Spike S-08 found that an Electron 45 utilityProcess is not OS-sandboxed. The hostile-file checks and the real-byte caps are the defence. APPROVED 27 October 2026: that process stays. The main-process fallback is not taken.
>
> Decision: FormatCodec reads .obk files with yauzl (3.4.0, MIT) and writes them with yazl (3.3.1, MIT). Types come from DefinitelyTyped. yauzl reads the central directory first. `validateEntrySizes` is off. FormatCodec counts inflated bytes and stops at the 25 MB, 20 MB, and 250 MB caps, so a bomb that claims a tiny size is still stopped at the cap. An entry that finishes under the cap but does not match its declared size is refused. Names are checked by FormatCodec, not by yauzl's rewrite: the allowlist, dot-dot, a leading slash, a backslash, drive letters, network paths, stream suffixes, device names, and case duplicates. yauzl never writes the file it is reading. yazl writes with a fixed modified time, so two saves of the same document in one runtime give the same bytes. Spike S-08 checked a 200-image document.
>
> Consequences: Our own checks are still needed, and S-08 is where they passed, including H-01 to H-09. yauzl's callback API is wrapped in a small promise helper inside FormatCodec. yazl's last release was November 2024. It is small and stable, but worth watching. The utility process is not an OS sandbox.
>
> Revisit when: Either package is abandoned or has an unfixed security issue, or format version 2 needs features they lack. The main-process fallback was considered and is not taken (APPROVED 27 October 2026).

Status stays Accepted 2026-10-26.

### 8. Risks, R-08

**Spike:** S-08

**Section:** 8 Risks, R-08 mitigation. The risk itself is a renderer bug. S-08 does not close that. It does close the "sandboxed utility process" claim that section 9.1 attached to R-08.

**Current text:**

> Sandbox and policy (section 6.4); main refuses what it did not issue; security releases within 30 days (QS-07)

**Proposed text:**

> The renderer stays sandboxed (section 6.4). Spike S-08 found that the utility process which decodes .obk files is not OS-sandboxed in Electron 45. A hostile archive is stopped by the section 6.6 checks, which passed for H-01 to H-09, not by a sandbox on that process. Main refuses what it did not issue. Security releases ship within 30 days (QS-07).

### 9.1 Spikes, the S-08 row

**Spike:** S-08

**Section:** 9.1 Spikes

**Current text:** The row asks to decode in a sandboxed utility process, and lists the H-01 to H-09 checks, the bad names, the identical save, and unchanged refused files.

**Proposed text:**

> Checked, partial on the OS sandbox, Electron 45.0.0, yauzl 3.4.0, yazl 3.3.1, Windows image 20261021.278.1. H-01 to H-09, the real-byte caps, the name rules, the byte-identical 200-image save, and unchanged refused files all passed. The utility process is not OS-sandboxed. ADR-013 stays. APPROVED 27 October 2026: the main-process fallback is not taken. | R-08, ADR-013, FR-09

## S-09. docx in Word

Pass. ADR-012 is kept. The Word exporter stays on docx 9.14.0.

**Not taken.** The fallback was to write the OOXML ourselves, behind the ADR-006 interface, if docx failed spike S-09. It did not fail. That fallback is not proposed. No FR is cut.

mathml2omml fidelity stays with spike S-03. The equations in this spike were Office Math written for the six samples, inserted with docx. They were editable with conversion on, and images with conversion off.

The raw `fromXmlString` return value, and the hostile file that still contained control characters, were refused by Word. That is the evidence for the two rules below. It is not a reason to drop docx.

The unpacked docx folder was 24 MB on the spike machine. ADR-012 says about 21 MB. The spike's own wording does not change that sentence, so this draft leaves it.

### ADR-012

**Spike:** S-09, and the wrapper sentence also from S-03

**Section:** ADR-012, Decision, Consequences, and Revisit when

**Current text:**

> Decision: The Word exporter builds the .docx with the docx package (MIT; 9.14.0 tested). It runs in main under Node. OMML from mathml2omml goes into a paragraph through ImportedXmlComponent.fromXmlString().
>
> Consequences, last line: Word fidelity is checked by hand in Word (spike S-09).
>
> Revisit when: docx fails spike S-09, stops being maintained, or cannot write a block the Export reference needs.

**Proposed text:**

> Decision: The Word exporter builds the .docx with the docx package (MIT; 9.14.0, checked in spike S-09). It runs in main under Node. OMML goes into a paragraph through `ImportedXmlComponent.fromXmlString()`. In docx 9.14.0 that call returns the document node. Inserting the node writes an element named `undefined`, and Word refuses the file. The `m:oMath` child is what goes in the paragraph. Display equations are wrapped in `m:oMathPara` after conversion (spike S-03 and spike S-09).
>
> Consequences, last line: Checked in spike S-09 (docx 9.14.0) in Microsoft 365, Version 2610, on Windows. Pass. The Export reference samples opened and matched the rows. The six formula samples were editable equations with conversion on, and images with conversion off. Image alt text showed in the Alt Text pane. A 50-page Letter file packed in under 10 seconds with no network call. The exporter sets Letter itself, because the library's default page is A4. It sets the document font and the table widths. It inserts the `m:oMath` child, not the `fromXmlString` return value. It drops XML 1.0-illegal control characters before the text is written. Unpaired surrogates do not survive as surrogates. Exported pictures are cropped to their content, with a small margin, and rendered at 2× or more. Checklist checkboxes have an option: a read-only Segoe UI Symbol mark, or a clickable Word checkbox content control. mathml2omml fidelity stays with spike S-03.
>
> Revisit when: docx stops being maintained, or it cannot write a block the Export reference needs.

Status stays Accepted 2026-10-26. The earlier consequences (package size, JSZip under MIT, mathml2omml still separate) stay.

### 6.9 Paste, export, and print, the Word rules

**Spike:** S-09

**Section:** 6.9, the Word-text sentence and the sentences around it

**Current text:**

> Word text goes through the library's text functions only. Word, PDF, and print use the first frame of an animated image: a PNG made in the renderer at export time, checked by main, never stored.

**Proposed text:**

> Word text goes through the library's text functions only, after XML 1.0-illegal control characters are stripped. docx escapes `<`, `&`, and `]]>`. Unpaired surrogates do not survive as surrogates (spike S-09). A file that still contains those control characters does not open in Word.
>
> The exporter sets Letter and the margins on the section. It sets the document font from the document, and each table to the text width (9360 twips on Letter with 1 inch margins). Pictures of equations, drawings, and diagrams are cropped to their content, with a small margin, and rendered at 2× or more.
>
> A checklist can export as a Segoe UI Symbol mark, read-only, or as a Word checkbox content control, clickable.
>
> Word, PDF, and print use the first frame of an animated image: a PNG made in the renderer at export time, checked by main, never stored.

### 6.10 Hostile sample set, H-26

**Spike:** S-09

**Section:** 6.10, the H-26 row

**Current text:**

> H-26 | Export of text, alt text, and link text with Markdown and XML markup | Escaped; file opens cleanly

**Proposed text:**

> H-26 | Export of text, alt text, and link text with `<`, `&`, `]]>`, XML 1.0-illegal control characters, and unpaired surrogates | Markup is escaped. Those control characters are stripped before the text is written. Unpaired surrogates do not survive as surrogates. The file opens cleanly (spike S-09).

### 9.1 Spikes, the S-09 row

**Spike:** S-09

**Section:** 9.1 Spikes

**Current text:** The row lists editable equations, images with conversion off, each Export reference row, alt text, hostile text, and a large export under 10 seconds with no network calls.

**Proposed text:**

> Checked, pass, docx 9.14.0. Word rounds were Microsoft 365 Version 2610. ADR-012 is kept. The exporter strips XML-illegal control characters, inserts the m:oMath child, sets Letter and the table widths, crops exported pictures, and offers a checkbox choice. The 50-page pack on the spike machine was under 10 seconds with no network call. CI run 40522475439 packed an earlier file, also under 10 seconds and with no network call. | ADR-012, FR-52, FR-56, FR-57, FR-63

## Libraries the spikes checked

Issue plan item D-06: the library picks and the Electron version are pinned when the app is set up, and this draft records each pick and license. Electron 45.0.0 is already the dependency in `package.json`. The other rows are the versions the spikes actually ran. They are not all app dependencies yet.

**Spike:** S-01 through S-09, as named in the cells

**Section:** 9 Technology stack, the version and license cells, and the note under the table

**Current text:**

> Desktop runtime | Electron | UNVERIFIED (45 or later) | ... | MIT
>
> Math | KaTeX | UNVERIFIED | ... | MIT
>
> Word math | mathml2omml | 0.5.0 (npm) | ... | LGPL-3.0-or-later
>
> Word file | docx | 9.14.0 (tested); pin at implementation | ... | MIT
>
> Diagram | (see the S-04 edit above)
>
> ZIP | yauzl (read) + yazl (write) | 3.4.0 + 3.3.1 | ... | MIT
>
> **UNVERIFIED:** Versions and licenses still marked UNVERIFIED. The Word math, Word file, and ZIP rows were checked on npm. Fix the rest after the spikes below, from each project's package page.

**Proposed text:**

> Desktop runtime | Electron | 45.0.0 | Chromium layout and printToPDF; one codebase. Spikes S-01 to S-09 ran on this version (Chrome 156.0.8078.48, Node 24.22.0 inside Electron). | MIT
>
> Math | KaTeX | 0.19.1 (checked in S-03 and S-04); pin when formulas are built | Fast, offline, MathML output | MIT
>
> Word math | mathml2omml | 0.5.0 (checked in S-03) | MathML to OMML | LGPL-3.0-or-later
>
> Word file | docx | 9.14.0 (checked in S-09) | Builds .docx under Node, including OMML and alt text (ADR-012) | MIT
>
> ZIP | yauzl (read) + yazl (write) | 3.4.0 + 3.3.1 (checked in S-08) | Reads and writes .obk with real-byte caps (ADR-013) | MIT
>
> JSZip is brought in by docx. S-03 saw 3.10.1 and S-09 saw 3.10.2. Both are used under MIT, chosen from the MIT or GPLv3 dual license. This draft does not pin a JSZip version of its own. hash.js 1.1.7 and nanoid 6.0.2, also under docx, are MIT (S-09).
>
> **UNVERIFIED:** React, TypeScript, the editor core, the test runner, and the MSIX tooling are still unmarked. Electron, KaTeX, Mermaid, mathml2omml, docx, yauzl, and yazl are the versions above. elkjs is not shipped (APPROVED 27 October 2026).

The section 1 note can change with this. Current text: "Technology versions marked UNVERIFIED stay so until the spikes in section 9 confirm them." Proposed text: "Technology versions still marked UNVERIFIED in section 9 stay so until a later check. Spikes S-01 to S-09 confirmed the rows named there."

## Left unchanged

These UNVERIFIED lines were not settled by S-01 to S-09. They stay.

- Fuses other than runAsNode and nodeCliInspect. The Mermaid half of that line is settled under S-04. The fuses half is not.
- How printToPDF sets up its window, how pasted HTML is parsed, and how custom clipboard formats behave.
- React, TypeScript, the ProseMirror-based editor, the test runner, and the MSIX tooling, in the stack table.
- What LGPL-3.0 requires for mathml2omml inside an MSIX. That flag is in the SRS, and S-03 did not close it.
- Alignment of formulas. S-03 says so, and the flag stays.
