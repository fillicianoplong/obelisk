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

`npm ci` installs the lockfile's exact versions. `npm start` typechecks, builds, and opens one window.

```
npm run typecheck
npm run lint
npm test
```

`npm test` builds the app, checks that a type error fails the TypeScript build, and checks that the built app opens one window.

## Documentation

- [Software Requirements Specification](docs/SRS.md) (version 1.1; also as [Word](docs/Plong_Obelisk_SRS.docx) and [PDF](docs/out/Plong_Obelisk_SRS.pdf))
- [Architecture (design document)](docs/ARCHITECTURE.md) (version 1.1; also as [Word](docs/Plong_Obelisk_Architecture.docx) and [PDF](docs/out/Plong_Obelisk_Architecture.pdf))
- [Diagrams](docs/diagrams/) (PlantUML sources, rendered in [docs/images](docs/images/))

## License

© 2026 Filliciano Plong. All rights reserved. This source code is public for viewing only; no license is granted to copy, modify, or distribute it.
