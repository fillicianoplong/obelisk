# Spike S-04: Mermaid strict and CSP

Throwaway check for issue 11. Nothing here is part of the app, and nothing here is imported from `src/`.

## Question

Does Mermaid 12 render at `securityLevel: 'strict'` inside the sandboxed Electron 45 renderer, fully offline, under the app CSP? Which `style-src` (and any other directive) do KaTeX and Mermaid need? Does either library need `eval`, `new Function`, inline scripts, or the network?

## Result

Judgement on the current `style-src app:`. The owner then chose option 8. See Decision.

Mermaid produced an SVG for every diagram type I tried, at `securityLevel: 'strict'`, with the network off and with `script-src app:` (no `'unsafe-eval'`, no `'unsafe-inline'`). The flowchart is not readable under the app's current `style-src app:`: the used box is the slot width and the shape fill stays black. KaTeX drew the formula-reference samples under that same directive, from `app:` fonts, with no network request. MathML output for the fraction used no style attributes.

On the path that assigns the SVG with `innerHTML`, the declared size and the theme fill both show up when inline style elements and inline style attributes are both allowed. They also both show up after the style attributes are moved into the diagram stylesheet, with style attributes still blocked, if that stylesheet is allowed (`style-src-elem 'unsafe-inline'`, or one `<style>` element whose `nonce` is set from script). A `blob:` stylesheet after the same move did not apply.

## Decision

Chosen: post-process the SVG, then one per-render nonce. Move each style attribute into the diagram's stylesheet. Allow that sheet with `style-src-elem app: 'nonce-…'` and `style-src-attr 'none'`. No `'unsafe-inline'` on any directive. `script-src` stays `app:`.

Two extra rules are part of the choice:

1. Drawing-property allowlist. When a declaration is copied or kept, the property has to be one of: `fill`, `fill-opacity`, `fill-rule`, `stroke`, `stroke-width`, `stroke-dasharray`, `stroke-dashoffset`, `stroke-linecap`, `stroke-linejoin`, `stroke-miterlimit`, `stroke-opacity`, `opacity`, `color`, `font-family`, `font-size`, `font-weight`, `font-style`, `text-anchor`, `dominant-baseline`, `width`, `height`, `max-width`, `min-width`, `max-height`, `min-height`. Anything else is dropped, including `url()`, `@import`, `position`, `content`, `display`, and any declaration or selector that contains `{`, `}`, or `<`.
2. Per-diagram scoping. Every selector in the nonced sheet is prefixed with that diagram's id (`#s04-flowchart …`) unless it is already scoped to that id. A rule cannot match an element outside the diagram.

The check runs on the `rewrite-nonce` page. The host exits 1 unless it passes, so both CI jobs have to run it. On the local sandboxed Linux host the sample flowchart was 186×467 with fill `rgb(51, 51, 51)`, and 0 style attributes left. A flowchart whose `classDef` and `style` lines set `position:fixed`, `content:pwn`, and `display:none` next to `fill` and `stroke` kept only the drawing properties (`fill:#333`, `stroke:#333`, `stroke-width:2px`). Mermaid 12.2.0 rejects a style value that contains `(`, so `url(` is not a parsed style line; the same filter is given a sheet that also contains `url(https://example.invalid/x.png)`, `@import`, `#s04-sentinel{display:none;position:fixed;color:…}`, and `.s04-outside{color:…}`. The kept sheet has none of `position`, `display`, `content`, `url(`, or `@import`. The allowlisted `color` and `fill` on those outer selectors are prefixed with `#s04-style-hostile`. The sentinel and the outside element stay `rgb(28, 25, 23)` and `display:block`.

Rejected:

1. Leave `style-src app:` and accept the degraded diagram: the flowchart stays 720×1806 with a black fill.
2. `'unsafe-inline'` only on `style-src-attr`: the size comes back and the fill stays black.
3. `'unsafe-inline'` only on `style-src-elem`, with no post-process: the fill comes back and the size stays 720×1806.
4. `'unsafe-inline'` for elements and attributes: the flowchart is 186×467 with fill `#333`, and both style channels are open.
5. Hashes: the flowchart stylesheet hash contains the diagram id, and the fraction's attribute hashes do not cover Mermaid.
6. A nonce on Mermaid's existing `<style>` elements, attributes left in place: the innerHTML path does not keep the declared size, and a nonce cannot cover a style attribute.
7. Post-process, then `'unsafe-inline'` only on `style-src-elem`: the size and fill come back, and every inline stylesheet is allowed.
9. Post-process, then a `blob:` stylesheet: the sheet did not apply (720×1806, black fill).
10. Cut the diagram block: formulas stay, and FR-82 goes away.

Still open, not decided here: whether elkjs 0.9.3 (EPL-2.0) in the Mermaid tree is acceptable to ship, and whether to strip the `href` the click probe leaves on the SVG (`https://example.invalid/clicked`, no request).

