# Spike S-03: mathml2omml in Word

Throwaway check for issue 10. Nothing here is part of the app, and nothing here is imported from `src/`.

## Question

Does mathml2omml output of the SRS equation samples open as editable equations in Word for Windows?

## Result

**Pass with a condition.** I opened the files in Word for Windows (Microsoft 365, Version 2610). Every sample file and `all-samples.docx` opened with no repair dialog, and every display equation and every inline equation was editable.

The condition is a small cleanup in the exporter, covered by tests, before I rely on the raw mathml2omml tree. The sum leaves an empty placeholder after the Σ, because the n-ary `m:e` is empty and `i^2` is a sibling. The matrix parentheses are plain math text, so they do not stretch around the grid, and display equations are not wrapped in `m:oMathPara`. I am keeping mathml2omml 0.5.0 for FR-57. The image fallback (FR-56) stays the fallback only.

The automated checks passed on the build below: each sample becomes well-formed OMML in the Office Math namespace, and docx 9.14.0 writes that OMML as a direct child of a paragraph. LibreOffice 24.2.7.2 loads those files and turns each equation into a formula object. Word is what decided the pass. The Decision section has the cleanup, and the follow-up points at the export issue.

## Versions

| Piece | Version | License |
|---|---|---|
| docx | 9.14.0 | MIT |
| mathml2omml | 0.5.0 | LGPL-3.0-or-later |
| katex | 0.19.1 | MIT |
| jszip (docx depends on it; the package check reads the ZIP with it) | 3.10.1 | (MIT OR GPL-3.0-or-later). I use it under MIT, as ADR-012 does. |
| @xmldom/xmldom (well-formed XML check) | 0.8.15 | MIT |
| typescript | 6.0.3 | Apache-2.0 |
| eslint | 10.13.0 | MIT |
| typescript-eslint | 8.72.0 | MIT |
| @eslint/js | 10.0.1 | MIT |
| globals | 17.13.0 | MIT |
| @types/node | 24.19.2 | MIT |
| Node | 22.23.4 | |

Pinned with `save-exact=true` in `spikes/s03/package.json` and this directory's lockfile. They are not in the app `package.json`, so the packager and the MSIX build do not ship them. mathml2omml stays out of the app package. NFR-29 still wants it as its own module when FR-57 is built.

mathml2omml's own note: the XML parser it vendors is based on html-parse-stringify, which is MIT. The package license is still LGPL-3.0-or-later.

`npm audit` in `spikes/s03` reported 0 vulnerabilities.

## Where it ran

Command: `npm start` in `spikes/s03` (compile, convert the six samples, write the `.docx` files, check the packages). `npm run typecheck` and `npm run lint` are separate and the workflow runs them first. Workflow: `.github/workflows/spike-s03.yml`, on `windows-latest` and `ubuntu-latest`, Node 22.23.4. This spike does not launch Electron, so the job does not install the app. The Ubuntu job installs LibreOffice Writer and LibreOffice Math and the load check runs. A download that stalls is retried after 30 seconds. That install step stops after 12 minutes. The spike step stops after 5 minutes, and `soffice` itself is stopped after 2 minutes if the conversion does not finish. The whole job stops after 20 minutes. A newer run on the same branch cancels one that is still going. The Windows job does not install LibreOffice. If `soffice` is not on `PATH`, the load check is recorded as skipped and the job still passes the package checks.

### This machine

Linux, kernel `6.12.94+`, `#1 SMP PREEMPT_DYNAMIC Mon Oct 26 18:36:23 UTC 2026`. Node 22.23.4. LibreOffice 24.2.7.2 420(Build:2), with Writer and Math installed. Outcome of the automated checks: pass. I opened the generated files in Word on a separate Windows machine. That session is in the Word section.

### CI

