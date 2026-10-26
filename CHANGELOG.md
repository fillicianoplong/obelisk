# Changelog

Notable changes, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the date is the day that version landed on main, in Pacific time.

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
