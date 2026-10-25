# Obelisk

Obelisk is a Windows document editor for one person on one PC. You write and lay out real pages, with good math, tables, and images, then print them or export to PDF, Word, or Markdown.

Obelisk is being developed for CSC 481 (Software Engineering) at California State University, Dominguez Hills.

**Status:** In design. Requirements and architecture version 1.1 (October 23, 2026); implementation starting.

## Key features

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

```
npm run typecheck
npm run lint
npm test
```

`npm test` builds the app, then runs the Node test suite under `tests/unit/` and `tests/integration/`. It checks that a type error fails the TypeScript build, that the built app opens one window, and that the window blocks remote requests, navigation, popups, webviews, and permission requests. The same run prints line coverage per module against the 80% target. The target is reported and does not fail the command.

GitHub Actions (`.github/workflows/ci.yml`) runs `npm ci`, `npm run typecheck`, `npm run lint`, and `npm test` on Windows for every push and pull request. A second Windows job builds the dev MSIX, checks Electron fuses, installs and launches the package, and uploads `Obelisk-Dev.msix` and `obelisk-dev.cer`.

## Dev MSIX

On Windows, install the [Windows 10 SDK](https://developer.microsoft.com/windows/downloads/windows-sdk/) (it provides `makeappx.exe`, `makepri.exe`, and `signtool.exe`), then:

```
npm ci
npm run package:msix
npm run check:fuses -- dist/msix/Obelisk-Dev.msix
```

`package:msix` builds the app, packs an x64 MSIX, and signs it with a self-signed dev certificate. It embeds `packaging/icons/obelisk.ico` in `Obelisk.exe`. The icon is a bold forward slash on a rounded square. The corners outside the tile are transparent, and the tile itself fills the icon box on the taskbar, the window icon, and `Square44x44Logo`. The tile is `#3B4654` and the slash is `#E6EAF0`, the same on a light taskbar and a dark taskbar. Before packing, it runs `makepri` on the package layout root so `resources.pri` names the logos `Files/assets/...`, which is what the manifest paths ask for. Indexing from the assets folder drops that prefix and Windows falls back to the loose file. `priconfig.xml` is not in the package. The running and pinned taskbar buttons use that index, not the window icon. The index has no plated `Square44x44Logo.targetsize-*` image, because Windows was choosing that tile for the taskbar. It does have `targetsize-*_altform-unplated` and `targetsize-*_altform-lightunplated` at the sizes Windows asks for. Those two files are the same tile, so the taskbar picture does not change with Windows mode. `Square44x44Logo.png` and its scale-200 copy are that same tile. `BackgroundColor` is `transparent`. The window uses `obelisk.ico` once, the same tile. That file holds frames at 16, 20, 24, 32, 40, 48, 64, and 256, each drawn at that size. Sizes below 256 are plain BMP; only 256 is PNG. The window is given the `.ico` path, so at 100% the title bar uses the 16 px frame (20 at 125%, 24 at 150%). The package version in `package.json` is what the MSIX identity uses (0.1.8.0). Raise it when the icons change so Windows does not keep the previous install's cached icons. It reuses the `CN=Obelisk Dev` certificate in `Cert:\CurrentUser\My` while that certificate is still valid, and creates one only when none is there or it has expired. Each run overwrites `dist/msix/Obelisk-Dev.msix` and `dist/msix/obelisk-dev.cer`. The private key stays in the current-user store and is not written to the repository. The package contains `package.json` and the built `dist` files. Source maps stay out of the package. Trust the public certificate again only after a new one is created.

Trusting the dev certificate takes one administrator step on the machine. Install and launch then run as a standard user. Store builds are signed by Microsoft, so that administrator step is only for this dev certificate.

In an administrator PowerShell:

```powershell
Import-Certificate -FilePath .\obelisk-dev.cer -CertStoreLocation Cert:\LocalMachine\TrustedPeople
```

Then, as a standard user:

```powershell
Add-AppxPackage -Path .\Obelisk-Dev.msix
$pkg = Get-AppxPackage -Name Obelisk.Dev
Start-Process "shell:AppsFolder\$($pkg.PackageFamilyName)!Obelisk"
```

The Start-menu app id is `Obelisk`. The package is per user. Check the install folder (the `InstallLocation` from `Get-AppxPackage -Name Obelisk.Dev`) and confirm the app did not add or change files there. App data is under `%APPDATA%\Obelisk`, which MSIX may redirect to `%LOCALAPPDATA%\Packages\<package family>\LocalCache\Roaming\Obelisk`. Remove the package with:

```powershell
Get-AppxPackage -Name Obelisk.Dev | Remove-AppxPackage
```

## Documentation

- [Software Requirements Specification](docs/SRS.md) (version 1.1; also as [Word](docs/Plong_Obelisk_SRS.docx) and [PDF](docs/out/Plong_Obelisk_SRS.pdf))
- [Architecture (design document)](docs/ARCHITECTURE.md) (version 1.1; also as [Word](docs/Plong_Obelisk_Architecture.docx) and [PDF](docs/out/Plong_Obelisk_Architecture.pdf))
- [Diagrams](docs/diagrams/) (PlantUML sources, rendered in [docs/images](docs/images/))

## License

© 2026 Filliciano Plong. All rights reserved. This source code is public for viewing only; no license is granted to copy, modify, or distribute it.