The spike process exits 0 when it has written the report. Judgement is a result of the run, and the CI job is meant to pass.

## What was tested

A throwaway Electron host under `spikes/s04/src/` opens one window with the same `webPreferences` as `src/main/security/window-options.ts`: `contextIsolation`, `sandbox`, `nodeIntegration` false (including worker and subframes), `webviewTag` false, `webSecurity` true, `allowRunningInsecureContent` false, `experimentalFeatures` false, `navigateOnDragDrop` false, `enableWebSQL` false. The `app` scheme is privileged the same way as the app (`standard`, `secure`, `supportFetchAPI`, `corsEnabled`, `stream`, `bypassCSP` false, `allowServiceWorkers` false). The baseline CSP string is read from `src/main/security/csp.ts` and checked equal to the header the spike sends. Navigation, new windows, webviews, and permission requests are denied.

The page is `app://obelisk/index.html`. It loads `katex.min.css` and the bundled renderer. There is no inline script and no inline style in the HTML. `script-src` stays `app:` on every policy. `font-src`, `connect-src`, and `img-src` stay as in the app (`font-src app:`, `connect-src 'none'`, `img-src app: data: blob:`). I did not add `https:`.

Style policies, in the order the host runs them after the baseline flowchart fails the readable check:

| Id | Style directives |
|---|---|
| baseline | `style-src app:` (the app string) |
| attr-inline | `style-src-elem app:`; `style-src-attr 'unsafe-inline'` |
| elem-inline | `style-src-elem app: 'unsafe-inline'`; `style-src-attr 'none'` |
| both-inline | `style-src-elem app: 'unsafe-inline'`; `style-src-attr 'unsafe-inline'` |
| style-src-inline | `style-src app: 'unsafe-inline'` (elem and attr fall back to it) |
| nonce-inner | `style-src-elem app: 'nonce-…'` with the nonce written into the SVG markup |
| nonce-reattach | same nonce policy, but the `<style>` elements are parsed out and recreated with `element.nonce` |
| hash-elements | `style-src-elem` gets the sha256 of the flowchart `<style>` text; `style-src-attr 'none'` |
| rewrite-elem | style attributes moved into the diagram stylesheet, SVG assigned with `innerHTML`; `style-src-elem app: 'unsafe-inline'`; `style-src-attr 'none'` |
| rewrite-blob | same move, stylesheet loaded from `blob:`; `style-src-elem app: blob:`; `style-src-attr 'none'` |
| rewrite-nonce | same move, then the drawing-property allowlist and id prefix, one `<style>` appended with `element.nonce`; `style-src-elem app: 'nonce-…'`; `style-src-attr 'none'` |
| rewrite-baseline | same move as `rewrite-elem`, under the app's `style-src app:` |
| hash-attributes | `style-src-attr 'unsafe-hashes'` plus the sha256 of the fraction's style attributes |

Mermaid is initialized the way section 6.4 describes: `securityLevel: 'strict'`, `startOnLoad: false`, `htmlLabels: false`, `fontFamily: 'sans-serif'`, `theme: 'default'`, `maxTextSize: 50000`, `suppressErrorRendering: true`, and `secure` adds `themeCSS`, `themeVariables`, `fontFamily`, `htmlLabels`, `dompurifyConfig`, and `theme` on top of Mermaid's own secure keys. `maxEdges` stays at Mermaid's default (500). Layout stayed `elk`. The dagre retry did not run, because the diagrams rendered.

KaTeX options: `throwOnError: true`, `trust: false`, `displayMode: true`, `maxSize: 50`, `maxExpand: 1000`, a fresh `macros` object per render, and a `strict` handler that returns `'error'` for `htmlExtension` and `'ignore'` otherwise (KaTeX 0.19 treats a strict callback that returns `undefined` as a warning).

Diagrams: flowchart, sequence, class, state, er, pie, gantt, mindmap, timeline, gitGraph, journey, quadrant, block-beta, xychart-beta, requirement. Security probes: an HTML label (`img`, `onerror`, `script`, `b`), `click` with `call` and an `https` URL, an `%%{init}%%` directive trying to set `securityLevel` loose, `htmlLabels` true, `theme` dark, `themeCSS`, `fontFamily` and `altFontFamily` to `https` URLs, and `dompurifyConfig`, and a `classDef` breakout aimed at a sentinel div.

Formulas, from the SRS formula reference: `\frac{a+b}{c}` as HTML, MathML, and both; `\sqrt{x^2+y^2}`; `\sum_{i=1}^{n} i^2`; `\int_0^1 x\,dx`; a `pmatrix`; `\hat{\theta} = \alpha + \beta`. Hostile checks: `\href`, `\htmlStyle`, and a `\gdef` that must not leak into the next formula.

A flowchart counts as readable when it renders, the labels Start, Ready, and Done are present, the used width is within 1.2× of the `max-width` Mermaid put on the SVG style attribute (186.23px for this sample), and the first shape's computed fill is not black, none, or transparent. A fraction counts as readable when the numerator sits above the denominator, the font family includes `KaTeX`, and the fraction bar is wider than 4px.

