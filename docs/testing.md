# Testing

`npm run typecheck`, `npm run lint`, and `npm test` are the local checks. GitHub Actions runs them on Windows, then takes UI screenshots and builds the dev MSIX. The short form is in the [README](../README.md#tests-and-ci).

## Commands

From this repository:

```
npm run typecheck
npm run lint
npm test
```

- `npm run typecheck` runs `node scripts/typecheck.mjs`. It covers `src` and the Vite config files, and it does not write build output.
- `npm run lint` runs `eslint .`.
- `npm test` runs `node scripts/run-tests.mjs`. It builds the app before any test, and a failed build stops the run. Electron 45 has no postinstall, so the test run installs the Electron binary once if it is missing.
- The Node test suite lives under `tests/unit/` and `tests/integration/`. Every `*.test.mjs` file under `tests/unit/` runs, and so do the atomic-save and hostile-sample integration tests. The Electron launch files are named in `scripts/run-tests.mjs`, and those files launch Electron one at a time.

## What the suite checks

- **Security and window.** The built app opens one window. The window blocks remote requests, navigation, popups, webviews, and permission requests. The window stops at 640 by 400.
- **Menu bar.** The menu bar opens from the keyboard. Access keys open a menu. Arrows, Home, and End move through the items, and a submenu opens and closes from the keyboard.
- **Tabs.** The tab strip shows an unsaved mark. An unchanged tab closes, and a changed tab stays open unless it is discarded. The keyboard moves between tabs. Extra tabs shrink, the strip scrolls when they overflow, and the wheel scrolls that row.
- **Status bar.** The status bar shows the word count, the character count, and the save state.
- **Themes.** Themes are Light, Dark, and Match Windows. Contrast themes keep the page edge, the active tab, the unsaved mark, and the focus ring visible.
- **Page and editor.** A new document is a Letter page, 8.5 by 11 inches, with 1 inch margins, and typed text uses the bundled Liberation Serif. The editor schema is paragraphs of text. Each tab keeps its own text, caret, and undo history. The page sizes come from the shared format 1 limits.
- **Document schema.** Format 1 is one schema. A valid document passes. An unknown field, a wrong type, or an out-of-range value fails, and the view is required. The limits match the File format reference. Encoding writes that schema with yazl. The modified time is fixed, so the same document produces the same bytes, and decoding those bytes returns the same content and view. A newer formatVersion is refused with the update message. Format 1 has no older version; a test-only version walks the conversion list.
- **Open.** File > Open uses a dialog whose only filter is Obelisk document (*.obk). A valid file comes back with a handle, a file name, and the document, and the window opens that in a new tab. The renderer does not receive the path. A file that fails a check opens nothing, the message says why, and the file's bytes and modified time stay the same. A handle main did not issue returns PATH_NOT_ALLOWED, and nothing is read or written.
- **Hostile samples.** `scripts/make-hostile-fixtures.mjs` builds H-01 through H-32 while the tests run. Zip bombs and the file over 200 MB are created then, and they are not stored in the repository. The harness names each sample and the result in architecture section 6.10. A check that is not built yet stays pending and names the issue that will run it. H-01 through H-09 run the archive reader under Node: a bad file is refused, including a missing document.json, and the fixture's bytes stay unchanged. One Electron launch runs the decode path in the utility process for a missing document.json, and that path stops at the archive check. H-10 through H-15 run the same decode path under Node: archive checks, then the strict JSON parser, then the version check and the schema checks. A newer formatVersion is refused with the update message. H-16 through H-19, except a pasted SVG, and H-27 through H-29 run the image checks after the schema on that path. The type comes from the first bytes, the header is capped at 8000 pixels on a side, GIF and WebP frames are counted from the container, and the manifest hash has to match the entry. A pasted SVG stays pending on the paste issue. A sample the format 1 schema already decides, and that this decode path does not own, is checked the same way. H-30's unknown handle calls file:save as a fake renderer. Main returns PATH_NOT_ALLOWED and does not read or write a file. The recovery half of H-30 stays pending on #69.
- **Focus and keyboard.** F6 and Shift+F6 move between the menu bar, the tabs, the page, and the status bar. Escape returns to the page, and an open menu closes one level first. The page focus ring follows the keyboard, and a click in the page does not draw that ring.
- **Saves.** A save writes a `.~obk-<hex>.tmp` file in the same folder and renames it over the target. A locked rename is tried 3 times, 100 ms apart. A write that stalls for 5 seconds leaves the target unchanged. Ending the process during 20 large saves leaves the old file or the complete new one.
- **Project rules.** A type error fails the TypeScript build and names the file. Renderer files do not import Node built-ins or Electron main APIs. `package.json` and the lockfile pin exact versions. IPC calls stay on the listed channels, and an unknown channel, a bad argument, or a call from an unknown frame is refused. App data is the Obelisk folder under the app data directory, and the app does not write that data beside the executable.
- **Dev MSIX.** The dev MSIX unit tests check the manifest, the icon sizes, and `resources.pri`, and that a valid dev certificate is reused. The fuses check fails while `runAsNode` or `nodeCliInspect` is on, and the package step turns those two fuses off.

## Coverage

The same `npm test` run prints line coverage per module against the 80% target. The table lists each measured module under `src/`, then a row for all measured modules, and each row shows the line count, how many lines were covered, the line percent, the 80% target, and whether the module met it.

The 80% column is the NFR-23 line-coverage target for the file format, save, and table math modules. The target is reported and does not fail the command. The command fails if the report lists no modules, and if a test fails the command fails after it prints the report. The report is also written to `coverage/lcov.info`.

## GitHub Actions

The app workflow is [`.github/workflows/ci.yml`](../.github/workflows/ci.yml). Both jobs run on Windows (`windows-latest`) with Node.js 22.23.4. A pull request runs the workflow once. A push to `main` runs it again after the merge.

### Typecheck, lint, test, and coverage

The job checks out the repository and runs `npm ci`, `npm run typecheck`, and `npm run lint`. Electron 45 has no postinstall, so the job installs the Electron binary before the tests, then runs `npm test`. The same job then runs `node tests/visual/scale-window.mjs`. That check opens a 1280 by 800 window at 100%, 125%, 150%, 175%, and 200% scale, and the 640 by 400 minimum, in Light and in Dark. It fails when a region clips or overlaps. The job uploads the screenshots from `tests/visual/output/`, and that upload still runs if the scale check fails.

### Dev MSIX

A second Windows job builds the dev MSIX and stops after 30 minutes. It runs `npm run package:msix` twice. The two runs must print the same certificate thumbprint, and the second run must reuse the dev certificate. The job checks Electron fuses with `npm run check:fuses -- dist/msix/Obelisk-Dev.msix`. It installs the package, launches it, and removes it by running `scripts/smoke-msix.ps1`. The job uploads `Obelisk-Dev.msix` and `obelisk-dev.cer`, and that upload still runs if the job fails.

## Spike workflows

These workflows run each spike's checks. They do not run the app's `npm run typecheck`, `npm run lint`, or `npm test`. A pull request or a push to `main` runs a spike workflow only when one of its paths changes.

Each spike job runs on Windows and on Ubuntu with Node.js 22.23.4. It installs the app, then installs that spike. Electron 45 has no postinstall, so the job installs the Electron binary before the spike runs. It typechecks the spike and runs `npm start` in the spike directory. On Windows the spike starts Electron directly. On Ubuntu, Electron starts under `xvfb-run` because that runner has no display. Each job uploads that spike's `output/` folder.

- [Spike S-04](../.github/workflows/spike-s04.yml) runs the S-04 checks when `spikes/s04/`, that workflow, or the root `package.json` or `package-lock.json` changes.
- [Spike S-06](../.github/workflows/spike-s06.yml) runs the S-06 checks when `spikes/`, that workflow, or the root `package.json` or `package-lock.json` changes.
- [Spike S-08](../.github/workflows/spike-s08.yml) runs the S-08 checks when `spikes/`, that workflow, or the root `package.json` or `package-lock.json` changes.
