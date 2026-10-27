# Spike S-09: docx output in Word

Throwaway check for issue 119. Nothing here is part of the app, and nothing here is imported from `src/`.

## Question

Do `.docx` files built with the docx library (ADR-012, 9.14.0 tested, MIT) open correctly in current Word for Windows? The files cover the Export reference rows (FR-63), the SRS formula samples as editable equations with conversion on and as images with conversion off (FR-56, FR-57, AC-11), image alt text (FR-52), hostile text (H-26), and a 50-page export in under 10 seconds with no network (NFR-04).

## Result

Pass. Microsoft 365, Version 2610, on Windows opened the ordinary files, edited the six equations, showed the alt text, and showed 50 pages. Round 2 confirmed the page break, the checkbox symbols, the Word checkbox, the full-width table, and the redrawn equation pictures. Word refused the raw wrapper and the hostile file, which is what those two samples are for. The Word exporter keeps ADR-012. The fallback, writing the OOXML ourselves behind the ADR-006 exporter interface, does not apply. The notes for the 1.3 update are in Decision.

mathml2omml is not in this spike. Spike S-03 is the check for that converter. The equations here are Office Math Markup I wrote for the six SRS samples, inserted with docx.

## Build

| Piece | Version | License |
|---|---|---|
| docx | 9.14.0 | MIT |
| jszip (docx depends on it; this spike also imports it to read the parts back) | 3.10.2 | MIT OR GPL-3.0-or-later. Used under MIT, which is the choice in the SRS license tables |
| hash.js (docx dependency) | 1.1.7 | MIT |
| nanoid (docx dependency) | 6.0.2 | MIT |
| @types/node | 24.19.2 | MIT |
| typescript | 6.0.3 | Apache-2.0 |
| Node | 22.23.4 | |
| LibreOffice, on this machine only | 24.2.7.2 | |

Pinned with `save-exact=true` in `spikes/s09/package.json` and this directory's lockfile. They are not in the app `package.json`, so the packager and the MSIX build do not ship them. `npm audit` on this tree reported 0 vulnerabilities.

`du -sh node_modules/docx` on this machine was 24M. ADR-012 says the package is about 21 MB unpacked because it ships several builds and only one is loaded.

## What was tested

Code under `spikes/s09/src/` builds one `.docx` per area with docx 9.14.0 and then reads the zip back. Each file has a short heading that says what Word should show. Page size is Letter (12240 by 15840 twips) and the margins are 1 inch, because a document that does not set them comes out as A4 (11906 by 16838). ADR-012 already says Letter is not the default.

| File | What it holds |
|---|---|
| `export-reference.docx` | One sample for each Export reference row: paragraph and Heading 1, 2, and 3; a bullet list and a numbered list; checkbox symbols ☐ and ☑ in Segoe UI Symbol, then one Word checkbox content control; a Quote style; Consolas; a rule; a table of values the full text width (the total is the value 5, not the formula `=B2+B3`); a photograph, a flattened drawing, and a first frame, each with alt text; one OMML fraction; a paragraph with `pageBreakBefore` so the next sentence starts the next page; a header with PAGE and NUMPAGES fields and a footer; the date `March 4, 2027` as text; a three-column table with `nil` borders; a drawing, a signature, and a diagram as images; an https link and a mailto link. |
| `equations-on.docx` | The six SRS formula samples as OMML inside paragraphs. |
| `equations-off.docx` | The same six samples as PNG images. |
| `equations-raw-wrapper.docx` | The fraction inserted as the return value of `ImportedXmlComponent.fromXmlString`, which writes an element named `undefined` around the math. |
| `alt-text.docx` | One red square. The `wp:docPr` description is `Red square, the alt text sample for FR-52.` |
| `hostile-text.docx` | Body text, alt text, and link text, each with `<`, `&`, `]]>`, the control characters U+0000, U+0001, U+0008, U+000B, U+000C, U+000E, U+001F, and U+007F, and the unpaired surrogates U+D800 and U+DC00 separated so they do not form a pair. The link target is `https://example.invalid/obelisk-s09`. |
| `fifty-pages.docx` | Fifty pages. Each page is a heading `Page n of 50` and a paragraph, with a page break between pages. |