## Versions

| Piece | Version | License |
|---|---|---|
| mermaid | 12.2.0 | MIT (`LICENSE`) |
| katex (formulas) | 0.19.1 | MIT (`LICENSE`) |
| katex (nested, mermaid depends on `^0.18.0`) | 0.18.10 | MIT (`LICENSE`) |
| elkjs (mermaid dependency) | 0.9.3 | EPL-2.0 (`LICENSE.md`) |
| dompurify | 3.4.17 | (MPL-2.0 OR Apache-2.0) |
| khroma | 2.1.0 | MIT in the `license` file; `package.json` has no `license` field |
| Electron | 45.0.0 (Chrome 156.0.8078.48) | the app's existing devDependency |
| Node, the check runner | 22.23.4 | |
| Node inside Electron | 24.22.0 | |

Pinned with `save-exact=true` in `spikes/s04/package.json` and this directory's lockfile. They are not in the app `package.json`, so the packager and the MSIX build do not ship them. Electron is launched from `node_modules/electron/path.txt`.

`npm audit` on this tree reported 0 vulnerabilities (118 prod, 30 dev, 27 optional).

The esbuild bundle of the page, `renderer.js`, is 12,325,210 bytes. It is one file. Split chunks hung under the `app` protocol on an earlier try, so the spike does not use dynamic `import()` chunks. The KaTeX font files copied next to the page total 1,076,572 bytes. The page requested four of them, all `app:`: `KaTeX_Main-Regular.woff2` (26,272), `KaTeX_Math-Italic.woff2` (16,440), `KaTeX_Size2-Regular.woff2` (5,208), `KaTeX_Size3-Regular.woff2` (3,624). The CSS font URLs are relative `url(fonts/KaTeX_*.woff2)`. The copied `katex/dist` also contains the CLI contrib scripts. The HTML does not load them.

Mermaid 12's default `securityLevel` is already `strict`. Its default `htmlLabels` is effectively true (`htmlLabels ?? flowchart.htmlLabels ?? true`), so the spike sets the root `htmlLabels: false`. The default secure list is `secure`, `securityLevel`, `startOnLoad`, `maxTextSize`, `suppressErrorRendering`, `maxEdges`. It does not include `themeCSS`, `fontFamily`, `htmlLabels`, or `theme`; the spike adds those, as section 6.4 does. `elkjs` is constructed with `new ELK()` and no `workerUrl`, which uses elk's in-process fake worker. The page's `Worker` wrapper recorded no `Worker` call.

### Advisories

On 2026-10-27 I listed the GitHub security advisories for `mermaid-js/mermaid`. Every one of them is patched at or before 11.16.1 (and 10.9.8 on the 10.x line). 12.2.0 is outside those ranges. The ones that matter for this CSP question:

| Advisory | What | Patched |
|---|---|---|
| GHSA-7rqq-prvp-x9jh | sequence label XSS | 11.10.0 / 10.9.4 |
| GHSA-8gwm-58g9-j8pw | architecture `iconText` XSS | 11.10.0 |
| GHSA-xcj9-5m2h-648r | `classDef` CSS injection | 11.15.0 / 10.9.6 |
| GHSA-6x64-9x62-f2gx | CSS that can apply to siblings of the diagram | 11.16.1 / 10.9.8 |

The sibling-CSS advisory's workaround includes putting `themeCSS`, `fontFamily`, `altFontFamily`, and `themeVariables` in the secure list. This spike secures `themeCSS`, `themeVariables`, and `fontFamily`. `altFontFamily` is not a config key in 12.2.0: the directive sanitizer deletes keys that are not in the config key set, and that name only appears as a CSS-option matcher. After the hostile init directive, `altFontFamily` was still null.

## Where it ran

Command: `npm start` in `spikes/s04` (typecheck the node host and the renderer, bundle the page, launch Electron). Workflow: `.github/workflows/spike-s04.yml`, on `windows-latest` and `ubuntu-latest`, Node 22.23.4. Ubuntu uses `xvfb-run`. The workflow uploads `spikes/s04/output/` (`sample.png`, `spike-report.json`, `pages.json`).

### Linux, with a display

Kernel `6.12.94+`, `#1 SMP PREEMPT_DYNAMIC Mon Oct 26 18:36:23 UTC 2026`. Node 22.23.4. The host was not started with `--no-sandbox`.

Preload log: `{"sandboxed":true,"contextIsolated":true,"type":"renderer"}`. The renderer command line contained `--enable-sandbox`. `app.getAppMetrics()` leaves `sandboxed` and `integrityLevel` empty on Linux. Outcome `judgement`. `hostNoSandbox` false. Screenshot policy `both-inline`.

### CI

