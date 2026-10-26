# Obelisk

Obelisk is a Windows document editor for one person on one PC. You write and lay out real pages, with good math, tables, and images, then print them or export to PDF, Word, or Markdown.

Obelisk is being developed for CSC 481 (Software Engineering) at California State University, Dominguez Hills.

**Status:** Milestone 1 is finished, and Milestone 2 (de-risking spikes) is next.

## Working today

This is what Milestone 1 shipped. The [Changelog](CHANGELOG.md) has the detail for each version.

- The window shell has a custom title bar, a menu bar, a tab strip, a page, and a status bar.
- The menu bar has access keys. Alt or F10 focuses it, Alt plus a letter opens a menu, and the arrow keys, Home, and End move through it. File > New and Tools > Settings open a tab. File > Close tab closes an unchanged tab. Submenus open, and every other command is unavailable.
- The tab strip shows an unsaved mark. Ctrl+W, the close button, or File > Close tab closes an unchanged tab, and a changed tab stays open. The keyboard moves between tabs, and extra tabs shrink and scroll.
- The status bar shows word and character counts and the save state for the active tab. An unchanged tab says Saved, and a changed tab says Unsaved changes. The page, the view, and the zoom are placeholders.
- Themes are Light, Dark, and Match Windows, including contrast themes. The choice is `theme` in `settings.json`, read when Obelisk starts.
- F6 and Shift+F6 move between the menu bar, the tabs, the page, and the status bar. The focus ring follows the keyboard.
- Escape returns to the page and restores the caret. An open menu closes one level first.
- A new document is a Letter page, 8.5 by 11 inches, with 1 inch margins and an empty header. Each tab edits paragraphs in Liberation Serif at 12 pt.
- The window stops at 640 by 400, and it stays readable from 100% to 200% display scale.
- The app icon is a bold forward slash on a rounded square.
- CI runs typecheck, lint, tests, and coverage, and a dev MSIX can be sideloaded.

## Key features

These describe the finished app. What runs now is the list above.

- **Tabs:** several documents open at once, one per tab, saved as `.obk` files in any Windows folder.
- **Pages or pageless:** Letter pages with headers, footers, and page numbers, or one continuous page.
- **Blocks:** headings, lists and checklists, quotes, code, tables with cell math, images, formulas, and page breaks, added from a slash menu or Markdown-style shortcuts.
- **Math:** LaTeX formulas, inline or as blocks, drawn offline with KaTeX.
- **Move and copy blocks:** within a document, between tabs, and to other apps.
- **Print and export:** print, or export to PDF, Word (`.docx`), or Markdown.
- **Open from File Explorer:** double-click an `.obk` file to open it, in a new tab if Obelisk is already running.
- **Planned (Should):** date chips, columns, drawing, signature blocks, diagrams, Word equations on export, and crash recovery for never-saved tabs.
- **Local only:** no accounts, no cloud sync, and no network for your files.

## Tech stack

| Area | Choice |
|---|---|
| Platform | Windows 10 (22H2) and 11, x64 |
| Desktop framework | Electron |
| UI | React with TypeScript |
| Editor | A ProseMirror-based editor (chosen at scaffold) |
| Math | KaTeX, with MathML to Word equations through mathml2omml |
| Print and PDF | Electron `print` and `printToPDF` |
| Packaging | Microsoft Store (MSIX) |
| Storage | `.obk` documents (a ZIP, format version 1); preferences in the app's data folder; no database and no server |

Obelisk will be released only through the Microsoft Store.

## Build and run

On Windows, install [Node.js 22.12 or newer](https://nodejs.org/), then from this folder:

```
npm ci
npm start
```

`npm ci` installs the lockfile's exact versions. `npm start` typechecks, builds, and opens one window. The first start downloads the Electron 45.0.0 binary for that PC. The window loads `app://obelisk/index.html`.

## Tests and CI

```
npm run typecheck
npm run lint
npm test
```

`npm test` builds the app, then runs the Node test suite under `tests/unit/` and `tests/integration/`. It checks that a type error fails the TypeScript build, that the built app opens one window, and that the window blocks remote requests, navigation, popups, webviews, and permission requests. It also checks the menu bar, the tab strip, the status bar, themes, the Letter page, F6 and Escape, and the paragraph editor. The same run prints line coverage per module against the 80% target. The target is reported and does not fail the command.

GitHub Actions (`.github/workflows/ci.yml`) runs `npm ci`, `npm run typecheck`, `npm run lint`, and `npm test` on Windows. A pull request runs that job once. A push to main runs it again after the merge. The same job then checks a 1280 by 800 window at 100%, 125%, 150%, 175%, and 200% scale, and the 640 by 400 minimum, in Light and Dark, and uploads the screenshots. A second Windows job builds the dev MSIX, checks Electron fuses, installs and launches the package, and uploads `Obelisk-Dev.msix` and `obelisk-dev.cer`.

## Dev MSIX

On Windows, install the [Windows 10 SDK](https://developer.microsoft.com/windows/downloads/windows-sdk/) (it provides `makeappx.exe`, `makepri.exe`, and `signtool.exe`), then:

```
npm ci
npm run package:msix
npm run check:fuses -- dist/msix/Obelisk-Dev.msix
```

`package:msix` packs an x64 MSIX, signs it with a self-signed dev certificate, and embeds `packaging/icons/obelisk.ico`; trust the certificate once as administrator, then install, launch, and remove the package as a standard user ([Packaging](docs/packaging.md) covers the icon, `resources.pri`, and the certificate).

In an administrator PowerShell, from `dist/msix`:

```powershell
Import-Certificate -FilePath .\obelisk-dev.cer -CertStoreLocation Cert:\LocalMachine\TrustedPeople
```

Then, as a standard user:

```powershell
Add-AppxPackage -Path .\Obelisk-Dev.msix
$pkg = Get-AppxPackage -Name Obelisk.Dev
Start-Process "shell:AppsFolder\$($pkg.PackageFamilyName)!Obelisk"
```

Remove the package with:

```powershell
Get-AppxPackage -Name Obelisk.Dev | Remove-AppxPackage
```

## Settings for now

Until [Settings (#60)](https://github.com/fillicianoplong/obelisk/issues/60) replaces it, the theme is `%APPDATA%\Obelisk\settings.json`. The value is `light`, `dark`, or `system`, and `system` is the default. Edit the file, then start Obelisk again. The dev MSIX path and the file shape are in [Settings for now](docs/packaging.md#settings-for-now).

## Documentation

- [Software Requirements Specification](docs/SRS.md) (version 1.1; also as [Word](docs/Plong_Obelisk_SRS.docx) and [PDF](docs/out/Plong_Obelisk_SRS.pdf))
- [Architecture (design document)](docs/ARCHITECTURE.md) (version 1.1; also as [Word](docs/Plong_Obelisk_Architecture.docx) and [PDF](docs/out/Plong_Obelisk_Architecture.pdf))
- [Diagrams](docs/diagrams/) (PlantUML sources, rendered in [docs/images](docs/images/))
- [Packaging](docs/packaging.md)
- [Changelog](CHANGELOG.md)

## License

© 2026 Filliciano Plong. All rights reserved. This source code is public for viewing only; no license is granted to copy, modify, or distribute it.
