# Spike S-05: Save dialog replace prompt

Throwaway check for issue 12. Nothing here is part of the app, and nothing here is imported from `src/`.

## Question

Does the Windows Save dialog, opened with Electron `dialog.showSaveDialog` the way Obelisk would open it for Save As and for Export, ask before replacing an existing file?

Save As uses an Obelisk document (`.obk`). Export to Word uses a Word document (`.docx`). If the dialog does not ask, or the prompt does not stay until a click, Obelisk shows its own replace prompt. That is the fallback in FR-12.

## What Electron 45 does on Windows

I read `shell/browser/ui/file_dialog_win.cc` at the Electron 45.0.0 tag. The save dialog is an `IFileSaveDialog`. The flags are always `FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST | FOS_OVERWRITEPROMPT`. `FOS_OVERWRITEPROMPT` is the Windows replace prompt. The code sets it on every save dialog. It does not look at `showOverwriteConfirmation`.

Electron's dialog docs mark `showOverwriteConfirmation` as Linux only. On Windows, `dontAddToRecent` only adds `FOS_DONTADDTORECENT`, and `showHiddenFiles` only adds `FOS_FORCESHOWHIDDEN`. Neither flag changes the overwrite prompt, so those two are not cases.

A parent `BrowserWindow` becomes the dialog's owner. With no parent, the owner handle is null. The dialog itself runs on Electron's dialog thread. The owner handle is taken from the window on the UI thread.

`dialog.showSaveDialog` and `dialog.showSaveDialogSync` both end in that same Windows function. Obelisk would use the async call. This spike uses the async call only.

When the filter list is empty, Electron adds All Files (`*.*`) and does not set a default extension. Otherwise it sets the default extension to the first extension that is not `*.*`. For Save As that is `obk`. For a Word export that is `docx`. Windows can append that extension when the typed name does not already have it. The prompt might be about the name before the extension is added, or about the name after. Cases `save-obk-type-stem` and `export-docx-type-stem` are there to see which.

The dialog returns a path, or `canceled`. It does not write the file. The log hashes the fixture before and after so a change would show up. A new name should not exist on disk after the dialog closes.

This is the source. The Windows 11 result is in the manual section below. S-05 passes. Electron issue 52571 says that on Electron 42 the replace prompt can appear and then close with no click. I have not used that report as the result for Electron 45.0.0. The first case is there so I can see whether the prompt stays.

## Cases

Eleven dialogs. Five of them decide FR-12. Those five keep the dialog owned by the main window, which is how Obelisk would call it. The other six are context: no parent, a modal owner, the Linux property, a name that does not exist, a `.obk` name with a `.docx` filter, and no filter.

| # | Case | Decides FR-12 | What you click |
|---|---|---|---|
| 1 | `save-obk-parent-existing` | Yes | Leave the name as parent-existing.obk, click Save, and if a replace prompt stays, click Replace. |
| 2 | `save-obk-cancel-replace` | Yes | Leave the name as cancel-replace.obk, click Save, and if a replace prompt stays, click Cancel or No, then Cancel the Save dialog if it is still open. |
| 3 | `save-obk-no-parent` | No | Leave the name as no-parent.obk. The dialog may be behind this window. Click Save, and if a replace prompt stays, click Replace. |
| 4 | `save-obk-modal-parent` | No | Leave the name as modal-parent.obk. The Save dialog is owned by the small modal window. Click Save, and if a replace prompt stays, click Replace. |
| 5 | `save-obk-overwrite-property` | No | Leave the name as overwrite-property.obk, click Save, and if a replace prompt stays, click Replace. |
| 6 | `save-obk-type-stem` | Yes | Clear the name if it is not empty. Type exactly type-stem with no extension, click Save, and if a replace prompt stays, click Replace. |
| 7 | `export-docx-parent-existing` | Yes | Leave the name as parent-existing.docx, click Save, and if a replace prompt stays, click Replace. |
| 8 | `export-docx-type-stem` | Yes | Clear the name if it is not empty. Type exactly type-stem with no extension, click Save, and if a replace prompt stays, click Replace. |
| 9 | `save-obk-new-name` | No | Change the name to lesson-copy.obk and click Save. A replace prompt should not appear. If one stays, click Cancel or No. |
| 10 | `save-filter-mismatch` | No | Do not edit the name. Read it, click Save, and if a replace prompt stays, click Replace. |
| 11 | `save-nofilter-existing` | No | Leave the name as nofilter-existing.obk, click Save, and if a replace prompt stays, click Replace. |

