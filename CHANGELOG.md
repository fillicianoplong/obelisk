# Changelog

Notable changes, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the date is the day that version landed on main, in Pacific time.

## [0.1.19.0] - 2026-10-27

### Added

- A bad .obk is refused before it is read. The check stops a file over 200 MB or 2,000 entries before reading entries, stops an entry at its inflate cap, and refuses unsafe names, encryption, unknown compression, multi-disk archives, names that differ only by case, repeated names, disagreeing headers, folders, links, nested archives, and a missing document.json. The file is left unchanged. ([#137](https://github.com/fillicianoplong/obelisk/pull/137))

## [0.1.18.0] - 2026-10-27

### Added

- A save writes a temp file beside the target and renames it into place, so a crash leaves the old file or the complete new one. A locked rename is tried 3 times, a save that stalls for 5 seconds does not change the file, and leftover temp files older than 10 minutes are removed. ([#134](https://github.com/fillicianoplong/obelisk/pull/134))

## [0.1.17.0] - 2026-10-27

### Added

- Format 1 documents share one schema. A valid document passes. An unknown field, a wrong type, or an out-of-range value fails, and the view, Pages or Pageless, is required. ([#135](https://github.com/fillicianoplong/obelisk/pull/135))

## [0.1.16.3] - 2026-10-26

### Fixed

- Escape back to the page draws the focus ring when the page already had focus, including in a contrast theme. ([#114](https://github.com/fillicianoplong/obelisk/pull/114))
- Escape from the menu bar, the tabs, or the status bar returns to the page, restores the caret and selection, and draws the focus ring. An open menu still closes one level first. ([#114](https://github.com/fillicianoplong/obelisk/pull/114))

## [0.1.16.1] - 2026-10-26

### Added

- The window stops at 640 by 400. At that size the tabs shrink and scroll, the page scrolls sideways from its left edge, and the status bar keeps the counts, the save state, and the zoom. ([#111](https://github.com/fillicianoplong/obelisk/pull/111))
- A scale check captures a 1280 by 800 window at 100%, 125%, 150%, 175%, and 200%, and the minimum size, in Light and Dark. It fails if text or a control is clipped or overlapping, and CI keeps the screenshots. ([#111](https://github.com/fillicianoplong/obelisk/pull/111))
- The token contrast check runs with the tests. Every text and control color pair passes in Light and Dark. ([#111](https://github.com/fillicianoplong/obelisk/pull/111))

### Fixed

- Shrinking the window keeps the active tab on screen. ([#111](https://github.com/fillicianoplong/obelisk/pull/111))
- The mouse wheel scrolls the tab row sideways when the tabs overflow. A sideways swipe does too. ([#111](https://github.com/fillicianoplong/obelisk/pull/111))

## [0.1.15.0] - 2026-10-26

### Added

- A new document opens as a Letter page, 8.5 by 11 inches, with 1 inch margins, centered on the canvas. ([#110](https://github.com/fillicianoplong/obelisk/pull/110))
- An empty header area sits half an inch from the top of the page. ([#110](https://github.com/fillicianoplong/obelisk/pull/110))
- Page text uses Liberation Serif at 12 pt, bundled with the app. ([#110](https://github.com/fillicianoplong/obelisk/pull/110))

### Changed

- A window narrower than the page scrolls the canvas sideways, starting at the page's left edge. The page keeps its width. ([#110](https://github.com/fillicianoplong/obelisk/pull/110))

## [0.1.14.0] - 2026-10-26

### Added

- F6 and Shift+F6 move between the menu bar, the tabs, the page, and the status bar, and then wrap. ([#109](https://github.com/fillicianoplong/obelisk/pull/109))
- Each region keeps the last focused control. Coming back to the page restores the caret and the selection. ([#109](https://github.com/fillicianoplong/obelisk/pull/109))
- Arriving in a region reads its name: Menu bar, Tabs, Document, or Status bar. ([#109](https://github.com/fillicianoplong/obelisk/pull/109))

### Changed

- The focus ring is a 2 px outer line and a 1 px inner line, in Light, Dark, and a contrast theme. It stays even on every side, and inset where a neighbour would clip it. ([#109](https://github.com/fillicianoplong/obelisk/pull/109))

## [0.1.13.2] - 2026-10-26

### Added

- Alt or F10 focuses the menu bar and shows the access keys: File (F), Edit (E), View (V), Insert (I), Format (O), Tools (T), and Help (H). ([#108](https://github.com/fillicianoplong/obelisk/pull/108))
- Alt plus a letter opens that menu. Arrow keys, Home, and End move through it, Right opens a submenu, Enter runs the item, and Esc closes one level. ([#108](https://github.com/fillicianoplong/obelisk/pull/108))
- Shortcuts sit on the right of each item and are part of its name. A disabled item stays in the list and is read as unavailable. ([#108](https://github.com/fillicianoplong/obelisk/pull/108))
- Tools > Settings opens a Settings tab. ([#108](https://github.com/fillicianoplong/obelisk/pull/108))

### Fixed

- Pointer hover shows the hover fill and the accent bar on the item under the pointer. It does not show the focus ring, and the previous item returns to rest (0.1.13.0 added the menus; 0.1.13.1 keeps the ring for the keyboard). ([#108](https://github.com/fillicianoplong/obelisk/pull/108))
- The menu focus ring is an even 2 px on every side. While it shows, the accent bar is hidden so the left edge matches the other sides (0.1.13.0 drew the ring; 0.1.13.1 evened it; 0.1.13.2 hides the accent bar). ([#108](https://github.com/fillicianoplong/obelisk/pull/108))

## [0.1.12.3] - 2026-10-26

### Added

- The status bar shows the page, word and character counts, the view, and the zoom. ([#107](https://github.com/fillicianoplong/obelisk/pull/107))
- Each save state has its own icon and text: Saved, Saving…, Unsaved changes, Not saved, and Autosave paused. ([#107](https://github.com/fillicianoplong/obelisk/pull/107))

### Fixed

- Counts and save state follow the active tab. An unchanged tab says Saved. ([#107](https://github.com/fillicianoplong/obelisk/pull/107))
- The new-tab button is a tab shape, 32 px square, and sits 2 px after the last tab. It stays in view when the tabs scroll (0.1.12.0 added the status bar; 0.1.12.1 placed the button; 0.1.12.2 spaced it; 0.1.12.3 gave it the tab shape). ([#107](https://github.com/fillicianoplong/obelisk/pull/107))
- The close button sits 4 px in from the right edge of the tab. ([#107](https://github.com/fillicianoplong/obelisk/pull/107))
- The tab close button and the new-tab button use matching icons: an 8 px close mark and a 10 px new-tab mark, both with a 2 px stroke (0.1.12.1 matched the icons; 0.1.12.3 sized the new-tab mark). ([#107](https://github.com/fillicianoplong/obelisk/pull/107))
- A pull request runs CI once. A push to main still runs it after the merge. ([#107](https://github.com/fillicianoplong/obelisk/pull/107))

## [0.1.11.1] - 2026-10-25

### Added

- A changed tab shows an unsaved mark and a close button. ([#105](https://github.com/fillicianoplong/obelisk/pull/105))
- The keyboard moves between tabs. ([#105](https://github.com/fillicianoplong/obelisk/pull/105))
- Ctrl+W, the close button, and File > Close tab close an unchanged tab. ([#105](https://github.com/fillicianoplong/obelisk/pull/105))
- A changed tab stays open until the save prompt exists. ([#105](https://github.com/fillicianoplong/obelisk/pull/105))

### Fixed

- The close button uses the same hover and pressed fill on an active tab and an inactive tab, including under a contrast theme (0.1.11.0 added the strip; 0.1.11.1 fixed that fill). ([#105](https://github.com/fillicianoplong/obelisk/pull/105))

## [0.1.10.1] - 2026-10-25

### Added

- Light, Dark, and Match Windows, including contrast themes. ([#103](https://github.com/fillicianoplong/obelisk/pull/103))
- The choice is `theme` in `settings.json`, read at startup. ([#103](https://github.com/fillicianoplong/obelisk/pull/103))

### Fixed

- A click in the page leaves the caret as the indicator, and the focus ring is for the keyboard (0.1.10.0 added theme switching; 0.1.10.1 fixed the focus ring). ([#103](https://github.com/fillicianoplong/obelisk/pull/103))

## [0.1.9.2] - 2026-10-25

### Added

- The window shell uses the Slate tokens for color, type, spacing, and motion. ([#102](https://github.com/fillicianoplong/obelisk/pull/102))
- The window has a custom title bar in the same chrome color. ([#102](https://github.com/fillicianoplong/obelisk/pull/102))

### Changed

- The active tab uses the canvas color. ([#102](https://github.com/fillicianoplong/obelisk/pull/102))

### Fixed

- Launch does not flash white. ([#102](https://github.com/fillicianoplong/obelisk/pull/102))
- The caption buttons follow a Windows theme change (0.1.9.0 applied the tokens, 0.1.9.1 added the title bar, and 0.1.9.2 follows a Windows theme change). ([#102](https://github.com/fillicianoplong/obelisk/pull/102))

## [0.1.8.0] - 2026-10-25

### Added

- The app icon is a bold forward slash on a rounded square. ([#101](https://github.com/fillicianoplong/obelisk/pull/101))
- The same icon is used on a light taskbar and a dark taskbar (0.1.1 through 0.1.7 were earlier passes of this icon). ([#101](https://github.com/fillicianoplong/obelisk/pull/101))

## [0.1.0] - 2026-10-23

### Added

- One window opens. ([#82](https://github.com/fillicianoplong/obelisk/pull/82))
- The window is locked to the app protocol and blocks remote content. ([#83](https://github.com/fillicianoplong/obelisk/pull/83))
- Main and the renderer share a typed IPC bridge. ([#84](https://github.com/fillicianoplong/obelisk/pull/84))
- CI runs typecheck, lint, tests, and coverage, and installs the Electron binary once before launch tests. ([#86](https://github.com/fillicianoplong/obelisk/pull/86), [#87](https://github.com/fillicianoplong/obelisk/pull/87))
- The window shell has menus, tabs, a page, and a status bar. ([#88](https://github.com/fillicianoplong/obelisk/pull/88))
- Each tab has a paragraph editor. ([#89](https://github.com/fillicianoplong/obelisk/pull/89))
- A dev MSIX can be sideloaded. ([#90](https://github.com/fillicianoplong/obelisk/pull/90))