The files I opened in Word came from workflow `.github/workflows/spike-s03.yml`, run [40527700478](https://github.com/fillicianoplong/obelisk/actions/runs/40527700478), commit `42279f4dcf5816b6c1e3e04a94552742641b8d06`. Both jobs passed. Node v22.23.4 on each. The package checks matched this machine. The spike lint config is `eslint.spike.config.mjs`, so the repo lint sees one config root. The conversion and the package check do not use that file.

| Job | Job id | Image | Image version | LibreOffice |
|---|---|---|---|---|
| OMML docx (ubuntu-latest) | 122271649049 | `ubuntu-24.04` | `20261012.334.1` | 24.2.7.2 420(Build:2), wrote Flat ODF for all eight files |
| OMML docx (windows-latest) | 122271648575 | `windows-2025-vs2026` | `20261021.278.1` | not installed, load check skipped |

Windows is Windows Server 2025. The Ubuntu load is the same LibreOffice build as this machine, and it wrote the same kind of Flat ODF. The Windows job is the package check without LibreOffice. Neither job opened Word. The Word session below is Microsoft 365 on a Windows desktop, not this runner.

## What was tested

The six samples in the SRS formula reference, and no others. The reference does not include an alignment sample (`align`, `aligned`, or a similar environment), so this spike does not check alignment.

| Sample | LaTeX | File |
|---|---|---|
| Fraction | `\frac{a+b}{c}` | `fraction.docx` |
| Root and power | `\sqrt{x^2+y^2}` | `root-and-power.docx` |
| Sum | `\sum_{i=1}^{n} i^2` | `sum.docx` |
| Integral | `\int_0^1 x\,dx` | `integral.docx` |
| Matrix | `\begin{pmatrix}1&0\\0&1\end{pmatrix}` | `matrix.docx` |
| Greek and accents | `\hat{\theta} = \alpha + \beta` | `greek-and-accents.docx` |

`all-samples.docx` has all six, in that order. `naive-fromxmlstring.docx` is not a sample. It is the fraction written the way `ImportedXmlComponent.fromXmlString()` returns it, so the wrapper described below is in the file.

Each sample file has three paragraphs: the sample name and the LaTeX as ordinary text, the display equation centered on its own paragraph, and the same formula inline after the word `Inline`. The page is Letter (8.5 by 11 inches) with 1 inch margins and the header and footer 0.5 inch from the edge, which is the page setup reference.

KaTeX 0.19.1 makes the MathML, with the settings in architecture section 6.4: `trust: false`, `throwOnError: true`, `maxSize: 50`, `maxExpand: 1000`, a new empty `macros` object each time, and a `strict` handler that returns `'error'` for `htmlExtension` and `'ignore'` otherwise. `output` is `'mathml'`. Display formulas use `displayMode: true`. Inline formulas use `displayMode: false`. The `<math>` element is what goes to mathml2omml, including the `<semantics>` and `<annotation encoding="application/x-tex">` that KaTeX adds.

mathml2omml 0.5.0 is called as `mml2omml(mathml)`, the default. I do not pass `disableDecode` for these samples. A separate probe, not an SRS sample, is below.

docx 9.14.0 builds the file in Node, as ADR-012 says. The OMML string is parsed with `ImportedXmlComponent.fromXmlString()`. In 9.14.0 that call returns the document node, whose element name is undefined, and the `m:oMath` element is its child. Writing the return value itself emits an element named `undefined` around the equation. The sample files put the `m:oMath` child in the paragraph instead, so the equation is a direct child of `w:p`, which is where WordprocessingML allows an equation. The naive file writes the return value unchanged.

## How the checks are done

These checks run in `npm start`. They do not open Word.

1. Each OMML string parses as a single well-formed element. The root is `m:oMath` in `http://schemas.openxmlformats.org/officeDocument/2006/math`. The structure check then looks for the fraction, radical, n-ary, matrix, or accent that the sample should have produced, and it fails if the LaTeX source was copied into an equation text run.
2. The `.docx` is a ZIP. The central directory is read, names are unique, none escape the package, and each local header name matches. JSZip 3.10.1 then loads the archive with CRC checks. The names it reports match the central directory, including the directory entries.
3. `[Content_Types].xml`, the relationship parts, and `word/document.xml` parse. Every XML part parses. Every part has a content type. Relationship targets inside the package exist. There is no external relationship. `word/document.xml` is the office document. The page is Letter and the four margins are 1 inch.
4. Each sample file has two `m:oMath` elements (display and inline), `all-samples.docx` has twelve, and each one is a direct child of a `w:p`. None of those files contain an element named `undefined`. The naive file contains one, and its equation is inside that element.
5. If `soffice` is on `PATH`, it converts each file to Flat ODF with a fresh user profile (`--headless --norestore`). A missing output fails the run. The StarMath annotation LibreOffice writes is recorded. It is a load check, not a Word edit check. On this machine that program is LibreOffice 24.2.7.2.

Word for Windows is not one of these checks. Editable means the owner can open the file without a repair dialog and change the equation in Word's equation editor. A formula object in LibreOffice does not answer that.

## Results

Automated outcome: **pass** on this machine and on both CI runners. Word: **pass with a condition**, recorded below.

mathml2omml warned once per conversion, `Type not supported: annotation`. The TeX annotation is not in the OMML. The presentation math is.

Display and inline OMML are the same string for every sample except the sum. KaTeX emits `munderover` for a display sum and `msubsup` for an inline sum. mathml2omml turns those into `m:limLoc` `undOvr` and `subSup`. LibreOffice's StarMath text was the same for both, so that difference is for Word to show.

### What each sample became

| Sample | OMML | LibreOffice StarMath, display and inline |
|---|---|---|
| Fraction | `m:f`, numerator `a+b`, denominator `c` | `{a+b} over {c}` |
| Root and power | `m:rad` with the degree hidden, then `x`, `2`, `+`, `y`, `2` | `sqrt {{x} ^ {2} + {y} ^ {2}}` |
| Sum | `m:nary` character `∑`, lower limit `i=1`, upper limit `n`, and an empty `m:e`. `i^2` is the next `m:sSup`, not inside the n-ary. | `sum from {i=1} to {n} <?> {i} ^ {2}` |
| Integral | `m:nary` character `∫`, limits `0` and `1`, element `x`. Then an empty `m:t` (`m:nor` on the run) and a run `dx`. The thin space U+2009 from `\,` is not in the OMML. | `int from {0} to {1} {x} "" dx` |
| Matrix | `m:m` with rows `1 0` and `0 1`. The parentheses are ordinary math runs around the matrix, not an `m:d` delimiter. | `\( matrix {1 # 0 ## 0 # 1} \)` |
| Greek and accents | `m:acc` with character U+0302 (combining circumflex) over `θ`, then one run `=α+β` | `widehat {θ} =α+β` |

The sum's `<?>` is LibreOffice's placeholder for the empty n-ary element. Word draws the same hole as an empty placeholder box, with `i^2` beside the Σ. The integral's `""` is the empty run where the thin space was. In Word the integral still looked right.

### The fromXmlString wrapper

`ImportedXmlComponent.fromXmlString()` in docx 9.14.0 returns a node whose name is undefined. Serialized, that is an element named `undefined` with the `m:oMath` inside it. `naive-fromxmlstring.docx` is that shape for the fraction. The sample files are not: each `m:oMath` is a direct child of `w:p`, the namespace is `http://schemas.openxmlformats.org/officeDocument/2006/math`, and the prefix is `m`.

LibreOffice still loaded the naive file and wrote `{a+b} over {c}`. Word did not. It refused `naive-fromxmlstring.docx` with "Word experienced an error trying to open the file." The sample files, which insert the `m:oMath` child, opened. The exporter has to use that child. The return value of `fromXmlString()` does not go in the paragraph.

### A less-than sign, not an SRS sample

`mml2omml` of `<mo>&lt;</mo>` with the default options writes `a<0` inside `m:t`, which is not well-formed XML. The same call with `{ disableDecode: true }` writes `a&lt;0` and parses. None of the six samples contain `<`, `>`, or `&`, and for those six the default string and the `disableDecode` string are identical, and both parse. An exporter that meets a formula with `<` cannot use the default call.

### Package check

All eight files passed the ZIP and OOXML checks. Each sample file has 2 equations, both direct children of paragraphs. `all-samples.docx` has 12. The naive file has 1 equation and 1 element named `undefined`. Every file is Letter, 12240 by 15840 twips, with margins 1440 twips.

### LibreOffice

LibreOffice 24.2.7.2 wrote a non-empty Flat ODF file for all eight documents. Every StarMath string in the table above is in that output, display and inline. The captions are there as paragraphs. This says the packages load in that LibreOffice build. The Word section is the edit check.

## Word for Windows

Opened on Windows in Microsoft 365, Version 2610, on 27 October 2026. Editable means I could click the equation and change it in Word's equation editor. The naive file is not part of the pass.

| File | What I open | Opens with no repair dialog | Display equation is editable | Inline equation is editable | What I see |
|---|---|---|---|---|---|
| `fraction.docx` | Fraction, `\frac{a+b}{c}` | Yes | Yes | Yes | Opens cleanly. Both equations look right. |
| `root-and-power.docx` | Root and power, `\sqrt{x^2+y^2}` | Yes | Yes | Yes | Opens cleanly. Both equations look right. |
| `sum.docx` | Sum, `\sum_{i=1}^{n} i^2` | Yes | Yes | Yes | Opens and both equations are editable. Word shows an empty placeholder box after the Σ, with i² beside it, in the display equation and in the inline equation. Limits are above and below in display, and beside the sum when it is inline. |
| `integral.docx` | Integral, `\int_0^1 x\,dx` | Yes | Yes | Yes | Opens cleanly. Both equations are editable and look right. |
| `matrix.docx` | Matrix, `\begin{pmatrix}1&0\\0&1\end{pmatrix}` | Yes | Yes | Yes | Opens and both equations are editable. The parentheses are plain math text, so they do not stretch around the grid. The display equation sits at the right edge and its closing parenthesis is cut off. |
| `greek-and-accents.docx` | Greek and accents, `\hat{\theta} = \alpha + \beta` | Yes | Yes | Yes | Opens cleanly. Both equations are editable and look right. |
| `all-samples.docx` | All six, same order | Yes | Yes | Yes | Opens cleanly. Everything looks right except the sum, which has the same empty box. The matrix looks fine here, including its closing parenthesis. |
| `naive-fromxmlstring.docx` | Not part of the pass. Fraction wrapped in `<undefined>`. | No | Could not open | Could not open | Word refuses the file: "Word experienced an error trying to open the file." |

The empty box on the sum is the converter leaving `m:e` empty and putting the summand in the next sibling. Display limits above and below, and inline limits beside the operator, match `m:limLoc` `undOvr` and `subSup`.

The matrix parentheses are `m:r` text, not an `m:d` delimiter, so they do not grow with the grid. Display equations in these files are not wrapped in `m:oMathPara`. In `matrix.docx` that display equation sits at the right edge and the closing parenthesis is cut off. The same matrix in `all-samples.docx` looks fine.

The integral looked right even though the thin space from `\,` is missing from the OMML. The hat on theta looked right with the combining circumflex (U+0302). I am leaving both of those as they are.

## Pass/fail

**Pass with a condition.**

Every sample file and `all-samples.docx` opened in Word for Windows with no repair dialog, and every display equation and every inline equation in them was editable. That is the pass. The architecture keeps mathml2omml 0.5.0 for FR-57.

The condition is the cleanup in the Decision section. I am not shipping the sum's empty box or the unstretched matrix fences as the finished export. Those are fixed in the exporter, with tests, as part of building FR-57.

The naive file does not decide the pass. Word refused it, which is what I expected, and it confirms the sample files are right to insert the `m:oMath` child. The LibreOffice load does not decide the pass.

A fail would have been a file that does not open, a repair that drops or replaces an equation, or an equation I cannot edit. None of the sample files did that, so I am not cutting FR-57.

## Decision

S-03 passes. I keep mathml2omml 0.5.0 for FR-57, editable Word equations, with a small post-conversion cleanup in the exporter. Tests cover that cleanup. The image fallback (FR-56) stays the fallback for a formula whose conversion fails.

The cleanup does three things to the OMML after `mml2omml` returns:

1. If an n-ary's `m:e` is empty and the summand is the following sibling, move that sibling into `m:e`. That removes the empty placeholder after Σ and puts `i^2` inside the sum.
2. Turn stretchy fence characters around `m:m`, and stretchy `mo` fences in general, into an `m:d` delimiter with `begChr` and `endChr`, so the parentheses grow with the grid instead of sitting as plain `m:r` text.
3. Wrap each display equation in `m:oMathPara`. The files I opened put `m:oMath` directly in the paragraph. In `matrix.docx` the display matrix sat at the right edge and the closing parenthesis was cut off. `all-samples.docx` showed that same matrix without the cutoff.

Two other converter quirks stay as notes, not as extra cleanup. The dropped thin space in the integral, and the combining circumflex on theta, both looked right in Word. A formula whose MathML contains `<` still needs `mml2omml(..., { disableDecode: true })`. The default call writes a raw `<` inside `m:t` and the XML is not well-formed. None of the six samples contain `<`, `>`, or `&`. The exporter uses `disableDecode` when the MathML needs it.

`naive-fromxmlstring.docx` is the fraction as the raw `ImportedXmlComponent.fromXmlString()` return value, an element named `undefined` around `m:oMath`. Word will not open that file. The exporter inserts the `m:oMath` child.

This spike does not apply that cleanup, and it does not regenerate the sum or the matrix. The `.docx` files are the ones I opened.

## Follow-up

The cleanup belongs in the Word export, issue #75 (FR-57), in `src/main/export/word/omml/`. That work keeps mathml2omml 0.5.0 as its own module (NFR-29) and adds tests for the three fixes: the n-ary sibling moves into an empty `m:e`, fences around a matrix become `m:d` with `begChr` and `endChr`, and a display equation is wrapped in `m:oMathPara`. The same tests should reject an element named `undefined` and should call `mml2omml` with `disableDecode` when the MathML contains `<`. If conversion still fails, that equation uses the image fallback (FR-56). Alignment is still unchecked. The formula reference has no alignment sample, so #75 does not treat this spike as a check of `align`.

## Fallback

Not taken. If Word had failed the samples, I would have shipped the image fallback only (FR-56) and cut FR-57. The samples opened and edited, so formulas in Word stay editable OMML, and the PNG fallback remains the fallback only.

## Proposed documentation edit

Not applied. `docs/SRS.md` and `docs/ARCHITECTURE.md` are unchanged.

Replace the UNVERIFIED line after FR-57 with:

> **Checked in spike S-03 (mathml2omml 0.5.0, KaTeX 0.19.1, docx 9.14.0, Microsoft 365 Version 2610 on Windows):** the six Formula reference samples open in Word for Windows as editable equations, display and inline. FR-57 keeps mathml2omml 0.5.0. The exporter still cleans the OMML before it is written. The sum's n-ary element is empty and Word shows an empty placeholder with the summand beside it; the following sibling moves into `m:e`. Matrix parentheses are plain math runs and do not stretch; stretchy fences around `m:m` (and `mo` fences in general) become `m:d` with `begChr` and `endChr`. Display equations in the spike files were not wrapped in `m:oMathPara`, and in `matrix.docx` the display matrix sat at the right edge with the closing parenthesis cut off; display equations are wrapped in `m:oMathPara`. The dropped thin space and the combining circumflex still looked right. A formula whose MathML contains `<` needs `mml2omml(..., { disableDecode: true })`. The formula reference has no alignment sample, so alignment is still unchecked. `ImportedXmlComponent.fromXmlString()` in docx 9.14.0 returns a document node. Inserting that node writes an element named `undefined`, and Word refuses the file. The `m:oMath` child is what goes in the paragraph. FR-56 stays the image fallback when a conversion fails.

ADR-012's decision should gain this sentence. The package check showed the wrapper, and Word refused the file that contains it:

> In docx 9.14.0, `ImportedXmlComponent.fromXmlString()` returns the document node. Inserting that node writes an element named `undefined`, and Word refuses to open the file. The `m:oMath` child is what goes in the paragraph. Display equations are wrapped in `m:oMathPara` after conversion.

The S-03 row in architecture section 9.1 can record the conditional pass and point at this note. ADR-005 stays OMML with an image fallback. R-01's mitigation stays that fallback for a conversion that fails, not a second converter. Alignment stays UNVERIFIED until a sample that uses it is checked.

## Steps

From `spikes/s03`:

```
npm ci
npm run typecheck
npm run lint
npm start
```

The `.docx` files, `FILES.txt`, and `spike-report.json` are written to `output/`. That directory is gitignored. The workflow uploads those files as `s03-docx-windows-latest` and `s03-docx-ubuntu-latest`. On Ubuntu the job installs LibreOffice first. A Flat ODF conversion is written under `output/libreoffice/` and is not part of the upload.
