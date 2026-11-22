# Obelisk: Implementation Plan

Milestones, work items, and how work is tracked in Jira  
Prepared by Filliciano Plong  
October 23, 2026  
Version 1.0  

## Contents

- [Revision history](#revision-history)
- [1. Inputs and how to read this plan](#1-inputs-and-how-to-read-this-plan)
- [2. Versioning scheme](#2-versioning-scheme)
- [3. Milestones](#3-milestones)
- [4. Work items](#4-work-items)
- [5. Traceability](#5-traceability)
- [6. Definition of done](#6-definition-of-done)
- [7. Risks](#7-risks)
- [8. Tracker setup](#8-tracker-setup)
- [9. Decisions](#9-decisions)
- [10. Files](#10-files)

## Revision history

| Version | Date | Changes |
|---|---|---|
| 1.0 | October 23, 2026 | First version. |

## 1. Inputs and how to read this plan

**Readers:** Filliciano Plong, developer and tester of Obelisk. **Status:** first version. This plan is written before implementation begins.

| Input | Version or state |
|---|---|
| `docs/SRS.md` | 1.0, October 23, 2026. |
| `docs/ARCHITECTURE.md` | 1.0, October 23, 2026: ADR-001 to ADR-009, risks R-01 to R-07, spikes S-01 to S-05. |
| Tracker | Jira project OBL. Milestones map to epics OBL-1 to OBL-10. Each work item maps to the story or task key shown in section 4. |
| How changes land | Direct commits on main, one commit per change, with an app version bump and a CHANGELOG entry. |
| Repository | fillicianoplong/obelisk. |

Items are numbered W-01 and up in Jira key order within each milestone, from M1 to M10. Each item is one Jira story or task. Priority follows the SRS: Must is high, Should is medium, Could is low. A spike or chore takes the priority of the work it unblocks.

M1 produces a runnable skeleton. Every Must item is planned to be done by the end of M8. M10 Release is dated December 13–15, 2026, before M9 Should features (December 17–31) and before the CSC 481 demo on December 16, 2026, so the demo can use a release build.

Each item lists its acceptance as short Given / When / Then lines and the tests that prove it. Those lines become the checklist on the Jira story when that work starts.

## 2. Versioning scheme

App versions start at 0.1.0 on the first implementation commit. Each change that lands on main bumps the app version and adds a CHANGELOG entry. The pattern is 0.1.x.y: a new feature or distinct slice of work raises the third number, and a fix or small follow-up on the same slice raises the fourth. 1.0.0 is reserved for the release milestone (M10). This document's version is 1.0, the plan itself, and is numbered separately from the app.

## 3. Milestones

Milestones M1 to M10 map one-to-one to epics OBL-1 to OBL-10. Dates are the planned start and due dates.

| Milestone | Planned dates | Goal | Items | High / Med / Low |
|---|---|---|---|---|
| **M1 Runnable skeleton** (OBL-1) | October 23, 2026 – October 26, 2026 | A pinned Electron app that opens one window, with a secure baseline, typed IPC, tests, CI, and a dev MSIX build. | 18 | 14 / 4 / 0 |
| **M2 De-risking spikes** (OBL-2) | October 26, 2026 – October 27, 2026 | Run spikes S-01 to S-05 and record the results in the SRS and architecture. | 6 | 4 / 2 / 0 |
| **M3 Safe files** (OBL-3) | October 27, 2026 – October 30, 2026 | Open and save .obk files safely, with a hostile-sample codec, atomic writes, tab close prompts, and autosave. | 11 | 11 / 0 / 0 |
| **M4 Editing core** (OBL-4) | October 30, 2026 – November 22, 2026 | Core writing tools: blocks, formatting, handles, menus, find, spell check, clipboard, and links. | 17 | 17 / 0 / 0 |
| **M5 Pages and layout** (OBL-5) | November 23, 2026 – November 29, 2026 | Letter pages, pageless view, page setup, headers and footers, and the MLA template. | 5 | 5 / 0 / 0 |
| **M6 Tables, images, formulas** (OBL-6) | November 30, 2026 – December 5, 2026 | Table blocks with TableMath, images, and equation blocks. | 5 | 5 / 0 / 0 |
| **M7 Print and export** (OBL-7) | December 6, 2026 – December 9, 2026 | Print plus export to PDF, Word, and Markdown through one export service. | 5 | 5 / 0 / 0 |
| **M8 Must complete** (OBL-8) | December 10, 2026 – December 12, 2026 | Settings, restore tabs, accessibility and performance passes, About and fonts, security verification, and a Store test build. | 8 | 8 / 0 / 0 |
| **M9 Should features** (OBL-9) | December 17, 2026 – December 31, 2026 | Should-priority features after the CSC 481 demo on December 16, 2026. | 14 | 0 / 13 / 1 |
| **M10 Release** (OBL-10) | December 13, 2026 – December 15, 2026 | Store certification and the public release, before the December 16 demo. | 1 | 1 / 0 / 0 |

**Totals:** 90 work items: 70 high, 19 medium, 1 low. Work has not started. M10 is planned to finish before M9 so the December 16, 2026 demo can use a release build.

**Exit criteria** for each milestone are in the work-item section below.

## 4. Work items

Each table is one milestone. **Covers** lists FR and NFR IDs. A requirement marked **(inferred)** is matched from the SRS by the item title. Acceptance is short Given / When / Then language; the full checklist lives on the Jira item.

### M1 Runnable skeleton (OBL-1)

**Goal:** A pinned Electron app that opens one window, with a secure baseline, typed IPC, tests, CI, and a dev MSIX build.

**Exit criteria:** The app launches from a clean clone, CI is green, and a dev MSIX package installs.

**Planned dates:** October 23, 2026 to October 26, 2026.

| ID | Title (Jira) | Priority / type | Covers | Acceptance | Depends on |
|---|---|---|---|---|---|
| **W-01** | Scaffold Electron app ([`OBL-11`](https://fillicianoplong.atlassian.net/browse/OBL-11)) | high / chore | NFR-25 | Given the app is built from main, when the behavior in OBL-11 (Scaffold Electron app) is used, then each acceptance step recorded on that item holds.<br>Tests: CI typecheck, lint, and tests, plus any item-specific tests named on the item. | None |
| **W-02** | Secure window baseline ([`OBL-12`](https://fillicianoplong.atlassian.net/browse/OBL-12)) | high / chore | NFR-05, NFR-06 | Given the app is built from main, when the behavior in OBL-12 (Secure window baseline) is used, then each acceptance step recorded on that item holds.<br>Tests: CI typecheck, lint, and tests, plus any item-specific tests named on the item. | None |
| **W-03** | Typed IPC bridge ([`OBL-13`](https://fillicianoplong.atlassian.net/browse/OBL-13)) | high / chore | NFR-22, NFR-21 | Given the app is built from main, when the behavior in OBL-13 (Typed IPC bridge) is used, then each acceptance step recorded on that item holds.<br>Tests: CI typecheck, lint, and tests, plus any item-specific tests named on the item. | None |
| **W-04** | Test runner and CI ([`OBL-14`](https://fillicianoplong.atlassian.net/browse/OBL-14)) | high / chore | NFR-21, NFR-22, NFR-23 | Given the app is built from main, when the behavior in OBL-14 (Test runner and CI) is used, then each acceptance step recorded on that item holds.<br>Tests: CI typecheck, lint, and tests, plus any item-specific tests named on the item. | None |
| **W-05** | Window shell regions ([`OBL-15`](https://fillicianoplong.atlassian.net/browse/OBL-15)) | high / feature | FR-01, FR-07, NFR-01 | Given the app is built from main, when the behavior in OBL-15 (Window shell regions) is used, then each acceptance step recorded on that item holds.<br>Tests: CI typecheck, lint, and tests, plus any item-specific tests named on the item. | None |
| **W-06** | Minimal editor in a tab ([`OBL-16`](https://fillicianoplong.atlassian.net/browse/OBL-16)) | high / feature | FR-32 | Given the app is built from main, when the behavior in OBL-16 (Minimal editor in a tab) is used, then each acceptance step recorded on that item holds.<br>Tests: CI typecheck, lint, and tests, plus any item-specific tests named on the item. | None |
| **W-07** | Dev MSIX build ([`OBL-17`](https://fillicianoplong.atlassian.net/browse/OBL-17)) | high / chore | NFR-24, NFR-26, NFR-06 | Given the app is built from main, when the behavior in OBL-17 (Dev MSIX build) is used, then each acceptance step recorded on that item holds.<br>Tests: CI typecheck, lint, and tests, plus any item-specific tests named on the item. | None |
| **W-09** | App icon set ([`OBL-93`](https://fillicianoplong.atlassian.net/browse/OBL-93)) | medium / chore | — | Given the app is built from main, when the behavior in OBL-93 (App icon set) is used, then each acceptance step recorded on that item holds.<br>Tests: CI typecheck, lint, and tests, plus any item-specific tests named on the item. | None |
| **W-10** | Apply design tokens to the window shell ([`OBL-94`](https://fillicianoplong.atlassian.net/browse/OBL-94)) | medium / feature | NFR-17, NFR-19 | Given the app is built from main, when the behavior in OBL-94 (Apply design tokens to the window shell) is used, then each acceptance step recorded on that item holds.<br>Tests: CI typecheck, lint, and tests, plus any item-specific tests named on the item. | None |
| **W-11** | UI foundation ([`OBL-95`](https://fillicianoplong.atlassian.net/browse/OBL-95)) | medium / feature | FR-01 (inferred) | Given the app is built from main, when the behavior in OBL-95 (UI foundation) is used, then each acceptance step recorded on that item holds.<br>Tests: CI typecheck, lint, and tests, plus any item-specific tests named on the item. | None |
| **W-12** | Theme switching: Light, Dark, Match Windows, and contrast themes ([`OBL-96`](https://fillicianoplong.atlassian.net/browse/OBL-96)) | high / feature | FR-05, NFR-17, NFR-20 | Given the app is built from main, when the behavior in OBL-96 (Theme switching: Light, Dark, Match Windows, and contrast themes) is used, then each acceptance step recorded on that item holds.<br>Tests: CI typecheck, lint, and tests, plus any item-specific tests named on the item. | None |
| **W-13** | Tab strip: unsaved mark, close button, Ctrl+W, Ctrl+Tab ([`OBL-97`](https://fillicianoplong.atlassian.net/browse/OBL-97)) | high / feature | FR-01, FR-03, NFR-15, NFR-16, NFR-19 | Given the app is built from main, when the behavior in OBL-97 (Tab strip: unsaved mark, close button, Ctrl+W, Ctrl+Tab) is used, then each acceptance step recorded on that item holds.<br>Tests: CI typecheck, lint, and tests, plus any item-specific tests named on the item. | None |
| **W-14** | Live status bar: counts and save state ([`OBL-98`](https://fillicianoplong.atlassian.net/browse/OBL-98)) | high / feature | FR-04, NFR-16, NFR-19 | Given the app is built from main, when the behavior in OBL-98 (Live status bar: counts and save state) is used, then each acceptance step recorded on that item holds.<br>Tests: CI typecheck, lint, and tests, plus any item-specific tests named on the item. | None |
| **W-15** | Menu bar access keys and keyboard navigation ([`OBL-99`](https://fillicianoplong.atlassian.net/browse/OBL-99)) | high / feature | FR-02, NFR-15, NFR-16 | Given the app is built from main, when the behavior in OBL-99 (Menu bar access keys and keyboard navigation) is used, then each acceptance step recorded on that item holds.<br>Tests: CI typecheck, lint, and tests, plus any item-specific tests named on the item. | None |
| **W-16** | F6 region cycling and focus ring ([`OBL-100`](https://fillicianoplong.atlassian.net/browse/OBL-100)) | high / feature | NFR-15, NFR-16 | Given the app is built from main, when the behavior in OBL-100 (F6 region cycling and focus ring) is used, then each acceptance step recorded on that item holds.<br>Tests: CI typecheck, lint, and tests, plus any item-specific tests named on the item. | None |
| **W-17** | Letter page sheet with 1 in margins and header area ([`OBL-101`](https://fillicianoplong.atlassian.net/browse/OBL-101)) | high / feature | FR-22, FR-25 | Given the app is built from main, when the behavior in OBL-101 (Letter page sheet with 1 in margins and header area) is used, then each acceptance step recorded on that item holds.<br>Tests: CI typecheck, lint, and tests, plus any item-specific tests named on the item. | None |
| **W-18** | Scaling and smallest-window check ([`OBL-102`](https://fillicianoplong.atlassian.net/browse/OBL-102)) | high / chore | NFR-18, NFR-17 | Given the app is built from main, when the behavior in OBL-102 (Scaling and smallest-window check) is used, then each acceptance step recorded on that item holds.<br>Tests: CI typecheck, lint, and tests, plus any item-specific tests named on the item. | None |
| **W-19** | Tidy the README and add a changelog ([`OBL-103`](https://fillicianoplong.atlassian.net/browse/OBL-103)) | medium / docs | — | Given the documented change in OBL-103 is in the repository, when a reader opens the named file, then the new text is present and the old wording is gone.<br>Tests: the document is reviewed in the same commit. | None |

### M2 De-risking spikes (OBL-2)

**Goal:** Run spikes S-01 to S-05 and record the results in the SRS and architecture.

**Exit criteria:** Each spike has a recorded result, and the SRS and architecture include those results.

**Planned dates:** October 26, 2026 to October 27, 2026.

| ID | Title (Jira) | Priority / type | Covers | Acceptance | Depends on |
|---|---|---|---|---|---|
| **W-21** | Spike S-01: MSIX save and rename ([`OBL-18`](https://fillicianoplong.atlassian.net/browse/OBL-18)) | high / spike | NFR-10, NFR-12 | Given the spike is run on the recorded Windows and Electron versions, when the checks in OBL-18 finish, then the result is written into the SRS or architecture.<br>Tests: the recorded result, plus any fixture the spike adds. | None |
| **W-22** | Spike S-02: Second-instance activation ([`OBL-19`](https://fillicianoplong.atlassian.net/browse/OBL-19)) | medium / spike | FR-18 | Given the spike is run on the recorded Windows and Electron versions, when the checks in OBL-19 finish, then the result is written into the SRS or architecture.<br>Tests: the recorded result, plus any fixture the spike adds. | None |
| **W-23** | Spike S-03: mathml2omml in Word ([`OBL-20`](https://fillicianoplong.atlassian.net/browse/OBL-20)) | medium / spike | FR-57 | Given the spike is run on the recorded Windows and Electron versions, when the checks in OBL-20 finish, then the result is written into the SRS or architecture.<br>Tests: the recorded result, plus any fixture the spike adds. | None |
| **W-24** | Spike S-04: Mermaid strict and CSP ([`OBL-21`](https://fillicianoplong.atlassian.net/browse/OBL-21)) | high / spike | FR-53, FR-82, NFR-06 | Given the spike is run on the recorded Windows and Electron versions, when the checks in OBL-21 finish, then the result is written into the SRS or architecture.<br>Tests: the recorded result, plus any fixture the spike adds. | None |
| **W-25** | Spike S-05: Save dialog replace prompt ([`OBL-22`](https://fillicianoplong.atlassian.net/browse/OBL-22)) | high / spike | FR-12 | Given the spike is run on the recorded Windows and Electron versions, when the checks in OBL-22 finish, then the result is written into the SRS or architecture.<br>Tests: the recorded result, plus any fixture the spike adds. | None |
| **W-29** | Record spike results ([`OBL-26`](https://fillicianoplong.atlassian.net/browse/OBL-26)) | high / chore | NFR-07 | Given the app is built from main, when the behavior in OBL-26 (Record spike results) is used, then each acceptance step recorded on that item holds.<br>Tests: CI typecheck, lint, and tests, plus any item-specific tests named on the item. | OBL-18 to OBL-22 |

### M3 Safe files (OBL-3)

**Goal:** Open and save .obk files safely, with a hostile-sample codec, atomic writes, tab close prompts, and autosave.

**Exit criteria:** A document can be opened, saved, and autosaved, and hostile fixtures are rejected.

**Planned dates:** October 27, 2026 to October 30, 2026.

| ID | Title (Jira) | Priority / type | Covers | Acceptance | Depends on |
|---|---|---|---|---|---|
| **W-34** | Document schema (format 1) ([`OBL-27`](https://fillicianoplong.atlassian.net/browse/OBL-27)) | high / feature | NFR-07, FR-17, NFR-21 | Given the app is built from main, when the behavior in OBL-27 (Document schema (format 1)) is used, then each acceptance step recorded on that item holds.<br>Tests: CI typecheck, lint, and tests, plus any item-specific tests named on the item. | None |
| **W-35** | Hostile sample fixtures ([`OBL-28`](https://fillicianoplong.atlassian.net/browse/OBL-28)) | high / chore | FR-09, NFR-07 | Given the app is built from main, when the behavior in OBL-28 (Hostile sample fixtures) is used, then each acceptance step recorded on that item holds.<br>Tests: CI typecheck, lint, and tests, plus any item-specific tests named on the item. | None |
| **W-36** | Codec: archive checks ([`OBL-29`](https://fillicianoplong.atlassian.net/browse/OBL-29)) | high / chore | FR-09, NFR-07 | Given the app is built from main, when the behavior in OBL-29 (Codec: archive checks) is used, then each acceptance step recorded on that item holds.<br>Tests: CI typecheck, lint, and tests, plus any item-specific tests named on the item. | OBL-28 |
| **W-37** | Codec: JSON and schema checks ([`OBL-30`](https://fillicianoplong.atlassian.net/browse/OBL-30)) | high / chore | FR-09, NFR-07 | Given the app is built from main, when the behavior in OBL-30 (Codec: JSON and schema checks) is used, then each acceptance step recorded on that item holds.<br>Tests: CI typecheck, lint, and tests, plus any item-specific tests named on the item. | OBL-29 |
| **W-38** | Codec: image entry checks ([`OBL-31`](https://fillicianoplong.atlassian.net/browse/OBL-31)) | high / chore | FR-09, NFR-07, FR-49 | Given the app is built from main, when the behavior in OBL-31 (Codec: image entry checks) is used, then each acceptance step recorded on that item holds.<br>Tests: CI typecheck, lint, and tests, plus any item-specific tests named on the item. | OBL-30 |
| **W-39** | Codec: encode and versions ([`OBL-32`](https://fillicianoplong.atlassian.net/browse/OBL-32)) | high / feature | FR-10, FR-17, FR-09 | Given the app is built from main, when the behavior in OBL-32 (Codec: encode and versions) is used, then each acceptance step recorded on that item holds.<br>Tests: CI typecheck, lint, and tests, plus any item-specific tests named on the item. | OBL-27 |
| **W-40** | Atomic write helper ([`OBL-33`](https://fillicianoplong.atlassian.net/browse/OBL-33)) | high / feature | NFR-10, NFR-11, NFR-12, NFR-14 | Given the app is built from main, when the behavior in OBL-33 (Atomic write helper) is used, then each acceptance step recorded on that item holds.<br>Tests: CI typecheck, lint, and tests, plus any item-specific tests named on the item. | None |
| **W-41** | Open file and handles ([`OBL-34`](https://fillicianoplong.atlassian.net/browse/OBL-34)) | high / feature | FR-08, FR-09, NFR-22 | Given the app is built from main, when the behavior in OBL-34 (Open file and handles) is used, then each acceptance step recorded on that item holds.<br>Tests: CI typecheck, lint, and tests, plus any item-specific tests named on the item. | OBL-32 |
| **W-42** | Save and Save as ([`OBL-35`](https://fillicianoplong.atlassian.net/browse/OBL-35)) | high / feature | FR-10, FR-11, FR-12, FR-13, NFR-11, NFR-12 | Given the app is built from main, when the behavior in OBL-35 (Save and Save as) is used, then each acceptance step recorded on that item holds.<br>Tests: CI typecheck, lint, and tests, plus any item-specific tests named on the item. | OBL-33 |
| **W-43** | Tab state and close prompts ([`OBL-36`](https://fillicianoplong.atlassian.net/browse/OBL-36)) | high / feature | FR-03, FR-16, NFR-19 | Given the app is built from main, when the behavior in OBL-36 (Tab state and close prompts) is used, then each acceptance step recorded on that item holds.<br>Tests: CI typecheck, lint, and tests, plus any item-specific tests named on the item. | OBL-34, OBL-35 |
| **W-44** | Autosave ([`OBL-37`](https://fillicianoplong.atlassian.net/browse/OBL-37)) | high / feature | FR-14, FR-15, NFR-13, FR-04 | Given the app is built from main, when the behavior in OBL-37 (Autosave) is used, then each acceptance step recorded on that item holds.<br>Tests: CI typecheck, lint, and tests, plus any item-specific tests named on the item. | OBL-35 |

### M4 Editing core (OBL-4)

**Goal:** Core writing tools: blocks, formatting, handles, menus, find, spell check, clipboard, and links.

**Exit criteria:** The Must editing stories in this milestone are complete.

**Planned dates:** October 30, 2026 to November 22, 2026.

| ID | Title (Jira) | Priority / type | Covers | Acceptance | Depends on |
|---|---|---|---|---|---|
| **W-46** | Text block types ([`OBL-38`](https://fillicianoplong.atlassian.net/browse/OBL-38)) | high / feature | FR-32 | Given the app is built from main, when the behavior in OBL-38 (Text block types) is used, then each acceptance step recorded on that item holds.<br>Tests: CI typecheck, lint, and tests, plus any item-specific tests named on the item. | None |
| **W-47** | Character formatting ([`OBL-39`](https://fillicianoplong.atlassian.net/browse/OBL-39)) | high / feature | FR-28 | Given the app is built from main, when the behavior in OBL-39 (Character formatting) is used, then each acceptance step recorded on that item holds.<br>Tests: CI typecheck, lint, and tests, plus any item-specific tests named on the item. | None |
| **W-48** | Paragraph format and indents ([`OBL-40`](https://fillicianoplong.atlassian.net/browse/OBL-40)) | high / feature | FR-29, FR-30 | Given the app is built from main, when the behavior in OBL-40 (Paragraph format and indents) is used, then each acceptance step recorded on that item holds.<br>Tests: CI typecheck, lint, and tests, plus any item-specific tests named on the item. | None |
| **W-49** | Block handle and selection ([`OBL-41`](https://fillicianoplong.atlassian.net/browse/OBL-41)) | high / feature | FR-33, FR-38 | Given the app is built from main, when the behavior in OBL-41 (Block handle and selection) is used, then each acceptance step recorded on that item holds.<br>Tests: CI typecheck, lint, and tests, plus any item-specific tests named on the item. | None |
| **W-50** | Move and duplicate blocks ([`OBL-42`](https://fillicianoplong.atlassian.net/browse/OBL-42)) | high / feature | FR-40, FR-42 | Given the app is built from main, when the behavior in OBL-42 (Move and duplicate blocks) is used, then each acceptance step recorded on that item holds.<br>Tests: CI typecheck, lint, and tests, plus any item-specific tests named on the item. | None |
| **W-51** | Slash menu ([`OBL-43`](https://fillicianoplong.atlassian.net/browse/OBL-43)) | high / feature | FR-34 | Given the app is built from main, when the behavior in OBL-43 (Slash menu) is used, then each acceptance step recorded on that item holds.<br>Tests: CI typecheck, lint, and tests, plus any item-specific tests named on the item. | None |
| **W-52** | Typed shortcuts and keys ([`OBL-44`](https://fillicianoplong.atlassian.net/browse/OBL-44)) | high / feature | FR-35, NFR-15 | Given the app is built from main, when the behavior in OBL-44 (Typed shortcuts and keys) is used, then each acceptance step recorded on that item holds.<br>Tests: CI typecheck, lint, and tests, plus any item-specific tests named on the item. | None |
| **W-53** | Undo and redo ([`OBL-45`](https://fillicianoplong.atlassian.net/browse/OBL-45)) | high / feature | FR-37 | Given the app is built from main, when the behavior in OBL-45 (Undo and redo) is used, then each acceptance step recorded on that item holds.<br>Tests: CI typecheck, lint, and tests, plus any item-specific tests named on the item. | None |
| **W-54** | Menu bar items ([`OBL-46`](https://fillicianoplong.atlassian.net/browse/OBL-46)) | high / feature | FR-02 | Given the app is built from main, when the behavior in OBL-46 (Menu bar items) is used, then each acceptance step recorded on that item holds.<br>Tests: CI typecheck, lint, and tests, plus any item-specific tests named on the item. | None |
| **W-55** | Context menus ([`OBL-47`](https://fillicianoplong.atlassian.net/browse/OBL-47)) | high / feature | FR-43, FR-44 | Given the app is built from main, when the behavior in OBL-47 (Context menus) is used, then each acceptance step recorded on that item holds.<br>Tests: CI typecheck, lint, and tests, plus any item-specific tests named on the item. | None |
| **W-56** | Find and replace ([`OBL-48`](https://fillicianoplong.atlassian.net/browse/OBL-48)) | high / feature | FR-58, FR-59, FR-60 | Given the app is built from main, when the behavior in OBL-48 (Find and replace) is used, then each acceptance step recorded on that item holds.<br>Tests: CI typecheck, lint, and tests, plus any item-specific tests named on the item. | None |
| **W-57** | Spell check ([`OBL-49`](https://fillicianoplong.atlassian.net/browse/OBL-49)) | high / feature | FR-31, NFR-05 | Given the app is built from main, when the behavior in OBL-49 (Spell check) is used, then each acceptance step recorded on that item holds.<br>Tests: CI typecheck, lint, and tests, plus any item-specific tests named on the item. | None |
| **W-58** | Status bar counts and zoom ([`OBL-50`](https://fillicianoplong.atlassian.net/browse/OBL-50)) | high / feature | FR-04 | Given the app is built from main, when the behavior in OBL-50 (Status bar counts and zoom) is used, then each acceptance step recorded on that item holds.<br>Tests: CI typecheck, lint, and tests, plus any item-specific tests named on the item. | None |
| **W-59** | Paste sanitizer ([`OBL-51`](https://fillicianoplong.atlassian.net/browse/OBL-51)) | high / chore | FR-36, NFR-06, NFR-05 | Given the app is built from main, when the behavior in OBL-51 (Paste sanitizer) is used, then each acceptance step recorded on that item holds.<br>Tests: CI typecheck, lint, and tests, plus any item-specific tests named on the item. | None |
| **W-60** | Block clipboard ([`OBL-52`](https://fillicianoplong.atlassian.net/browse/OBL-52)) | high / feature | FR-39, FR-41 | Given the app is built from main, when the behavior in OBL-52 (Block clipboard) is used, then each acceptance step recorded on that item holds.<br>Tests: CI typecheck, lint, and tests, plus any item-specific tests named on the item. | None |
| **W-61** | Links and Open link ([`OBL-53`](https://fillicianoplong.atlassian.net/browse/OBL-53)) | high / chore | FR-44, NFR-06, NFR-05 | Given the app is built from main, when the behavior in OBL-53 (Links and Open link) is used, then each acceptance step recorded on that item holds.<br>Tests: CI typecheck, lint, and tests, plus any item-specific tests named on the item. | None |
| **W-62** | Text-as-markup test ([`OBL-54`](https://fillicianoplong.atlassian.net/browse/OBL-54)) | high / chore | NFR-06, NFR-05 | Given the app is built from main, when the behavior in OBL-54 (Text-as-markup test) is used, then each acceptance step recorded on that item holds.<br>Tests: CI typecheck, lint, and tests, plus any item-specific tests named on the item. | None |

### M5 Pages and layout (OBL-5)

**Goal:** Letter pages, pageless view, page setup, headers and footers, and the MLA template.

**Exit criteria:** Pages view and pageless view both work, and page setup plus header/footer and the MLA template are in.

**Planned dates:** November 23, 2026 to November 29, 2026.

| ID | Title (Jira) | Priority / type | Covers | Acceptance | Depends on |
|---|---|---|---|---|---|
| **W-65** | Pages view layout ([`OBL-55`](https://fillicianoplong.atlassian.net/browse/OBL-55)) | high / feature | FR-22, FR-26, NFR-02 | Given the app is built from main, when the behavior in OBL-55 (Pages view layout) is used, then each acceptance step recorded on that item holds.<br>Tests: CI typecheck, lint, and tests, plus any item-specific tests named on the item. | None |
| **W-66** | Pages/Pageless switch ([`OBL-56`](https://fillicianoplong.atlassian.net/browse/OBL-56)) | high / feature | FR-23, FR-17 | Given the app is built from main, when the behavior in OBL-56 (Pages/Pageless switch) is used, then each acceptance step recorded on that item holds.<br>Tests: CI typecheck, lint, and tests, plus any item-specific tests named on the item. | None |
| **W-67** | Page setup ([`OBL-57`](https://fillicianoplong.atlassian.net/browse/OBL-57)) | high / feature | FR-24 | Given the app is built from main, when the behavior in OBL-57 (Page setup) is used, then each acceptance step recorded on that item holds.<br>Tests: CI typecheck, lint, and tests, plus any item-specific tests named on the item. | None |
| **W-68** | Header and footer ([`OBL-58`](https://fillicianoplong.atlassian.net/browse/OBL-58)) | high / feature | FR-25 | Given the app is built from main, when the behavior in OBL-58 (Header and footer) is used, then each acceptance step recorded on that item holds.<br>Tests: CI typecheck, lint, and tests, plus any item-specific tests named on the item. | None |
| **W-69** | MLA template ([`OBL-59`](https://fillicianoplong.atlassian.net/browse/OBL-59)) | high / feature | FR-27 | Given the app is built from main, when the behavior in OBL-59 (MLA template) is used, then each acceptance step recorded on that item holds.<br>Tests: CI typecheck, lint, and tests, plus any item-specific tests named on the item. | None |

### M6 Tables, images, formulas (OBL-6)

**Goal:** Table blocks with TableMath, images, and equation blocks.

**Exit criteria:** A document can contain a table, an image, and an equation, and each can be edited.

**Planned dates:** November 30, 2026 to December 5, 2026.

| ID | Title (Jira) | Priority / type | Covers | Acceptance | Depends on |
|---|---|---|---|---|---|
| **W-70** | TableMath module ([`OBL-60`](https://fillicianoplong.atlassian.net/browse/OBL-60)) | high / feature | FR-46, FR-47, NFR-21 | Given the app is built from main, when the behavior in OBL-60 (TableMath module) is used, then each acceptance step recorded on that item holds.<br>Tests: CI typecheck, lint, and tests, plus any item-specific tests named on the item. | None |
| **W-71** | Table block ([`OBL-61`](https://fillicianoplong.atlassian.net/browse/OBL-61)) | high / feature | FR-45, FR-48, FR-32 | Given the app is built from main, when the behavior in OBL-61 (Table block) is used, then each acceptance step recorded on that item holds.<br>Tests: CI typecheck, lint, and tests, plus any item-specific tests named on the item. | OBL-60 |
| **W-72** | Image insert ([`OBL-62`](https://fillicianoplong.atlassian.net/browse/OBL-62)) | high / feature | FR-49, FR-32, NFR-20 | Given the app is built from main, when the behavior in OBL-62 (Image insert) is used, then each acceptance step recorded on that item holds.<br>Tests: CI typecheck, lint, and tests, plus any item-specific tests named on the item. | None |
| **W-73** | Image resize, rotate, alt ([`OBL-63`](https://fillicianoplong.atlassian.net/browse/OBL-63)) | high / feature | FR-50, FR-51, FR-52 | Given the app is built from main, when the behavior in OBL-63 (Image resize, rotate, alt) is used, then each acceptance step recorded on that item holds.<br>Tests: CI typecheck, lint, and tests, plus any item-specific tests named on the item. | OBL-62 |
| **W-74** | Equation blocks ([`OBL-64`](https://fillicianoplong.atlassian.net/browse/OBL-64)) | high / feature | FR-53, FR-54, FR-55, NFR-06 | Given the app is built from main, when the behavior in OBL-64 (Equation blocks) is used, then each acceptance step recorded on that item holds.<br>Tests: CI typecheck, lint, and tests, plus any item-specific tests named on the item. | None |

### M7 Print and export (OBL-7)

**Goal:** Print plus export to PDF, Word, and Markdown through one export service.

**Exit criteria:** A sample document prints and exports to the three formats.

**Planned dates:** December 6, 2026 to December 9, 2026.

| ID | Title (Jira) | Priority / type | Covers | Acceptance | Depends on |
|---|---|---|---|---|---|
| **W-75** | Export service and dialog ([`OBL-65`](https://fillicianoplong.atlassian.net/browse/OBL-65)) | high / feature | FR-12, FR-66, NFR-04 | Given the app is built from main, when the behavior in OBL-65 (Export service and dialog) is used, then each acceptance step recorded on that item holds.<br>Tests: CI typecheck, lint, and tests, plus any item-specific tests named on the item. | None |
| **W-76** | Export asset preparation ([`OBL-66`](https://fillicianoplong.atlassian.net/browse/OBL-66)) | high / feature | FR-56, FR-62, FR-63 | Given the app is built from main, when the behavior in OBL-66 (Export asset preparation) is used, then each acceptance step recorded on that item holds.<br>Tests: CI typecheck, lint, and tests, plus any item-specific tests named on the item. | OBL-65 |
| **W-77** | PDF export and print ([`OBL-67`](https://fillicianoplong.atlassian.net/browse/OBL-67)) | high / feature | FR-61, FR-62 | Given the app is built from main, when the behavior in OBL-67 (PDF export and print) is used, then each acceptance step recorded on that item holds.<br>Tests: CI typecheck, lint, and tests, plus any item-specific tests named on the item. | None |
| **W-78** | Word export ([`OBL-68`](https://fillicianoplong.atlassian.net/browse/OBL-68)) | high / feature | FR-63, FR-56, FR-52 | Given the app is built from main, when the behavior in OBL-68 (Word export) is used, then each acceptance step recorded on that item holds.<br>Tests: CI typecheck, lint, and tests, plus any item-specific tests named on the item. | OBL-66 |
| **W-79** | Markdown export ([`OBL-69`](https://fillicianoplong.atlassian.net/browse/OBL-69)) | high / feature | FR-64, FR-65, FR-52 | Given the app is built from main, when the behavior in OBL-69 (Markdown export) is used, then each acceptance step recorded on that item holds.<br>Tests: CI typecheck, lint, and tests, plus any item-specific tests named on the item. | OBL-66, OBL-67 |

### M8 Must complete (OBL-8)

**Goal:** Settings, restore tabs, accessibility and performance passes, About and fonts, security verification, and a Store test build.

**Exit criteria:** The Must-complete stories are finished, in time for the remaining release work.

**Planned dates:** December 10, 2026 to December 12, 2026.

| ID | Title (Jira) | Priority / type | Covers | Acceptance | Depends on |
|---|---|---|---|---|---|
| **W-80** | Settings tab and store ([`OBL-70`](https://fillicianoplong.atlassian.net/browse/OBL-70)) | high / feature | FR-05, FR-06, NFR-26 | Given the app is built from main, when the behavior in OBL-70 (Settings tab and store) is used, then each acceptance step recorded on that item holds.<br>Tests: CI typecheck, lint, and tests, plus any item-specific tests named on the item. | None |
| **W-81** | Restore tabs ([`OBL-71`](https://fillicianoplong.atlassian.net/browse/OBL-71)) | high / feature | FR-05, FR-06 | Given the app is built from main, when the behavior in OBL-71 (Restore tabs) is used, then each acceptance step recorded on that item holds.<br>Tests: CI typecheck, lint, and tests, plus any item-specific tests named on the item. | None |
| **W-82** | Keyboard and Narrator pass ([`OBL-72`](https://fillicianoplong.atlassian.net/browse/OBL-72)) | high / feature | NFR-15, NFR-16 | Given the app is built from main, when the behavior in OBL-72 (Keyboard and Narrator pass) is used, then each acceptance step recorded on that item holds.<br>Tests: CI typecheck, lint, and tests, plus any item-specific tests named on the item. | None |
| **W-83** | Contrast and scaling pass ([`OBL-73`](https://fillicianoplong.atlassian.net/browse/OBL-73)) | high / feature | NFR-17, NFR-18, NFR-19 | Given the app is built from main, when the behavior in OBL-73 (Contrast and scaling pass) is used, then each acceptance step recorded on that item holds.<br>Tests: CI typecheck, lint, and tests, plus any item-specific tests named on the item. | None |
| **W-84** | Performance pass ([`OBL-74`](https://fillicianoplong.atlassian.net/browse/OBL-74)) | high / chore | NFR-01, NFR-02, NFR-03, NFR-04 | Given the app is built from main, when the behavior in OBL-74 (Performance pass) is used, then each acceptance step recorded on that item holds.<br>Tests: CI typecheck, lint, and tests, plus any item-specific tests named on the item. | None |
| **W-85** | About page and fonts ([`OBL-75`](https://fillicianoplong.atlassian.net/browse/OBL-75)) | high / feature | NFR-28, NFR-30 | Given the app is built from main, when the behavior in OBL-75 (About page and fonts) is used, then each acceptance step recorded on that item holds.<br>Tests: CI typecheck, lint, and tests, plus any item-specific tests named on the item. | None |
| **W-86** | Security verification pass ([`OBL-76`](https://fillicianoplong.atlassian.net/browse/OBL-76)) | high / chore | NFR-05, NFR-06, NFR-07, FR-09 | Given the app is built from main, when the behavior in OBL-76 (Security verification pass) is used, then each acceptance step recorded on that item holds.<br>Tests: CI typecheck, lint, and tests, plus any item-specific tests named on the item. | None |
| **W-87** | Store test build ([`OBL-77`](https://fillicianoplong.atlassian.net/browse/OBL-77)) | high / chore | NFR-24, NFR-25, NFR-26, NFR-27, NFR-31 | Given the app is built from main, when the behavior in OBL-77 (Store test build) is used, then each acceptance step recorded on that item holds.<br>Tests: CI typecheck, lint, and tests, plus any item-specific tests named on the item. | None |

### M9 Should features (OBL-9)

**Goal:** Should-priority features after the CSC 481 demo on December 16, 2026.

**Exit criteria:** The Should items still in scope are finished, or deferred in writing.

**Planned dates:** December 17, 2026 to December 31, 2026.

This epic starts after M10 Release and after the December 16 demo.

| ID | Title (Jira) | Priority / type | Covers | Acceptance | Depends on |
|---|---|---|---|---|---|
| **W-88** | Open from File Explorer ([`OBL-78`](https://fillicianoplong.atlassian.net/browse/OBL-78)) | medium / feature | FR-18 | Given the app is built from main, when the behavior in OBL-78 (Open from File Explorer) is used, then each acceptance step recorded on that item holds.<br>Tests: CI typecheck, lint, and tests, plus any item-specific tests named on the item. | None |
| **W-89** | Recovery copies ([`OBL-79`](https://fillicianoplong.atlassian.net/browse/OBL-79)) | medium / feature | FR-19, FR-20, FR-21 | Given the app is built from main, when the behavior in OBL-79 (Recovery copies) is used, then each acceptance step recorded on that item holds.<br>Tests: CI typecheck, lint, and tests, plus any item-specific tests named on the item. | None |
| **W-90** | Reduced motion pass ([`OBL-80`](https://fillicianoplong.atlassian.net/browse/OBL-80)) | medium / feature | NFR-20 | Given the app is built from main, when the behavior in OBL-80 (Reduced motion pass) is used, then each acceptance step recorded on that item holds.<br>Tests: CI typecheck, lint, and tests, plus any item-specific tests named on the item. | None |
| **W-91** | Coverage target ([`OBL-81`](https://fillicianoplong.atlassian.net/browse/OBL-81)) | medium / chore | NFR-23 | Given the app is built from main, when the behavior in OBL-81 (Coverage target) is used, then each acceptance step recorded on that item holds.<br>Tests: CI typecheck, lint, and tests, plus any item-specific tests named on the item. | None |
| **W-92** | Date and time items ([`OBL-82`](https://fillicianoplong.atlassian.net/browse/OBL-82)) | medium / feature | FR-67, FR-68, FR-69 | Given the app is built from main, when the behavior in OBL-82 (Date and time items) is used, then each acceptance step recorded on that item holds.<br>Tests: CI typecheck, lint, and tests, plus any item-specific tests named on the item. | None |
| **W-93** | Column rows ([`OBL-83`](https://fillicianoplong.atlassian.net/browse/OBL-83)) | medium / feature | FR-70, FR-71, FR-72, FR-73 | Given the app is built from main, when the behavior in OBL-83 (Column rows) is used, then each acceptance step recorded on that item holds.<br>Tests: CI typecheck, lint, and tests, plus any item-specific tests named on the item. | None |
| **W-94** | Column paging ([`OBL-84`](https://fillicianoplong.atlassian.net/browse/OBL-84)) | medium / feature | FR-74 | Given the app is built from main, when the behavior in OBL-84 (Column paging) is used, then each acceptance step recorded on that item holds.<br>Tests: CI typecheck, lint, and tests, plus any item-specific tests named on the item. | None |
| **W-95** | Word equations ([`OBL-85`](https://fillicianoplong.atlassian.net/browse/OBL-85)) | medium / feature | FR-57, NFR-29 | Given the app is built from main, when the behavior in OBL-85 (Word equations) is used, then each acceptance step recorded on that item holds.<br>Tests: CI typecheck, lint, and tests, plus any item-specific tests named on the item. | None |
| **W-96** | Signature block ([`OBL-86`](https://fillicianoplong.atlassian.net/browse/OBL-86)) | medium / feature | FR-78, FR-80, FR-81 | Given the app is built from main, when the behavior in OBL-86 (Signature block) is used, then each acceptance step recorded on that item holds.<br>Tests: CI typecheck, lint, and tests, plus any item-specific tests named on the item. | None |
| **W-97** | Saved signatures ([`OBL-87`](https://fillicianoplong.atlassian.net/browse/OBL-87)) | medium / chore | FR-79, NFR-08, NFR-09 | Given the app is built from main, when the behavior in OBL-87 (Saved signatures) is used, then each acceptance step recorded on that item holds.<br>Tests: CI typecheck, lint, and tests, plus any item-specific tests named on the item. | None |
| **W-98** | Drawing pad ([`OBL-88`](https://fillicianoplong.atlassian.net/browse/OBL-88)) | medium / feature | FR-75 | Given the app is built from main, when the behavior in OBL-88 (Drawing pad) is used, then each acceptance step recorded on that item holds.<br>Tests: CI typecheck, lint, and tests, plus any item-specific tests named on the item. | None |
| **W-99** | Draw on images ([`OBL-89`](https://fillicianoplong.atlassian.net/browse/OBL-89)) | medium / feature | FR-76, FR-77 | Given the app is built from main, when the behavior in OBL-89 (Draw on images) is used, then each acceptance step recorded on that item holds.<br>Tests: CI typecheck, lint, and tests, plus any item-specific tests named on the item. | None |
| **W-100** | Diagram block ([`OBL-90`](https://fillicianoplong.atlassian.net/browse/OBL-90)) | medium / feature | FR-82, FR-83, NFR-06 | Given the app is built from main, when the behavior in OBL-90 (Diagram block) is used, then each acceptance step recorded on that item holds.<br>Tests: CI typecheck, lint, and tests, plus any item-specific tests named on the item. | None |
| **W-101** | Drag tabs to reorder them ([`OBL-105`](https://fillicianoplong.atlassian.net/browse/OBL-105)) | low / feature | FR-03 (inferred) | Given the app is built from main, when the behavior in OBL-105 (Drag tabs to reorder them) is used, then each acceptance step recorded on that item holds.<br>Tests: CI typecheck, lint, and tests, plus any item-specific tests named on the item. | None |

### M10 Release (OBL-10)

**Goal:** Store certification and the public release, before the December 16 demo.

**Exit criteria:** A Store test or certification build is submitted, and the release checklist is complete.

**Planned dates:** December 13, 2026 to December 15, 2026.

Dates come before M9 Should features so the demo can use a release build.

| ID | Title (Jira) | Priority / type | Covers | Acceptance | Depends on |
|---|---|---|---|---|---|
| **W-102** | Store certification and release ([`OBL-91`](https://fillicianoplong.atlassian.net/browse/OBL-91)) | high / chore | NFR-31, NFR-24, NFR-27, NFR-28 | Given the app is built from main, when the behavior in OBL-91 (Store certification and release) is used, then each acceptance step recorded on that item holds.<br>Tests: CI typecheck, lint, and tests, plus any item-specific tests named on the item. | OBL-77 |

## 5. Traceability

Every Must requirement in the SRS was checked against the Covers column. 88 Must requirements (61 FRs and 27 NFRs) each map to at least one work item.

| Area | Requirements | Milestone |
|---|---|---|
| Window shell, tabs, theme, CI, MSIX | FR-01 to FR-03 and related shell NFRs | M1 |
| De-risking spikes | S-01 to S-05, recorded in the SRS and architecture | M2 |
| Safe files and the .obk codec | Open, save, and autosave, NFR-10 | M3 |
| Editing core | Text blocks, formatting, handles, menus, find, and spell check | M4 |
| Pages and layout | Pages, pageless, page setup, header and footer, MLA | M5 |
| Tables, images, equations | TableMath, table, image, and equation Must FRs | M6 |
| Print and export | PDF, print, Word, Markdown | M7 |
| Settings, accessibility, performance, security, Store test | Must-complete NFRs including NFR-31 | M8 |
| Should features | Should FRs after the demo | M9 |
| Release | Store certification and 1.0.0 | M10 |

**Must gaps:** none. Every Must FR and NFR maps to at least one story or task.

**Should gaps:** none.

## 6. Definition of done

A milestone is done when every Must item in it is complete, the milestone exit criteria hold, and any Must bugs found under that epic are fixed or waived in writing.

### 6.1 Per item

Every work item uses this wording:

- All steps are checked.
- Tests, typecheck, and lint pass in CI.
- No renderer file imports Node or Electron main APIs.
- Any UNVERIFIED item this settles has a proposed doc edit.
- It lands in one commit on main.

## 7. Risks

These risks are taken from Architecture 1.0, section 8, with the work that carries the mitigation.

| ID | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R-01 | mathml2omml output differs from KaTeX for some formulas | Medium | Medium | Test the SRS formula samples in Word early; the image fallback covers failures (FR-56). Owner: Developer. Work: spike S-03, then M6 and M9. |
| R-02 | LGPL terms for mathml2omml inside the MSIX are not met | Low | High | Ship it unbundled as its own module, with source link and license text (NFR-29); check the LGPL text. Owner: Developer. Work: M6 and M10. |
| R-03 | Column rows split across pages differently on screen and in PDF | High | Medium | One layout module used by Pages view and print; PDF compare tests (FR-74). Owner: Developer. Work: M5, M7, and M9. |
| R-04 | Store certification is delayed near release | Medium | High | Submit a private test build one month before release (NFR-31). Owner: Developer. Work: M8 and M10. |
| R-05 | Some LibreOffice fonts are not OFL | Medium | Medium | Check each license file before bundling; drop any font that does not fit (OD-08). Owner: Developer. Work: M8. |
| R-06 | MSIX file activation or file writes behave differently than expected | Medium | Medium | Spikes S-01 and S-02 in a packaged build before the file features are built. Owner: Developer. Work: M2, then M3. |
| R-07 | Antivirus or indexers lock the target during replace | Medium | Medium | Retry 3 times at 100 ms, then report; never leave a partial file (NFR-10). Owner: Developer. Work: M2 and M3. |

## 8. Tracker setup

File the plan in Jira using the mapping below. Planned dates go on the epics only.

| Plan idea | In Jira |
|---|---|
| Milestone M1–M10 | Epic OBL-1 to OBL-10, with planned start and due dates on the epic only. |
| Work item W-xx | The Story or Task listed in section 4 (the OBL key in the item table). |
| Priority high / medium / low | Jira Priority High, Medium, Low. |
| FR and NFR IDs | The Requirements line in the Details section. |
| Definition of done | The Definition of done section of each description, using the wording in section 6. |
| Landed change | When an item is closed, a Fixed in note should name the app version and link the commit. |
| How work lands | One commit on main, with an app version bump and a CHANGELOG entry. |

## 9. Decisions

- Jira is the tracker, and changes land as direct commits on main.
- Milestones follow the ten epics, including M10 Release before M9 Should features, so the CSC 481 demo on December 16, 2026 can use a release build.
- The definition of done is the wording in section 6.
- App versions start at 0.1.0, bump on each change, and reserve 1.0.0 for M10.
- Spikes S-01 to S-05 run in M2 and are recorded before the file features in M3 are built.

## 10. Files

| File | Role |
|---|---|
| `docs/IMPLEMENTATION_PLAN.md` | Source text of this plan. |
| `docs/Plong_Obelisk_Implementation_Plan.docx` | Word copy in the project house style. |
| `docs/out/Plong_Obelisk_Implementation_Plan.pdf` | PDF copy. |

Related project documents: `docs/SRS.md` (1.0) and `docs/ARCHITECTURE.md` (1.0).