The window repeats these clicks and lists what to watch. The same text is written to `output/steps.txt` when the walkthrough starts, in case a dialog covers the window.

If a case never returns, close the Save dialog from the taskbar if you can. If the window is stuck, end it from Task Manager and write that down. The report keeps the cases that finished.

## What the log records

For each case the report stores the options passed to `dialog.showSaveDialog` (title, default path, filters, properties, and which window owned the dialog), `canceled`, `filePath`, the fixture sha256 before and after, whether those bytes changed, whether the returned path exists, and whether it is the fixture file. It also stores the two answers from the window: what the replace prompt did, and what was clicked. The dialog's own return value cannot tell a prompt that stayed from a prompt that closed by itself. Those answers are the difference.

## Steps

Electron 45 has no postinstall. From the repo root, once:

```
npm ci
node node_modules/electron/install.js
npm ci --prefix spikes/s05
```

On Windows 11, with `CI` unset, this opens the walkthrough. The window is shown as soon as it is created, the same way the Obelisk window is shown, and the page loads from the `s05:` scheme. The terminal prints the window bounds, the content bounds, the document title, and how many characters of text are in the page. It saves a picture of that window to `output/walkthrough.png` before the first Save dialog. Press F12 to open DevTools. This opens DevTools when the window opens:

```
npm --prefix spikes/s05 start -- --devtools
```

If the page cannot load, the terminal prints the load error, the preload error, or the console error, and the window shows that text instead of an empty frame:

```
npm --prefix spikes/s05 start
```

From `spikes/s05` the same run is:

```
npm start
```

`npm start -- --check` builds and runs the checks only, and does not open a Save dialog. The workflow uses that path because `CI` is set and because a runner cannot click the dialog.

## Automated results

These checks do not open a Save dialog. They start Electron 45.0.0, compare it with the app's `devDependencies.electron`, check that `dialog.showSaveDialog` is present, check the case list and this README, prove that a one-byte edit changes the sha256, prove that every `defaultPath` is absolute and the fixture file exists, and open the walkthrough window long enough to read case 1. The page must show `save-obk-parent-existing`, the words Click Save, and the Electron version. The check opens that page in the same window the Windows walkthrough uses, stubs `dialog.showSaveDialog`, and clicks Open the Save dialog. The native dialog stays closed, so `dialogsOpened` stays 0. The check fails if that window comes back as a dark empty frame. It writes `output/spike-report.json`. It also writes `output/walkthrough.png` when `capturePage` returns an image. On some Ubuntu runners `capturePage` throws `UnknownVizError` after the page has already rendered. The host retries that call. If it still fails, the report records the error and the check still passes, because the page text was already in the window.

Workflow: `.github/workflows/spike-s05.yml`, on `windows-latest` and `ubuntu-latest`, Node 22.23.4. The job stops after 20 minutes. The spike step stops after 8 minutes. Ubuntu starts Electron under `xvfb-run`. The workflow does not run the app's typecheck, lint, or test jobs. Those stay on the main CI workflow. This spike's typecheck runs in the spike job, and the spike job lints `spikes/s05` with the repo eslint config.

### This machine

Linux, kernel `6.12.94+`, `#1 SMP PREEMPT_DYNAMIC Mon Oct 26 18:36:23 UTC 2026`. The command was `npm start` in `spikes/s05`. Node on that command was v22.23.4. Electron 45.0.0, Chrome 156.0.8078.48, and Node 24.22.0 inside Electron. The host was not started with `--no-sandbox`. `dialogsOpened` is 0. Every check passed: the Electron version matches the app, both save-dialog functions are present, the case list matches this note, the README ticks Pass and leaves Fail unticked, the walkthrough page does not import Node or Electron, a one-byte edit changes the sha256 and restoring the bytes restores it, every default path is absolute, and the window shows case `save-obk-parent-existing`. The Windows 11 walkthrough is in the manual section, not in this Linux check.

### GitHub Actions