The formula pictures, and the photograph, drawing, signature, and diagram, are hand-drawn stand-ins in this spike. Each one is drawn at two pixels for every pixel Word displays. They are not the pictures the app would export. In the app the formula pictures come from KaTeX, the diagram pictures from Mermaid, and the drawing and signature pictures from the canvas. Exported pictures (equations, drawings, and diagrams) are cropped to their content with a small margin, and the app renders them at 2× or more. The heading above each formula picture names the SRS sample. The round-2 pictures were sharper and no longer mirrored, and they still had too much empty space around them, which is why the crop is part of the export rule.

The first files set no document default font, so Word supplied its own. These files name Calibri, 11 pt, as the document default. The values table in the first files was 6240 twips wide. A Letter page with 1-inch margins has a text width of 9360 twips, and both tables are that wide now.

## Where it ran

Command: `npm start` in `spikes/s09` (typecheck, compile, build the files, check the parts, and, when `soffice` is on PATH, ask LibreOffice to load each file). Workflow: `.github/workflows/spike-s09.yml`, on `windows-latest` and `ubuntu-latest`, Node 22.23.4. The Ubuntu job installs LibreOffice Writer before the run. The workflow does not run the app's typecheck, lint, or test jobs. Those stay on the main CI workflow. This spike's own typecheck and lint run in the spike job. Lint uses the repo eslint config, so the job installs the app first.

### This machine

Kernel `6.12.94+`, `#1 SMP PREEMPT_DYNAMIC Mon Oct 26 18:36:23 UTC 2026`. Node 22.23.4. LibreOffice 24.2.7.2. Python 3.12.3 for the second XML parse.

### Windows