Workflow `.github/workflows/spike-s04.yml`, run [40464232909](https://github.com/fillicianoplong/obelisk/actions/runs/40464232909), on commit `912eabd244902ed77df9f5e48c64d4493c7bbd30`. That run executed this spike, including the post-process rows. Both jobs passed. Outcome `judgement`. Screenshot policy `both-inline`. On both jobs `rewrite-elem` and `rewrite-nonce` were 186×467 with fill `rgb(51, 51, 51)`, 33 attributes moved and 0 left, and the id `max-width` rule present. `rewrite-blob` and `rewrite-baseline` stayed 720×1806 and black. Those match the Linux host above.

| Job | Job id | Image | Image version | OS |
|---|---|---|---|---|
| Mermaid and KaTeX (ubuntu-latest) | 122055705966 | `ubuntu-24.04` | `20261012.334.1` | Ubuntu 24.04.5 LTS |
| Mermaid and KaTeX (windows-latest) | 122055706743 | `windows-2025-vs2026` | `20261021.278.1` | Microsoft Windows Server 2025 Datacenter, `10.0.26100` |

Electron 45.0.0, Chrome 156.0.8078.48, Node inside Electron 24.22.0, runner Node v22.23.4.

Ubuntu kernel in the report: `6.17.0-1022-azure`, `#22-Ubuntu SMP Mon Jul 27 17:24:03 UTC 2026`. The first launch aborted because `chrome-sandbox` is not owned by root with mode 4755 (`The SUID sandbox helper binary was found, but is not configured correctly`). The host retried with `--no-sandbox` and recorded `hostNoSandbox: true`. The preload on that retry still reported `sandboxed: true` and `contextIsolated: true`. `app.getAppMetrics()` left `sandboxed` and `integrityLevel` empty. I am not treating the Ubuntu retry as the Chromium sandbox proof. The CSP and render numbers matched Windows.

Windows did not retry. `hostNoSandbox` false. Preload `sandboxed: true`, `contextIsolated: true`. `getAppMetrics`: Browser `sandboxed` false, integrity `high`; GPU `sandboxed` true, integrity `low`; Network Service `sandboxed` false, integrity `high`; Tab `sandboxed` true, integrity `untrusted`. The Windows screenshot is 1008×655.

Ubuntu run [40464831697](https://github.com/fillicianoplong/obelisk/actions/runs/40464831697) had the same measurements and threw `UnknownVizError` from `capturePage` after the gallery had finished, so the report file was never written. The host now retries that capture and still writes the report if the capture keeps failing. The sizes in the table above are from run 40464232909, which did capture the screenshot. That run is before the allowlist and the scoping prefix. The decision check on `rewrite-nonce` remeasures the flowchart after both rules and fails the job if it does not pass.

## How the checks are done

`npm start` builds `dist/www/renderer.js`, serves it on `app://obelisk/`, and writes `output/pages.json` and `output/spike-report.json`. `output/sample.png` is `capturePage` of the window after the gallery run (flowchart plus `\frac{a+b}{c}` as HTML and MathML).

The host's `webRequest.onBeforeRequest` filter cancels `http`, `https`, `ws`, `wss`, `file`, and `ftp`. It does not also intercept `app:`. Intercepting a scheme that `protocol.handle` is serving deadlocked an earlier run. `app:` requests are recorded in the protocol handler. The app's own filter still covers every URL; this spike's filter is narrower so the page can load.

`eval` and `new Function` are not wrapped. A `Proxy` around `Function` stopped the first async function from running in Chrome 156. CSP is the check: `script-src` has no `'unsafe-eval'`. No `script-src` violation other than `script-src-attr` was reported, and the call log (Worker) stayed empty.

## Results

### Baseline CSP (`style-src app:`)

Violations on the full page: `style-src-elem` 55, `style-src-attr` 763, `script-src-attr` 2 (`disposition: enforce`, `blockedURI: inline`). No `script-src` (eval) violation. No blocked network URL. Protocols observed: `app:` only, nine requests (the document, two stylesheets, two scripts, four woff2 fonts). `document.fonts.check('16px KaTeX_Main')` was true.

Every diagram except the `classDef` probe returned an SVG (`ok: true`). The flowchart's style attribute declares `max-width: 186.23px`. With style attributes blocked the used box was 720×1806 and the shape fill was `rgb(0, 0, 0)`. Each diagram's `<style>` text is id-scoped (`#s04-flowchart…`, 4,923 bytes for the flowchart, and the id is inside the CSS). The style element was blocked, so that fill did not apply.

The fraction still stacked. HTML `\frac{a+b}{c}` on the full baseline page: numerator and denominator tops 26.4px apart, bar width 38.9px, font `KaTeX_Main`, 12 style attributes present in the DOM and blocked by CSP. MathML output of the same formula: stacked, height 28.6px, 0 style attributes. The other reference samples rendered (`ok: true`) at heights 24.7 (root), 56.7 (sum), 47.9 (integral), 46.5 (matrix), and 23.8 (greek).

That 38.9px bar is the full baseline page only. `elem-inline` blocks style attributes and measured the same bar at 42.2px. `rewrite-baseline` sends `style-src app:` again, on a later page, and also measured 42.2px. I am not treating the 3px gap as a reason to allow style attributes for formulas. The reference samples stack under the current CSP either way.

### What each loosened policy did to the flowchart

Used size and fill for the same flowchart. Declared max-width 186.23px throughout.

| Policy | Used size | Fill | Readable |
|---|---|---|---|
| baseline | 720×1806 | `rgb(0, 0, 0)` | no |
| attr-inline | 186×467 | `rgb(0, 0, 0)` | no |
| elem-inline | 720×1806 | `rgb(51, 51, 51)` | no |
| both-inline | 186×467 | `rgb(51, 51, 51)` | yes |
| style-src-inline | 186×467 | `rgb(51, 51, 51)` | yes |
| nonce-inner | 720×1806 | `rgb(51, 51, 51)` | no |
| nonce-reattach | 186×467 | `rgb(51, 51, 51)` | yes, on this insertion path |
| hash-elements | 720×1806 | `rgb(51, 51, 51)` | no |
| hash-attributes | 720×1806 | `rgb(0, 0, 0)` | no |
| rewrite-elem | 186×467 | `rgb(51, 51, 51)` | yes |
| rewrite-blob | 720×1806 | `rgb(0, 0, 0)` | no |
| rewrite-nonce | 186×467 | `rgb(51, 51, 51)` | yes |
| rewrite-baseline | 720×1806 | `rgb(0, 0, 0)` | no |

`rgb(51, 51, 51)` is `#333` from the Mermaid stylesheet. Black is the SVG default when that stylesheet does not apply. `attr-inline` applies the `max-width` style attribute and blocks the `<style>` element. `elem-inline` does the opposite, and the SVG grows to the slot's 720px cap. `both-inline` and `style-src-inline` do both, and the fraction stayed readable (bar 42.2px). Those two policies left only the two `script-src-attr` violations.

`nonce-inner` writes `nonce` into the markup string. The flowchart stylesheet did color the shapes, and the size stayed 720×1806. `nonce-reattach` parses the SVG as XML, drops the `<style>` elements, and appends new ones with `element.nonce`. That run measured 186×467 and `#333`, with `style-src-attr 'none'` and 92 `style-src-attr` violations still reported. I am not treating that as a way to avoid `'unsafe-inline'` for attributes. The insertion path is XML `importNode`, the style attributes were still in the tree, and the `innerHTML` path (baseline, `elem-inline`, `both-inline`) needs the attribute directive for the declared size. Nonces do not apply to style attributes.

`hash-elements` allowed the one flowchart stylesheet (the hash was `sha256-yvvNXBuUrO4VMXRycLAN8yjamaGSr5EWUqiQedHgexo=`) and still reported 15 `style-src-elem` violations from the other diagrams. The hash covers that one CSS text, which contains the diagram id, so it is not a static policy for user diagrams. Style attributes stayed blocked, so the flowchart stayed at 720×1806. `hash-attributes` hashed the fraction's style attributes (`'unsafe-hashes'`). The flowchart stayed black and at 720×1806, and 245 `style-src-attr` violations remained. A fraction's attribute hashes do not cover Mermaid's, and a user formula would mint new ones.

The gallery screenshot uses `both-inline`, the first policy in the list above on which the innerHTML flowchart was readable and the fraction was readable. The post-process rows are measurements. They are not in that winner list, so the screenshot does not switch to them.

### Moving style attributes into the stylesheet

Mermaid's SVG root carries `width="100%"` and `style="max-width: …px"`. `querySelectorAll('[style]')` does not see the root, so the move includes the root when it has a style attribute. Each other style attribute becomes a class rule. The root becomes an id rule, `#s04-flowchart{max-width: 186.2289276123047px;}`, because a class loses to the page rule `.slot svg { max-width: 720px }`. A declaration whose text contains `{`, `}`, or `<` is left as an attribute and stays blocked when `style-src-attr` is `'none'`.

`rewrite-elem` moved 33 attributes, left 0 style attributes on the kept SVG, and the id rule was present. Used size 186×467, fill `rgb(51, 51, 51)`, fraction bar 42.2px. Policy `style-src-elem app: 'unsafe-inline'` and `style-src-attr 'none'`. The page still reported 243 `style-src-attr` violations. Those come from Mermaid's temporary DOM during `mermaid.render()` and from KaTeX attributes. The kept flowchart SVG had 0 style attributes.

`rewrite-nonce` did the same move, then appended one `<style>` with `element.nonce`. The nonce path now also applies the drawing-property allowlist and the id prefix from the Decision section. After that filter the flowchart was still 186×467 with fill `rgb(51, 51, 51)`, 0 style attributes left, and the fraction stayed stacked. No `'unsafe-inline'`. The page still reports `style-src-elem` and `style-src-attr` violations from Mermaid's temporary DOM before the kept SVG is swapped.

`rewrite-blob` did the same move into a `blob:` link (`style-src-elem app: blob:`). 33 attributes moved, 0 left, no `<style>` in the SVG. Fill stayed black and the box stayed 720×1806. Violations were `blockedURI: inline` only. The blob sheet did not apply.

`rewrite-baseline` did the same move under `style-src app:`. The id rule was in the `<style>` element, and that element was blocked. Fill stayed black and the box stayed 720×1806. Moving the attributes is not enough while the stylesheet itself is blocked.

### Security probes (baseline and the canary policies)

Config after the hostile `%%{init}%%`: `securityLevel` `strict`, `htmlLabels` false, `theme` `default`, `fontFamily` `sans-serif`, `themeCSS` null, `dompurifyConfig` null, `startOnLoad` false, `maxTextSize` 50000, `maxEdges` 500, `layout` `elk`. The page global the payload tried to set stayed 0.

The HTML-label probe's visible text was the literal `<img src="https://example.invalid/pixel.png"> <b>Bold </b>`. Script elements 0, image elements 0, foreignObject 0. `htmlLabels: false` kept that label as text.

The click probe left `href="https://example.invalid/clicked"` on the SVG and left no `on*` attribute in the serialized SVG. The `click call` did not run. Two `script-src-attr` violations, enforced, were reported on each page that included the HTML-label and click probes (console text on the first run: "Executing inline event handler"). No request was made to `example.invalid`. `will-navigate` is cancelled in this host, as in the app.

The `classDef` breakout is a parse error on 12.2.0 (`Expecting 'SEMI' … got 'UNICODE_TEXT'`). The sentinel background stayed `rgba(0, 0, 0, 0)`. That shows this payload does not parse. It does not by itself prove an older injection is impossible; the published `classDef` advisory is patched before 12.2.0.

KaTeX with `trust: false` rejected the `\href` sample. `\htmlStyle` threw (htmlExtension). A `\gdef` in one formula was not defined in the next formula, which has its own empty `macros` object.

Journey, with `htmlLabels: false`, still emitted 3 `foreignObject` elements. Script elements 0, image elements 0.

No diagram's CSS contained a remote `url()`.

### Network, eval, scripts

No `http`, `https`, `ws`, `wss`, or `file` request was observed. The four font requests and the scripts and stylesheets were `app:`. The call log was empty (`Worker` was not constructed). No `script-src` violation for `eval` or `new Function`. The inline event handlers that Mermaid attempted were blocked by `script-src app:`.

## Options

These are the measurements the decision was made from. `script-src` stayed `app:` on every one of them. Nothing here needed the network. The chosen row is option 8, plus the allowlist and the scoping prefix in the Decision section.

### 1. Leave `style-src app:` and accept the degraded diagram

Allows: the current header. Stylesheets and style attributes stay limited to `app:`. No `'unsafe-inline'`, no nonce, no hash.

What breaks: the flowchart SVG is produced, then the theme `<style>` and the root `max-width` attribute are both blocked. Used box 720×1806, fill `rgb(0, 0, 0)`. Labels Start, Ready, and Done are still in the text. KaTeX reference samples still stack from `app:` fonts. The MathML fraction has no style attributes.

Security cost: none added.

### 2. `'unsafe-inline'` only on `style-src-attr`

Directive: `style-src-elem app:`; `style-src-attr 'unsafe-inline'`. There is no `style-src` fallback.

Allows: every style attribute in the document. Inline `<style>` elements stay blocked.

What breaks without it: the flowchart stays at the slot width (720×1806), because `max-width` lives on a style attribute. With this directive alone the used box was 186×467 and the fill stayed black, because the theme stylesheet was still blocked.

Security cost: any style attribute applies, including one a later diagram payload might emit. A nonce cannot cover a style attribute. Covering attributes with hashes needs `'unsafe-hashes'`, and the hashes change per diagram (option 5).

### 3. `'unsafe-inline'` only on `style-src-elem`

Directive: `style-src-elem app: 'unsafe-inline'`; `style-src-attr 'none'`. No post-process.

Allows: any `<style>` element. Style attributes stay blocked.

What breaks without it: the theme fill stays black. With this directive alone the fill was `rgb(51, 51, 51)` (`#333`) and the used box stayed 720×1806, because `max-width` was still blocked.

Security cost: any stylesheet in the page applies. That is the channel in the patched `classDef` and sibling-CSS advisories, if a future payload parses. Style attributes stay blocked.

### 4. `'unsafe-inline'` for elements and attributes

Either `style-src-elem app: 'unsafe-inline'` plus `style-src-attr 'unsafe-inline'`, or one `style-src app: 'unsafe-inline'` (elem and attr both fall back to it).

Allows: both channels, with no post-process. Both policies made the flowchart 186×467 with fill `#333`, and the fraction stayed stacked. This is the fallback the issue names ("set the CSP style-src per the findings"). The gallery screenshot is the two-directive form.

What breaks without both halves: option 2 keeps the size and loses the theme; option 3 keeps the theme and loses the size.

Security cost: the widest style relaxation in this list. `script-src` can stay `app:`. Both the attribute channel and the stylesheet channel are open.

### 5. Hashes

Measured. Not a static policy for documents the user writes.

`hash-elements` put the sha256 of the flowchart `<style>` text on `style-src-elem` (`sha256-yvvNXBuUrO4VMXRycLAN8yjamaGSr5EWUqiQedHgexo=`) and set `style-src-attr 'none'`. That one sheet applied (fill `#333`). The CSS contains the diagram id, so the next diagram is a different hash. 15 `style-src-elem` violations remained from the other diagrams, and the flowchart stayed 720×1806 because attributes were blocked.

`hash-attributes` put `'unsafe-hashes'` and the fraction's attribute hashes on `style-src-attr`. The flowchart stayed black and 720×1806. 245 `style-src-attr` violations remained. Those hashes do not cover Mermaid.

Allows: one exact stylesheet text, or one exact attribute value, if it is known when the header is built.

What breaks without a matching hash: that sheet or attribute stays blocked.

Security cost: low only while the set of texts is fixed. It is not fixed here. `'unsafe-hashes'` is an extra weakening on the attribute directive, and it still did not lay the flowchart out.

### 6. Nonces on Mermaid's `<style>` elements, attributes left in place

Directive: `style-src-elem app: 'nonce-…'`; `style-src-attr 'none'`. Nonces do not apply to style attributes.

`nonce-inner` writes `nonce="…"` into the markup string and assigns it with `innerHTML`. The browser hides a nonce that arrives in HTML. The flowchart was colored (`#333`) and stayed 720×1806. I am not treating the color as a nonce success.

`nonce-reattach` parses the SVG as XML, drops the `<style>` elements, and appends new ones with `element.nonce`. That run measured 186×467 and `#333`, with 32 style attributes still in the tree and 92 `style-src-attr` violations. The size on that path is the XML `importNode` size. The `innerHTML` path (baseline, `elem-inline`) does not keep that size while the attribute is blocked. I am not treating this as a way to skip attributes.

Allows: `<style>` elements whose nonce matches, when the nonce is set on the DOM property for that response.

What breaks without the attribute directive, on the innerHTML path: the declared `max-width` does not apply, so the diagram stays at the slot width even if the theme sheet is allowed.

Security cost: the nonce has to be per response and unguessable, and it has to be set from script (`element.nonce`), not from an HTML string. It does not cover style attributes. CSS inside an accepted `<style>` element still applies.

### 7. Post-process, then `'unsafe-inline'` only on `style-src-elem`

Move each style attribute into the diagram stylesheet, as in the results section. Root rule `#id{max-width: …}`. Then `style-src-elem app: 'unsafe-inline'` and `style-src-attr 'none'`, and assign the SVG with `innerHTML`.

Allows: inline stylesheets. Style attributes stay blocked. Verified as `rewrite-elem`: 186×467, fill `#333`, 33 attributes moved, 0 left on the kept SVG, fraction stacked.

What breaks without the move: option 3, theme without the declared size. What breaks without `'unsafe-inline'` on elements: `rewrite-baseline`, the moved sheet is blocked, and the diagram is 720×1806 and black again.

Security cost: any inline stylesheet applies, including CSS that was copied out of Mermaid's `<style>` and the declarations that were moved. The app has to rewrite every diagram before insertion. Attributes stay blocked, so a skipped hostile declaration (`{`, `}`, or `<` in the attribute text) does not apply. `mermaid.render()` still reports blocked inline styles from its temporary DOM. That count is not the kept SVG.

### 8. Post-process, then a nonce on that one stylesheet

Same move, then one `<style>` whose `nonce` is set with `element.nonce`. Directive: `style-src-elem app: 'nonce-…'`; `style-src-attr 'none'`. No `'unsafe-inline'`.

Allows: that one stylesheet. Style attributes stay blocked. Verified as `rewrite-nonce`: 186×467, fill `#333`, 0 style attributes left, fraction stacked.

What breaks without the nonce (or without `'unsafe-inline'`): the sheet is blocked, as in `rewrite-baseline`.

Security cost: the nonce handling from option 6. CSS copied into the nonced sheet still applies. The temporary DOM during `mermaid.render()` still reports inline `style-src-elem` and `style-src-attr` violations (20 and 243 on this run). The kept SVG is the one with the nonce.

### 9. Post-process, then a `blob:` stylesheet

Same move, linked as `blob:`. Directive tried: `style-src-elem app: blob:`; `style-src-attr 'none'`.

Tested as `rewrite-blob`. It did not work. 33 attributes moved, 0 left, no `<style>` in the SVG, fill black, box 720×1806. No `blockedURI` of `blob` was recorded. I am not offering this as a working choice.

### 10. Cut the diagram block

Keep `style-src app:`. Do not render Mermaid. The formula-reference samples stay, HTML and MathML, from `app:` fonts.

Allows: the current header, unchanged.

What breaks: FR-82, the diagram block. elkjs (EPL-2.0) and DOMPurify leave the app bundle with it.

Security cost: none added.

### Still open

The click probe left `href="https://example.invalid/clicked"` on the SVG and ran no `click call`. No request followed. `will-navigate` is cancelled. Leaving the anchor relies on those blocks. Stripping `href` at insertion is a separate change. Not decided.

If diagrams ship, the Mermaid tree also carries elkjs 0.9.3 (EPL-2.0), DOMPurify 3.4.17 (MPL-2.0 OR Apache-2.0), and khroma 2.1.0 (MIT in its license file, no `license` field in `package.json`). Mermaid itself and both KaTeX copies are MIT. Whether EPL-2.0 in the bundle is acceptable is not decided.

## Proposed doc wording

Not applied. `docs/ARCHITECTURE.md` and `docs/SRS.md` are unchanged. The wording below is for the 1.3 update. It records the chosen style-src and the post-process. The elkjs license and the click `href` stay open.

Section 6.4, replace the S-04 UNVERIFIED line with:

> Checked in spike S-04 (Mermaid 12.2.0, KaTeX 0.19.1, Electron 45.0.0). Under `style-src app:`, with `script-src app:` and the network off, KaTeX rendered the formula-reference samples (HTML and MathML) from `app:` fonts. Mermaid at `securityLevel: 'strict'` returned an SVG for the diagram types tried, and the flowchart's theme `<style>` and its `max-width` style attribute were both blocked. The chosen insertion path moves those style attributes into the diagram stylesheet, keeps only drawing properties (`fill`, `stroke`, `stroke-width`, `stroke-dasharray`, `stroke-dashoffset`, `stroke-linecap`, `stroke-linejoin`, `stroke-miterlimit`, `stroke-opacity`, `fill-opacity`, `fill-rule`, `opacity`, `color`, `font-family`, `font-size`, `font-weight`, `font-style`, `text-anchor`, `dominant-baseline`, `width`, `height`, `max-width`, `min-width`, `max-height`, `min-height`), drops `url()`, `@import`, `position`, `content`, `display`, and any declaration or selector containing `{`, `}`, or `<`, and prefixes every selector with the diagram's id. That one `<style>` element is allowed with a per-render nonce: `style-src-elem app: 'nonce-…'`; `style-src-attr 'none'`. There is no `'unsafe-inline'`. `script-src` stays `app:`. On that path the sample flowchart measured 186×467 with fill `#333`.

Section 6.4, the advisories UNVERIFIED line, the Mermaid half:

> Mermaid 12.2.0: on 2026-10-27 every GitHub advisory for mermaid-js/mermaid was patched at or before 11.16.1 (10.9.8 on the 10.x line), including the sequence XSS, the architecture `iconText` XSS, the `classDef` CSS injection, and the sibling-CSS injection. `npm audit` of that tree reported 0 vulnerabilities. Check again when the app pins a version.

Section 8 diagram row, the license cell (the version cell can stay until the app depends on it):

> MIT. Checked for 12.2.0 in spike S-04. The bundle also pulls elkjs 0.9.3 (EPL-2.0) and DOMPurify 3.4.17 (MPL-2.0 OR Apache-2.0). Whether to ship the EPL-2.0 dependency is still open.

Section 11 OD-05, replace the open license note with:

> Decided in spike S-04. Mermaid 12.2.0 renders offline in a sandboxed Electron 45 renderer. Diagrams are inserted only after style attributes are moved into the diagram stylesheet, filtered to the drawing-property allowlist, and scoped to the diagram id. `style-src-elem` is `app:` plus a per-render nonce. `style-src-attr` is `'none'`. There is no `'unsafe-inline'`. `script-src` stays `app:`. elkjs EPL-2.0 in the tree is still open. The click `href` left on the SVG is still open.

`docs/SRS.md`, the FR-82 UNVERIFIED line:

> Spike S-04 checked Mermaid 12.2.0: license MIT, renderer bundle 12,325,210 bytes plus 1,076,572 bytes of KaTeX fonts, no network request from a sandboxed Electron 45 renderer. A readable flowchart uses the post-process, the drawing-property allowlist, the per-diagram selector prefix, and a per-render style nonce (`style-src-elem app: 'nonce-…'`, `style-src-attr 'none'`). elkjs EPL-2.0 is still open. See the spike note.

The About table's "MIT (UNVERIFIED)" for Mermaid can become "MIT" for 12.2.0, with the same elkjs note.

## Steps

From the repo root, with the Electron binary installed (`node node_modules/electron/install.js`):

```
cd spikes/s04
npm ci
npm start
```

On a machine with no display, run `npm start` under `xvfb-run --auto-servernum`. The report is `output/spike-report.json`. The screenshot is `output/sample.png`.
