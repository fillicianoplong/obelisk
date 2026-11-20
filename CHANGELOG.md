# Changelog

Notable changes, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the date is the day that version landed on main, in Pacific time.

## [0.1.37.8] - 2026-11-20

### Fixed

- The smallest-window check reads the document region, which is the part that scrolls. The page area around it stays still. At 640 by 400 the page still scrolls sideways, and scrolling reaches its edges.

## [0.1.37.7] - 2026-11-20

### Fixed

- Highlighted text stays readable in the dark theme. The highlight color is the same in either theme. Text that uses the theme color is drawn dark on a light highlight such as yellow, and an explicit text color stays as it is. The light theme looks the same.
- The page focus ring no longer appears after Open or Save, from the keyboard or the menu, whether or not a dialog was shown. It still appears for F6, Shift+F6, Tab, and Escape when those keys move focus back to the page. Save leaves the caret and selection where they were.
- Tab and Shift+Tab, and Increase indent and Decrease indent, move a paragraph by half an inch each step. A file that already uses a quarter-inch indent still opens the same way. In a code block, Tab inserts a tab at the caret, or at the start of each selected line, and Shift+Tab removes one leading tab or up to four leading spaces. Tabs display four spaces wide, and copy and paste keep the tab characters.

## [0.1.37.6] - 2026-11-20

### Fixed

- The find bubble sits the same distance from the visible scrollbar as it does from the top of the page.

## [0.1.37.5] - 2026-11-20

### Fixed

- A find highlight fills its own line's text. Single spacing touches the next line, wider spacing leaves the extra leading blank, and tighter spacing does not overlap. Underlines and descenders stay covered.
- The find bubble sits the same distance from the scrollbar as it does from the top of the page.

## [0.1.37.4] - 2026-11-20

### Fixed

- Find highlights sit inside the line, so the same word on the next line no longer touches the highlight above it.
- In the light theme, other matches are a light yellow and the current match is a slightly stronger yellow. Both keep dark text. The dark theme is unchanged.
- The space to the left of the find bubble matches the space to the right of it.

## [0.1.37.3] - 2026-11-20

### Fixed

- Find highlights stay inside their own line, so matches on the lines above and below no longer overlap.
- The space around the find bubble is the same on every side, including beside the chevron and the Close button.

## [0.1.37.2] - 2026-11-20

### Fixed

- The find bubble stays at the top right of the page while I scroll the document, and it stays clear of the scrollbar.
- Ctrl+F and Ctrl+H move into the Find field and select its text when the bubble is already open. Ctrl+H also shows Replace.
- Escape in the document closes find and clears the highlights without moving the cursor. An open menu, slash menu, context menu, or dialog takes that Escape instead.
- Matches are easier to see, and the current match is dark text on a stronger yellow.
- The bubble padding is 6px on every side.

## [0.1.37.1] - 2026-11-20

### Changed

- Find and replace floats in a bubble at the top right of the page, just under the tabs. Opening it leaves the page where it is.

### Fixed

- Enter in the Replace field replaces the current match and moves to the next one.
- A focused Find or Replace field shows a thin accent border. Buttons I reach from the keyboard still show the focus ring.
- The buttons sit next to the fields, and the bubble no longer covers the tab strip.

## [0.1.37.0] - 2026-11-20

### Added