Run [40546304908](https://github.com/fillicianoplong/obelisk/actions/runs/40546304908), on commit `1b162c0755e139bb7bde1738d57b397894750008`. Both jobs ran the check command. Neither job opened a Save dialog. `dialogsOpened` is 0. Every check passed. Electron 45.0.0, Chrome 156.0.8078.48, Node 24.22.0 inside Electron, and Node v22.23.4 on the runner.

| Job | Job id | Image | Image version | OS |
|---|---|---|---|---|
| Save dialog (windows-latest) | 122337749648 | `windows-2025-vs2026` | `20261021.278.1` | Windows Server 2025 Datacenter, `10.0.26100` |
| Save dialog (ubuntu-latest) | 122337750236 | `ubuntu-24.04` | `20261012.334.1` | Ubuntu 24.04.5 LTS |

Windows did not retry. `hostNoSandbox` is false. The walkthrough page showed case `save-obk-parent-existing`, and `capturePage` wrote `walkthrough.png`. This is the GitHub Windows image. It is not the Windows 11 walkthrough.

Ubuntu kernel in the report: `6.17.0-1022-azure`, `#22-Ubuntu SMP Mon Jul 27 17:24:03 UTC 2026`. The first launch aborted because `chrome-sandbox` is not owned by root with mode 4755. The host retried with `--no-sandbox` and recorded `hostNoSandbox: true`. The page rendered under `xvfb-run`. The first `capturePage` threw `UnknownVizError`. The next attempt wrote `walkthrough.png`, and the check still passed.

## Blank window

The first Windows 11 run opened the Spike S-05 frame and left it dark gray. Nothing was printed after the startup checks. The second run, on Windows 11 Home 10.0.26300 with an NVIDIA GeForce RTX 4070, printed that `s05://page/renderer.html` had loaded and that case `save-obk-parent-existing` was in the document. The frame on screen was still a plain dark gray client area, and no Save dialog opened. Electron also warned that the page had no Content-Security-Policy. The report had no picture of that window. The Obelisk window from `npm start` at the repo root paints on that same PC with this same Electron 45.

The Obelisk window is shown as soon as it is created, its background color is a six-digit hex color, and the code does not resize it after it appears. On Windows that window uses a hidden title bar and a caption overlay. Its `app:` scheme is registered with `allowServiceWorkers: false` and `bypassCSP: false`, and the page response carries a Content-Security-Policy with no `unsafe-eval` and no `unsafe-inline`. This walkthrough now does the same. The window is visible while the page loads. The background color is `#F4F1EA`. On Windows the caption is that same overlay, and the page keeps 32px clear at the top so the heading is not under the buttons. The `s05:` scheme uses those same privileges. The page response carries that same policy, with `s05:` in place of `app:`, and the styles are in `renderer.css`. The host does not turn the GPU off, and it does not change the Windows theme, because the Save dialog under test uses that theme.

The next run prints the window bounds, the content bounds, the content size, the background color, whether offscreen rendering is on, the display scale, the document title, and the body text length. It writes `output/walkthrough.png` from `capturePage` and stores that result on `walkthroughPng`, `walkthroughCapture`, and `walkthroughPainted` in `output/spike-report.json` before any dialog opens. A cream picture with a gray window means the page was drawn and the frame did not present it. A gray picture means the page itself painted dark. If the content size is only a few pixels, the terminal says the content view is too small and sets it to the window size. Press F12, or start with `--devtools`, to open DevTools on that window. A detached DevTools window leaves the walkthrough frame uncovered.

The run on Oct 27, 2026, at commit `7ea3b12`, painted the page. `walkthroughPainted` is true, the picture is 56852 bytes, and the Save dialogs opened. That run is the manual result below.

## Manual results

**S-05 PASSES.**

I ran this on Oct 27, 2026. The build is commit `7ea3b12fc869faf8ab9dc056465bcf217e1a711f`. The command was `npm --prefix spikes/s05 start` from the repo root. Windows 11 Home, `10.0.26300`, x64, NVIDIA GeForce RTX 4070. Electron 45.0.0, Chrome 156.0.8078.48, Node 24.22.0 inside Electron. Node on the command was v24.21.0. `CI` was unset. The host was not started with `--no-sandbox`. The window painted. `walkthroughPainted` is true, and `capturePage` wrote 56852 bytes. The dialog opened 11 times. `manualComplete` is true. Electron exited 0. The log is the second run's `output/spike-report.json`.

I had already seen the same answers on the five FR-12 cases in an earlier pass through the walkthrough. In that earlier pass I canceled `save-obk-overwrite-property` by accident and misrecorded `save-obk-new-name`, so I ran all 11 cases again. This section is that second run.

In all five FR-12 cases the Windows replace prompt appeared and stayed until I clicked. Replace returned the existing path. Cancel returned canceled, with no path, and the file bytes were the same afterward. Typing the name without an extension still prompted for the existing `type-stem.obk` or `type-stem.docx`. The dialog never changed a fixture sha256. It never created `lesson-copy.obk`.

The context cases with no parent, a modal owner, `showOverwriteConfirmation`, and no filter also showed a replace prompt that stayed until I clicked Replace. `showOverwriteConfirmation` did not change what Windows did. A new name, `lesson-copy.obk`, showed no prompt.

In `save-filter-mismatch` the suggested name was the existing `filter-mismatch.obk` and the filter was a Word `.docx` filter. I did not edit the name. Windows kept `filter-mismatch.obk` and asked to replace that file. The filter did not turn the name into a `.docx`. Export has to make sure the extension matches the format itself. It cannot rely on the filter to do that.

### Machine

- Windows: Windows 11 Home, 10.0.26300, x64, NVIDIA GeForce RTX 4070
- Electron: 45.0.0 (Chrome 156.0.8078.48, Node 24.22.0)
- Commit: `7ea3b12fc869faf8ab9dc056465bcf217e1a711f`
- Date: Oct 27, 2026

### What happened

Every file path below is the fixture of that name under `spikes/s05/output/fixtures`. File changed is the fixture sha256. None of them changed.

| Case | Prompt | Button I clicked | canceled | filePath | File changed | Note |
|---|---|---|---|---|---|---|
| save-obk-parent-existing | stayed | Replace | no | parent-existing.obk | no | FR-12. Prompt stayed. |
| save-obk-cancel-replace | stayed | Cancel | yes | none | no | FR-12. No path returned. |
| save-obk-no-parent | stayed | Replace | no | no-parent.obk | no | Context. No owner window. |
| save-obk-modal-parent | stayed | Replace | no | modal-parent.obk | no | Context. Modal owner. |
| save-obk-overwrite-property | stayed | Replace | no | overwrite-property.obk | no | Context. Same prompt with the property set. |
| save-obk-type-stem | stayed | Replace | no | type-stem.obk | no | FR-12. I typed `type-stem`. Windows used type-stem.obk. |
| export-docx-parent-existing | stayed | Replace | no | parent-existing.docx | no | FR-12. |
| export-docx-type-stem | stayed | Replace | no | type-stem.docx | no | FR-12. I typed `type-stem`. Windows used type-stem.docx. |
| save-obk-new-name | did not appear | none | no | lesson-copy.obk | no | The dialog did not create lesson-copy.obk. new-name.obk was unchanged. |
| save-filter-mismatch | stayed | Replace | no | filter-mismatch.obk | no | Word filter. Windows kept the .obk name and asked to replace it. |
| save-nofilter-existing | stayed | Replace | no | nofilter-existing.obk | no | Context. No filter. |

### Pass / fail

The five cases that decide FR-12 are `save-obk-parent-existing`, `save-obk-cancel-replace`, `save-obk-type-stem`, `export-docx-parent-existing`, and `export-docx-type-stem`. The dialog is owned by the main window in all five.

- [x] Pass. In those five cases, an existing file was returned only after a replace prompt that stayed until I clicked, Cancel left the file unchanged, and the dialog did not change the file bytes. Obelisk can use that Windows prompt as the FR-12 confirmation and does not ask again.
- [ ] Fail. One of those five returned an existing file without a prompt that stayed, or Cancel changed the file, or the dialog wrote the file. Obelisk shows its own replace prompt when the chosen path already exists.

The other cases are context. They do not flip this pass.

- `save-obk-no-parent` and `save-obk-modal-parent` still showed a prompt that stayed. The owner window did not remove it.
- `save-obk-overwrite-property` still showed that same prompt. Setting `showOverwriteConfirmation` did not change Windows.
- `save-obk-new-name` returned `lesson-copy.obk` with no prompt, and the dialog did not create the file.
- `save-filter-mismatch` kept the `.obk` name under a `.docx` filter and asked to replace `filter-mismatch.obk`.
- `save-nofilter-existing` still showed a prompt that stayed.

### Acceptance criteria

- [x] Given the spike build; when I run S-05; then the findings note records the result and the build it ran on (FR-12).
- [x] Given a pass; when the note is reviewed; then the dependent item keeps the architecture's design (FR-12).
- [x] Given a fail; when the note is reviewed; then the fallback is chosen: show Obelisk's own replace prompt when the dialog does not (FR-12).
- [x] Given the spike code; when the item closes; then no spike code is merged into src/ (FR-12).

The first three are ticked from this run. The fourth is ticked because this pull request does not add spike code under `src/`.

## Proposed notes

Not applied. `docs/SRS.md` and `docs/ARCHITECTURE.md` stay as they are. S-05 passed, so the 1.3 update uses the pass wording below, plus the extension check. The fail wording stays here as the fallback if a later Windows build stops asking. The source notes apply either way.

### Source, either way

Electron 45.0.0 on Windows creates the Save dialog with `FOS_OVERWRITEPROMPT` always set. `showOverwriteConfirmation` is not read on Windows. The dialog returns a path or canceled. It does not write the file. Obelisk writes only after that return, through the existing save path.

### If this is a pass

This is the 1.3 wording. Replace the FR-12 UNVERIFIED paragraph in `docs/SRS.md` with:

> Checked in spike S-05 on Oct 27, 2026, on Windows 11 Home 10.0.26300, with Electron 45.0.0, commit 7ea3b12. For Save As (`.obk`) and Export (`.docx`), `dialog.showSaveDialog` is owned by the app window. The Windows replace prompt appeared and stayed until a click, including when the name was typed without the extension and the filter supplied `.obk` or `.docx`. Replace returned the existing path. Cancel returned canceled and left the file unchanged. The dialog did not write the file. Obelisk relies on that Windows replace prompt for Save As and Export and does not show its own second prompt. Obelisk's own replace prompt is not needed on Windows. It stays the fallback for other platforms, or if this Windows behavior changes.

In `docs/ARCHITECTURE.md` section 6.2, the Save As and Export rows on Windows use that Windows dialog as the replace prompt. Obelisk does not show a second prompt after the dialog returns a path. `file:save` still returns `exists` and writes nothing if a path exists and `replaceConfirmed` is false. On Windows, Main sets `replaceConfirmed` when `showSaveDialog`, owned by the app window, returns that path. A canceled dialog writes nothing. On other platforms, or if the Windows prompt stops staying until a click, Main shows Obelisk's own replace prompt before writing.

The section 9.1 row for S-05 can say: checked, Oct 27, 2026, Electron 45.0.0, Windows 11 Home 10.0.26300, the native prompt is the FR-12 confirmation on Windows, and Obelisk does not ask again.

### Extension check

Add this next to the export notes in `docs/SRS.md` and in `docs/ARCHITECTURE.md` section 6.2:

> Spike S-05 also checked an existing `.obk` name with a Word `.docx` filter. Windows kept `filter-mismatch.obk` and asked to replace that file. The filter did not change the extension. Export must make sure the extension matches the format itself. It must not rely on the filter to turn an existing name into `.docx` or `.obk`.

### If this is a fail

Replace the FR-12 UNVERIFIED paragraph in `docs/SRS.md` with:

> Checked in spike S-05 on Windows 11 with Electron 45.0.0. Electron asks Windows for `FOS_OVERWRITEPROMPT`, and that prompt is not the FR-12 confirmation. A Save As or Export path that already exists gets Obelisk's own replace prompt before anything is written. Cancel on that prompt leaves the file unchanged. This covers a prompt that does not appear, a prompt that closes by itself, and a filter that appends `.obk` or `.docx` without asking.

In `docs/ARCHITECTURE.md` section 6.2, keep Obelisk's own replace prompt. `file:saveAs` and `export:run` show the Windows Save dialog, then, if the returned path exists, show Obelisk's prompt. Replace calls `file:save` with `replaceConfirmed`. Cancel writes nothing. The Windows dialog is how the user picks a folder and a name (FR-11). It is not how FR-12 is confirmed.

The section 9.1 row for S-05 can say: checked, Electron 45.0.0, Windows 11, the fallback is Obelisk's own replace prompt.