Run [40522475439](https://github.com/fillicianoplong/obelisk/actions/runs/40522475439), job "docx samples (windows-latest)".

| Field | Value |
|---|---|
| Image | `20261021.278.1` (`win25-vs2026`) |
| OS | Windows Server 2025 Datacenter, `10.0.26100` |
| 50-page pack | 82.9 ms, 0 network calls |
| Parts | the same seven files; only `hostile-text.docx` is not well-formed |
| LibreOffice | not on this image, so those loads did not run |

### Ubuntu

The same run, job "docx samples (ubuntu-latest)". Image `20261012.334.1` (`ubuntu24`), Ubuntu 24.04.5 LTS. The job installed LibreOffice Writer before the run.

The 50-page pack took 66.6 ms and recorded 0 network calls. No socket was open before or after. `unshare -r -n` did not run: `unshare: write failed /proc/self/uid_map: Operation not permitted`. The in-process block still ran. LibreOffice loaded every file except `hostile-text.docx`. The part results matched this machine.

Those two jobs ran the files from before the page-break, checkbox, font, table-width, and picture fixes. The same checks run again on the fixed files.

## How the checks are done

Every `.xml` and `.rels` part is parsed twice. One parser is in `xml-check.ts` and follows the XML 1.0 character rules, including the ban on `]]>` in character data. The other is Python's `xml.etree.ElementTree`. docx's own parser is not the check: it accepted the part that contains a NUL.

Alt text is the `descr` attribute on `wp:docPr`. Letter is `w:w="12240"` and `w:h="15840"` with 1440-twip margins. The 50-page file is timed around `Document` plus `Packer.toBuffer`. Page breaks in that file are counted, and LibreOffice's PDF of it had 50 page objects.

Network calls are rejected for the whole process before docx is loaded. The rejected entry points are `net.Socket.connect`, `net.connect`, `net.createConnection`, `dns.lookup`, `dns.promises.lookup`, `http.request`, `http.get`, `https.request`, `https.get`, `tls.connect`, and `fetch`. The timed export's call log is that list. On Linux the same pack also runs in a new network namespace (`unshare -r -n`). Windows has no `unshare`; the in-process block still runs there.

LibreOffice is `soffice --headless --norestore --nolockcheck --convert-to pdf`, with its own profile and a 45 second limit. A file counts as loaded when the conversion exits 0 and the PDF is non-empty. If the conversion refuses the file or runs out of time, that is written in `spike-report.json` and the spike still exits 0. A LibreOffice miss does not fail the job. LibreOffice is not Word.

On run 40532867624 the Ubuntu job sat in "Install LibreOffice" for more than 20 minutes. The samples had not started. That step now stops after 5 minutes, the run step stops after 8, and the job stops after 20. A new run cancels one that is still going.

## Results

On this machine the seven files were written. Six of them are well-formed in every part, in both parsers. `hostile-text.docx` is not. The 50-page export took 39.1 ms, and 43.0 ms inside the network namespace. Both are under 10 seconds. Neither run recorded a network call.

### Parts

| File | Parts | Not well-formed | LibreOffice 24.2.7.2 |
|---|---|---|---|
| `export-reference.docx` | 21 | 0 | loaded, PDF written |
| `equations-on.docx` | 21 | 0 | loaded, PDF written |
| `equations-off.docx` | 21 | 0 | loaded, PDF written |
| `equations-raw-wrapper.docx` | 21 | 0 | loaded, PDF written |
| `alt-text.docx` | 21 | 0 | loaded, PDF written |
| `hostile-text.docx` | 21 | 1 (`word/document.xml`) | not loaded: "source file could not be loaded" |
| `fifty-pages.docx` | 21 | 0 | loaded, PDF written, 50 pages |

Python's parser agreed with mine on every part, including the NUL in the hostile document.

`export-reference.docx` contains Heading1, Heading2, Heading3, the Quote style, Consolas on the code run, `w:pageBreakBefore` on the paragraph that should start the next page, one `m:oMath` fraction, drawings, `nil` table borders, both tables at 9360 twips, the text `March 4, 2027`, the checkbox symbols in Segoe UI Symbol, a `w14:checkbox` content control, and relationship targets `https://example.invalid/obelisk` and `mailto:s09@example.invalid`. The document default font in the styles part is Calibri. The header field instructions are `PAGE` and `NUMPAGES`.

### Equations

`ImportedXmlComponent.fromXmlString` does not return the `m:oMath` element. The node's own name is missing, and placing that return value in a paragraph writes `<undefined>` around the math. I checked the fraction both ways. `equations-raw-wrapper.docx` contains `<undefined><m:oMath…`. `equations-on.docx` uses the `m:oMath` child instead: six `m:oMath` elements, no `<undefined>`, no drawing. The parts include `m:f`, `m:rad`, `m:nary`, `m:m`, and `m:acc`, and the last equation contains U+03B8, U+03B1, U+03B2, and the combining circumflex U+0302.

docx 9.14.0 also exports `Math`, `MathFraction`, `MathRadical`, `MathSum`, `MathIntegral`, and bracket helpers. That set has no matrix and no accent, so it cannot carry the whole SRS formula reference. ADR-012 already sends OMML through `fromXmlString`. The exporter has to insert the `m:oMath` child, not the return value itself, or the paragraph contains an element named `undefined`.

`equations-off.docx` has six drawings and no `m:oMath`.

LibreOffice opened both equation files, including the raw wrapper. In Word, round 1, the six equations in `equations-on.docx` were editable. Word refused `equations-raw-wrapper.docx`.

### Alt text

`alt-text.docx` has `descr="Red square, the alt text sample for FR-52."` on `wp:docPr`. The export-reference images have their own descriptions: Photograph sample, Flattened drawing, First frame of an animation, Drawing sample, Signature sample, and Diagram sample. In Word, round 1, the alt text on the drawings showed, and `alt-text.docx` was fine.

### Hostile text

`<`, `&`, and `>` are escaped. The sample `]]>` is stored as `]]&gt;`, so the part does not contain a raw `]]>`. That much is fine.

The eight control characters are written through as themselves, in text and in the `descr` attribute. Both parsers reject `word/document.xml` at the NUL. LibreOffice would not load the file.

The unpaired surrogates do not survive as surrogates. In the UTF-8 part they are U+FFFD. The link targets stay `https://example.invalid/obelisk-s09`. The markup did not move into a relationship target.

So docx escapes the markup characters and drops unpaired surrogates by replacing them, and it does not drop or escape the control characters. A file that contains those controls does not stay well-formed. LibreOffice refused it, and Word refused it in round 1. The exporter has to strip those control characters before the text is written.

### Fifty pages and the network

The pack of `fifty-pages.docx` took 39.1 ms and wrote 12,163 bytes. The document has 49 page breaks and the headings `Page 1 of 50` through `Page 50 of 50`. LibreOffice's PDF of that file has 50 pages.

During that pack the call log stayed empty. The process already had two sockets open before the pack, and the same two were open after it. The pack did not open another. The same build inside `unshare -r -n` took 43.0 ms, wrote the same 12,163 bytes, and also recorded 0 calls.

That is the export time on this machine, with the network blocked. The earlier Windows job packed the previous file in 82.9 ms and the Ubuntu job in 66.6 ms, each with 0 network calls. All of these are under the 10 second target. None of them is a measurement of Word opening the file. In Word, round 1, the file showed 50 pages and the header showed the page number. The Ubuntu job could not create a network namespace, so the namespace timing is only from this machine.

## Checks that need Word

Round 1 is the first set of files, opened in Microsoft 365, Version 2610, on Windows. Those files put the page break after the sentence, drew U+2610 in the default font, used the first picture drawings, set no document font, and made the values table 6240 twips wide. Round 2 is this set of files. LibreOffice above is not a substitute for either round.

Word version: Microsoft 365

Word build: Version 2610

| Check | File | What Word should show | Round 1 | Round 2 |
|---|---|---|---|---|
| Export reference rows (FR-63) | `export-reference.docx` | The file opens with no repair dialog. Each heading's "Word should show" line matches the page: heading styles, lists, checkbox symbols in Segoe UI Symbol, a Word checkbox content control, Quote, Consolas, a rule, a full-width table of values, images, one editable fraction, the page-break sentence at the top of the next page, the header and footer, the date as text, a borderless three-column table, and drawing, signature, and diagram images. | Opened cleanly. The table, the header and footer, and the alt text on the drawings were fine. The page-break sentence sat at the bottom of the page, because the break came after it. The empty checkbox (U+2610 in the default font) drew as a glyph that looks like an Arabic letter. The checked checkbox (U+2611) was fine. | The page-break sentence starts the next page. Both Segoe UI Symbol checkboxes look right. The Word checkbox content control works when clicked. The full-width table looks good. |
| Equations, conversion on (FR-57, AC-11) | `equations-on.docx` | Each of the six samples is an editable equation, and editing one changes that equation. | All six were editable, and they looked great. | The sum and the other equations are fine. |
| Equations, conversion off (FR-56, AC-11) | `equations-off.docx` | Each of the six samples is a picture, not an equation. The pictures are hand-drawn stand-ins. | Opened. Each sample was a picture, and the pictures looked poor. | The sigma and the integral are no longer mirrored, and the pictures are sharper. There is too much empty space around them. |
| Raw `fromXmlString` return value | `equations-raw-wrapper.docx` | Whether Word opens it, offers to repair it, or refuses it, and whether the fraction is still editable if it opens. | Word refused the file. That is what I expected. It confirms the paragraph has to take the `m:oMath` child. | No further check. |
| Alt text (FR-52) | `alt-text.docx` | The red square's Alt Text pane shows `Red square, the alt text sample for FR-52.` | OK. | No further check. |
| Hostile text (H-26) | `hostile-text.docx` | The file opens cleanly. Body text, alt text, and link text show `<`, `&`, and `]]>` as text, not markup. The link still points at `https://example.invalid/obelisk-s09`. Note what happens to the control characters and the replacement characters. | Word refused the file. That is what I expected. It confirms the exporter has to strip the XML-illegal control characters before the text is written. | No further check. |
| Fifty pages (NFR-04) | `fifty-pages.docx` | Word shows 50 pages. The header shows the page number. The time and the network are already recorded above; this row is only the page count in Word. | OK. Word showed 50 pages, and the header showed the page number. | No further check. |

Round 2 was the same Word, Microsoft 365 Version 2610, on the fixed files.

## Decision

Pass. Keep ADR-012. Do not write the OOXML ourselves.

Carry these into the SRS and Architecture 1.3 update:

1. Strip XML-illegal control characters before export. Word and LibreOffice both refused the file that still contained them.
2. Insert the `m:oMath` child of `ImportedXmlComponent.fromXmlString`, not the return value. Word refused the raw wrapper. The six equations built from the child were editable, including the sum.
3. Set the Letter page size on the section. The library's default page is A4.
4. Set the document default font and the table widths explicitly. The first files set no font, and the values table was 6240 twips instead of the 9360 twips of the text area.
5. Crop exported pictures (equations, drawings, and diagrams) to their content with a small margin. The app renders them at 2× or more. The pictures in this spike are hand-drawn stand-ins. In round 2 the sigma and the integral were no longer mirrored and the pictures were sharper, and they still had too much empty space around them.
6. Word export gets an option for checklist checkboxes. Read-only writes a Segoe UI Symbol mark. Clickable writes a Word checkbox content control. Round 2 showed both: the symbols looked right, and the content control worked when clicked.

mathml2omml fidelity on the formula samples stays with spike S-03.

## Pass or fail

The spike passes. Every Word row that should open does open, and the checks without Word still pass. The Word exporter keeps ADR-012.

The raw wrapper and the hostile file were refused. That is the evidence for the first two notes in Decision, not a reason to abandon docx. The empty space around the equation pictures is the crop rule, not a failed row.

## Proposed doc wording

Not applied. `docs/ARCHITECTURE.md` and `docs/SRS.md` are unchanged. This is the wording for the 1.3 update.

Replace the ADR-012 consequence "Word fidelity is checked by hand in Word (spike S-09)." with:

> Checked in spike S-09 (docx 9.14.0) in Microsoft 365, Version 2610, on Windows. Pass. The Export reference samples opened and matched the rows. The six SRS formula samples were editable equations with conversion on and images with conversion off. Image alt text showed in the Alt Text pane. A 50-page Letter file packed in under 10 seconds with no network call. The exporter sets Letter itself, sets the document default font and the table widths, inserts the `m:oMath` child of `ImportedXmlComponent.fromXmlString` rather than the return value, and drops XML 1.0-illegal control characters before the text is written. Unpaired surrogates do not survive as surrogates. Exported pictures are cropped to their content with a small margin and rendered at 2× or more. Checklist checkboxes have an option: a read-only Segoe UI Symbol mark, or a clickable Word checkbox content control. mathml2omml fidelity stays with spike S-03.

## Steps

From `spikes/s09`, after `npm ci` in this directory:

```
npm run typecheck
npm start
```

Lint uses the repo config. From the repo root, `npm ci`, then in `spikes/s09` run `npm run lint`.

The files and `spike-report.json` are written to `spikes/s09/output/`. `output/SAMPLES.md` lists which sample is in which file. When `soffice` is on PATH the PDFs are written under `output/libreoffice/`.
