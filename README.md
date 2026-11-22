# Obelisk

Obelisk is a Windows document editor for one person on one PC. You write and lay out real pages, with good math, tables, and images, then print them or export to PDF, Word, or Markdown.

Obelisk is being developed for CSC 481 (Software Engineering) at California State University, Dominguez Hills.

**Status:** Milestones 1 to 3 are finished, and Milestone 4 (editing core) is in progress.

## Working today

The [Changelog](CHANGELOG.md) has the detail for each version.

- **Files:** open, save, and save as `.obk` files in tabs, with autosave for saved tabs and a prompt before anything is overwritten or closed unsaved.
- **Writing:** text blocks (headings, lists, checklists, quotes, code, page breaks) from the slash menu or Markdown-style shortcuts, with character and paragraph formatting.
- **Blocks:** select, move, drag, and duplicate blocks, with up to 100 undo steps per tab.
- **Tools:** find and replace, spell check with suggestions, and right-click menus.
- **Window:** a menu bar with access keys, a tab strip, a status bar with counts and save state, and Light, Dark, or Match Windows themes.
- **Keyboard:** F6 moves between areas, and Escape returns to the page.

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

`npm test` builds the app and runs the unit and integration tests, then prints line coverage against the 80% target.

GitHub Actions runs these checks on Windows for every pull request and every push to main. It also takes UI screenshots and builds the dev MSIX. [Testing](docs/testing.md) has the full list of what's checked.

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

- [Software Requirements Specification](docs/SRS.md) (version 1.3; also as [Word](docs/Plong_Obelisk_SRS.docx) and [PDF](docs/out/Plong_Obelisk_SRS.pdf))
- [Architecture (design document)](docs/ARCHITECTURE.md) (version 1.3; also as [Word](docs/Plong_Obelisk_Architecture.docx) and [PDF](docs/out/Plong_Obelisk_Architecture.pdf))
- [Implementation Plan](docs/IMPLEMENTATION_PLAN.md) (version 1.0; also as [Word](docs/Plong_Obelisk_Implementation_Plan.docx) and [PDF](docs/out/Plong_Obelisk_Implementation_Plan.pdf))
- [Diagrams](docs/diagrams/) (PlantUML sources, rendered in [docs/images](docs/images/))
- [Packaging](docs/packaging.md)
- [Testing](docs/testing.md)
- [Changelog](CHANGELOG.md)

## License

© 2026 Filliciano Plong. All rights reserved. This source code is public for viewing only; no license is granted to copy, modify, or distribute it.