- I can find and replace text in one bar with Match case and Whole word. Every match is highlighted with a count like “2 of 5”, and Replace all is one undo step. ([#208](https://github.com/fillicianoplong/obelisk/pull/208))

## [0.1.36.4] - 2026-11-18

### Fixed

- Right-clicking empty sheet space no longer whites out the renderer: gutter opens the block menu only after the context-menu selection is marked as pointer input (so EditorCore does not drop it), menu enabled checks no longer build delete/move transactions during a dry run, and the shell shows a logged error boundary if React still throws while composing the menu.
- Block hover and the handle appear only over a block’s content box (not the sheet margin, gap above a block, or trailing empty space), while the handle stays reachable from the block.

## [0.1.36.3] - 2026-11-18

### Fixed

- Right-click on sheet gutters, padding, and empty page space no longer crashes the renderer when ProseMirror returns a non-text caret position.
- The block context menu closes on an outside pointer or mouse press anywhere in the window.
- After any context menu closes, including outside click then Escape, the caret returns to the block without a keyboard focus ring on the page.

## [0.1.36.2] - 2026-11-17

### Fixed

- Right-clicking empty space below the last block no longer crashes the renderer; the menu targets the nearest block and trailing sheet space highlights that block on hover.
- The slash menu panel shrinks when filtering instead of leaving empty rows.
- The block context menu closes on an outside click, like the slash menu.
- Escape on the block context menu returns the caret to the block without a keyboard focus ring on the page.

## [0.1.36.1] - 2026-11-17

### Fixed

- Context-menu flyouts sit beside the parent menu with a gap and flip left when there is not enough room.
- Block-target vs text-target context menus follow the Context menus reference on every block type, including the block handle, the gutter, and Esc-then-Shift+F10 for block selection.
- The slash menu filters as I type, accepts Enter, Tab, and click, closes on Escape or an outside click, and turns the current line into the chosen block in place (including exact `/command` plus Space or Enter).

## [0.1.36.0] - 2026-11-15

### Added

- Right-click, Shift+F10, and the Menu key open the same context menu on the block or text I point at. Each menu follows the Context menus reference and reuses the menu bar’s command wiring; items without handlers stay visible but disabled. ([#PR](https://github.com/fillicianoplong/obelisk/pull/PR))

## [0.1.35.0] - 2026-11-14

### Added

- The menu bar lists every item from the Menus reference. Items wire to existing commands where those exist; the rest stay visible but disabled until their handlers land. Enabled state follows selection, undo history, and the active tab. ([#160](https://github.com/fillicianoplong/obelisk/pull/160))

## [0.1.34.0] - 2026-11-14

### Added

- Each document tab keeps up to 100 undo and redo steps through Save until I close the tab; a reopened tab starts with an empty history stack. ([#159](https://github.com/fillicianoplong/obelisk/pull/159))

## [0.1.33.0] - 2026-11-12

### Added

- Typed shortcuts from the Keyboard reference turn into the listed blocks and inline marks as I type, and Ctrl+Z right after a shortcut brings the typed characters back. Editor keys from the reference run from the keymap, including Ctrl+Enter for a page break. List Enter and Backspace exit empty items, Shift+Enter adds a soft line break inside text blocks, the hover block handle is a gutter bar with layout-neutral highlights, and neighboring list blocks sit closer together. ([#158](https://github.com/fillicianoplong/obelisk/pull/158))

## [0.1.32.0] - 2026-11-12

### Added

- I can open the slash menu by typing `/` on an empty line. It lists the Slash menu reference items in order, and I can move through them with the arrow keys or close it with Esc, Backspace, or a click outside while the editor keeps focus. ([#157](https://github.com/fillicianoplong/obelisk/pull/157))

## [0.1.31.0] - 2026-11-02

### Added

- I can move selected blocks with Alt+Shift+Up and Alt+Shift+Down or by dragging a block handle, and duplicate them with Ctrl+D. Copies get new block IDs and stay selected; each action is one undo step. ([#156](https://github.com/fillicianoplong/obelisk/pull/156))

## [0.1.30.0] - 2026-10-31

### Added

- A block handle appears beside the block under the pointer or the caret. I can select a block from its handle or with Esc, and Shift+click another handle to select the range between them. ([#152](https://github.com/fillicianoplong/obelisk/pull/152))

## [0.1.29.0] - 2026-10-30

### Added

- Alignment, line spacing, space before and after, and left, first-line, and hanging indents apply to paragraphs, move in quarter-inch steps, and round-trip through save and reopen. Tab at the start of a paragraph's first line sets a half-inch first-line indent; Tab elsewhere and Format > Increase indent step the left indent. Enter keeps paragraph format and active character marks on the new line. ([#149](https://github.com/fillicianoplong/obelisk/pull/149))

### Fixed

- Text color and highlight display again under the app's content security policy: dynamic color rules match lowercase `data-*` values on marked spans.
- Enter no longer drops formatting: the paragraph keymap runs before the default split block handler.
- Double-clicking an `.obk` file or choosing Open with Obelisk opens that file in a tab, including when Obelisk is already running.
- Font sizes and other non-color character formatting from 0.1.28.0 continue to use data attributes and generated CSS under the same policy.

## [0.1.28.0] - 2026-10-30

### Added

- Bold, italic, underline, strikethrough, superscript, subscript, inline code, text color, highlight, font, and font size apply to selected text, clear with Clear formatting, and round-trip through save and reopen. Word and character counts include every text block.

## [0.1.27.0] - 2026-10-30

### Added

- Every text block in the Block types reference can be inserted in a tab, edited, saved, and reopened with block order and IDs preserved. Paragraph, heading, bulleted list, numbered list, checklist, quote, code block, horizontal line, and page break are included. ([#147](https://github.com/fillicianoplong/obelisk/pull/147))

## [0.1.26.0] - 2026-10-30

### Added

- A saved document autosaves within 30 seconds of the last edit. A never-saved tab writes nothing until you save it. When another program changes the file, autosave skips the write and shows the same Overwrite, Save as…, or Cancel choice as Save. After Cancel, the status bar shows Autosave paused until the next successful save. ([#144](https://github.com/fillicianoplong/obelisk/pull/144))

## [0.1.25.0] - 2026-10-30

### Added

- A changed tab shows an unsaved dot and an accessible name that ends with Unsaved changes. Ctrl+W, the close button, and File > Close tab ask to save, discard, or cancel before a changed tab closes. File > Exit and closing the window ask the same way. Cancel leaves every tab as it was. Save on a never-saved tab opens Save as; canceling that dialog leaves the tab open. ([#143](https://github.com/fillicianoplong/obelisk/pull/143))

## [0.1.24.1] - 2026-10-28

### Fixed

- Saving in the installed app failed because the package did not include the zip libraries. The package now includes yauzl, yazl, and their dependencies. The installed app opens a valid file, saves, and reopens the same text. ([#142](https://github.com/fillicianoplong/obelisk/pull/142))

## [0.1.24.0] - 2026-10-28

### Added

- File > Save writes the open document. The first Save, and File > Save as, ask for a folder and a name. Save as leaves the previous file unchanged. If the file changed on disk, Save asks before it writes. A save that does not finish within 5 seconds shows an error and the tab stays changed. ([#142](https://github.com/fillicianoplong/obelisk/pull/142))

## [0.1.23.0] - 2026-10-28

### Added

- File > Open lists only .obk files. A valid file opens in a new tab. A file that fails a check opens nothing, shows why, and stays unchanged. A handle main did not issue returns PATH_NOT_ALLOWED and touches nothing. ([#141](https://github.com/fillicianoplong/obelisk/pull/141))

## [0.1.22.0] - 2026-10-28

### Added

- An .obk file is written with yazl and a fixed modified time, so the same document encodes to the same bytes. A newer formatVersion is refused and the message says to update from the Microsoft Store. Format 1 has no older version to convert. ([#140](https://github.com/fillicianoplong/obelisk/pull/140))

## [0.1.21.0] - 2026-10-28

### Added

- Images are checked after the schema, before any pixel is decoded. A type that does not match the first bytes, a header over 8000 by 8000, an SVG, a GIF over 1,000 frames, a WebP over 250 million pixels, a frame outside the image, and an entry missing from the manifest or with the wrong hash are refused. The file is left unchanged. ([#139](https://github.com/fillicianoplong/obelisk/pull/139))

## [0.1.20.0] - 2026-10-28

### Added

- document.json is checked after the archive checks. Duplicate keys, NaN, Infinity, and unpaired surrogates are refused, and so are an unknown field, a wrong type, a value out of range, a repeated block id, more than 20,000 blocks, a table over 200 by 26, and columns inside columns. The file is left unchanged. ([#138](https://github.com/fillicianoplong/obelisk/pull/138))

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
