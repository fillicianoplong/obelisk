# Spike S-02: Explorer open and the second instance

Throwaway check for issue 9. Nothing here is part of the app, and nothing here is imported from `src/`.

## Question

When Obelisk runs as a packaged MSIX, does a double-clicked file path reach the process on a cold start, and does a second double-click reach the already running process through `app.requestSingleInstanceLock()` and the `second-instance` event?

FR-18 says a double-clicked .obk file opens in Obelisk, in a new tab if Obelisk is already running. ADR-009 says main takes the single-instance lock and a second launch passes its arguments through `second-instance`. R-06 is the risk that MSIX file activation does not do that. Section 9.1 asks S-02 to double-click an .obk file with Obelisk running and confirm the path arrives through that event.

On a pass, keep the architecture's design.

On a fail, the fallback is to drop FR-18 or use the MSIX activation path the spike finds.

Cases 1 and 2 are the pass/fail for that decision. Case 1 is the cold start. Case 2 is the second file while the window is already open, with one window still. Cases 3 through 7 are written down beside them. If case 1 and case 2 pass and a later case fails, keep ADR-009 for the double-click and write the failed case in the table.

## Package

The packaged app this spike builds is not Obelisk.Dev. The identity is `Obelisk.SpikeS02`, display name Obelisk Spike S-02, publisher `CN=Obelisk Dev`, version 0.0.1.0. Installing it does not replace Obelisk.Dev, and it does not register `.obk`.

ADR-008 says the release package has the .obk file-type association. It does not paste the manifest XML. The entry Obelisk will ship is `packaging/msix/AppxManifest.xml`: a `windows.fileTypeAssociation` named `obk`, file type `.obk`, display name Obelisk Document, logo `assets\Square44x44Logo.png`, and a `windows.appExecutionAlias` of `Obelisk.exe`. ADR-009 does not mention the alias. The manifest has it, so this spike has one too.

`spikes/s02/AppxManifest.xml` copies that shape. The file type is `.s02obk`, the association name is `s02obk`, the display name is Obelisk Spike S-02 Document, the logo is the same `assets\Square44x44Logo.png`, and the alias is `ObeliskSpikeS02.exe`. There is no `EditFlags` and no `OpenIsSafe`, because the Obelisk manifest does not have them. The package is full trust, x64, Electron 45, and it uses the same `CN=Obelisk Dev` certificate as `npm run package:msix`.

## What the window records

The app name is set to Obelisk Spike S-02 before the single-instance lock, so both processes share that lock. The first process opens one window. A second process that does not get the lock writes `second-process.json` and exits. It does not open a window.

Every path is logged with a timestamp. The report has `process.argv` on the cold start, and for `second-instance` it has `argv`, `workingDirectory`, and `additionalData`. `open-file` and `open-url` are recorded too if Electron emits them. The page lists the same paths.

`Windows.ApplicationModel.AppInstance.GetActivatedEventArgs` is the MSIX activation object. Electron 45 does not expose it on `app`. This spike does not add a native module. On Windows it starts a child PowerShell process and asks that process to call `GetActivatedEventArgs`. That result is the child, not the Electron process, and the report says so. `reachableFromThisProcess` is true only when an Electron method on this process returns activation data.

The report is JSON, UTF-8 without a BOM. A launch from Explorer, the Start menu, or the alias, with no `--output`, writes it under Documents:

`Documents\Obelisk-Spike-S02\reports\spike-report.json`

On this PC, Documents is `C:\Users\filli\OneDrive\Documents`. A new cold start renames the previous `spike-report.json` to `spike-report-<time>-<pid>.json` before it writes the new one. Each process also writes `process-<pid>.json`. The capture is `walkthrough.png`, and a second copy is kept next to it with the time in the name.

The spike logs the paths it receives. It does not apply the product rule that keeps only existing .obk files.

## Window

The window is shown as soon as it is created, with background `#F4F1EA`, and it is not hidden until later. On Windows the caption is the same hidden title bar and 32px overlay the Obelisk window uses. The page keeps 32px clear at the top. The `s02:` scheme is registered with the same privileges as `app:`: standard, secure, fetch, cors, stream, `bypassCSP` false, service workers off. The page response carries the same Content-Security-Policy shape, with `s02:` in place of `app:`, and no `unsafe-eval` and no `unsafe-inline`. Styles are in `renderer.css`. Press F12 for DevTools, or start with `--devtools`.

`npm start` in `spikes\s02`, with `CI` unset, opens the unpackaged window only. It does not answer the MSIX question.

## Run it on this PC

Windows 11 Home 10.0.26300. The clone is `C:\dev\obelisk`. Node on this PC is v24.21.0. The GitHub job uses Node 22.23.4. Those do not have to match. The package is Electron 45.0.0 from the app dependency, not from the system Node.

The dev certificate is already in `LocalMachine\TrustedPeople`. `npm run package:msix` at the repo root and this spike both reuse the code-signing cert in `CurrentUser\My` whose subject is `CN=Obelisk Dev`. The log should say `Dev certificate: reused`. If it says `Dev certificate: created`, stop. That cert is not the one already trusted.

From `C:\dev\obelisk`, in PowerShell, in this order:

```
npm ci
node node_modules\electron\install.js
npm ci --prefix spikes\s02
npm --prefix spikes\s02 run package:msix
powershell -NoProfile -ExecutionPolicy Bypass -File .\spikes\s02\install-spike.ps1 -Action Install -Msix .\spikes\s02\dist\msix\Obelisk-Spike-S02.msix
powershell -NoProfile -ExecutionPolicy Bypass -File .\spikes\s02\create-test-files.ps1
```

`Install` does not import a certificate. It does not remove Obelisk.Dev, and it does not register `.obk`. `Get-AppxPackage -Name Obelisk.Dev` and `Get-AppxPackage -Name Obelisk.SpikeS02` can both be installed. The script checks that Obelisk.Dev's package full name does not change.

`create-test-files.ps1` writes an `Obelisk-Spike-S02` folder under Documents, under the known Desktop, under `%USERPROFILE%\Desktop` when that is a different folder, and under `%USERPROFILE%\OneDrive\Documents` when that folder exists and is not already Documents. Each folder has `paths.txt`. The script also writes `spikes\s02\output\test-files.txt`.

Use this folder for the cases:

`C:\Users\filli\OneDrive\Documents\Obelisk-Spike-S02`

Close Obelisk Spike S-02 before case 1. Look at the window, then write pass or fail in the table. The report for these launches is `C:\Users\filli\OneDrive\Documents\Obelisk-Spike-S02\reports\`.

### case-01-cold

The app is closed. In that folder, double-click `case-01-cold.s02obk`.

Pass: one window opens, and Cold start shows that path.

### case-02-second

Leave that window open. Double-click `case-02-second.s02obk`.

Pass: the same window shows the new path as `second-instance`. No second window opens.

### case-03

Leave the window open. Open the `case-03` folder, select `case-03-a.s02obk`, `case-03-b.s02obk`, and `case-03-c.s02obk`, and press Enter.

Write down whether the same window received all three paths, and whether another window opened.

### case-04

Close the app. Double-click the file whose name is Lesson 04, an em dash, a space, café, and `.s02obk`. The script builds that name from character codes so the script file stays ASCII. `paths.txt` has the full path.

Pass: Cold start shows the path with the spaces, the em dash, and `é` still in the text.

### case-05

Close the app. Double-click `C:\Users\filli\OneDrive\Documents\Obelisk-Spike-S02\case-05-onedrive.s02obk`.

On this PC, Documents is that OneDrive folder, so this file sits next to the others. The path in the window should be that OneDrive path.

### case-06

Leave the window open. If it is closed, start Obelisk Spike S-02 from the Start menu with no file, and wait until the window says Cold start. Right-click `case-06-open-with.s02obk`, choose Open with, and choose Obelisk Spike S-02. If it is not listed, choose the app that says Obelisk Spike S-02 Document.

Pass: the existing window shows the path, and no second window opens.

### case-07

Close the app. The manifest alias is `ObeliskSpikeS02.exe`. From `C:\dev\obelisk`:

```
& "$env:LOCALAPPDATA\Microsoft\WindowsApps\ObeliskSpikeS02.exe" "C:\Users\filli\OneDrive\Documents\Obelisk-Spike-S02\case-07-alias.s02obk"
```

Pass: one window opens, and Cold start shows that path. If Windows says the alias is missing, start the app once from the Start menu, close it, and run the command again. If it is still missing, write that down. Do not point this case at the exe inside the install folder. That is a different launch.

### Collect, then uninstall

Collect while the package is still installed, and before uninstall. Uninstall deletes the `Obelisk-Spike-S02` test folders. It does not delete `C:\Users\filli\s02-results`.

```
powershell -NoProfile -ExecutionPolicy Bypass -File .\spikes\s02\collect-results.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\spikes\s02\install-spike.ps1 -Action Uninstall
```

`collect-results.ps1` copies the repo `spikes\s02\output` folder, the Documents reports, the OneDrive folder when it is not the same as Documents, and the Desktop reports into `C:\Users\filli\s02-results`. It prints `S02_COLLECTED` and writes `collected.txt`.

## Automated results

Workflow: `.github/workflows/spike-s02.yml`, on `windows-latest`, Node 22.23.4. The job stops after 40 minutes. Unpackaged `npm start` stops after 8 minutes. Packaging stops after 20 minutes. The install step stops after 15 minutes.

`CI` is set, so `npm start` is the unpackaged check. It does not install an MSIX. It opens one window, launches Electron again with `ci second.s02obk`, and checks that `second-instance` receives that path, the second process working directory, and `additionalData.spike` of `s02`. The second process must not get the lock. On Windows it also requires `walkthrough.png`.

The job then builds `Obelisk-Spike-S02.msix`, trusts the certificate only when the job is elevated, installs `Obelisk.SpikeS02`, and launches the installed `ObeliskSpikeS02.exe` twice. The first launch gets `ci-cold.s02obk`. The second gets `ci second.s02obk`, with a space in the name, from another working directory. The job checks that the second launch reaches the first through `second-instance`, that `windowsOpened` is 1, that one process held the lock, and that `walkthrough.png` was written. It prints whether the `ObeliskSpikeS02.exe` alias is present. A missing alias does not fail the job. Case 7 is the alias check, and it is manual.

The job then removes `Obelisk.SpikeS02`. It does not remove Obelisk.Dev. It does not delete `spikes\s02\output`, so the report and the capture stay as artifacts.

That packaged check starts the exe with a file argument. It is not a double-click in Explorer, not a multi-select, not Open with, and not the alias. Those are the manual cases. The workflow on this pull request is the run. This section is not the Windows 11 Home result.

## Manual results

I ran the packaged app on this PC on Oct 27, 2026, at 3:57 PM Pacific, from commit `0f95f5f`. I built the MSIX here with `npm --prefix spikes\s02 run package:msix` and installed it with `install-spike.ps1`. The package was Obelisk.SpikeS02 0.0.1.0, x64 (`Obelisk.SpikeS02_0.0.1.0_x64__09826e2d9xne4`). Obelisk.Dev 0.1.14.0 stayed installed and was not replaced. The package itself was Electron 45.0.0 (Chrome 156.0.8078.48, Node 24.22.0). Windows was 11 Home 10.0.26300. `windowsStore` was true and the process was packaged.

Documents on this PC is OneDrive Known Folder Move. The files I opened were in `C:\Users\filli\OneDrive\Documents\Obelisk-Spike-S02`. `collect-results.ps1` copied the reports from that folder at 4:01 PM Pacific. Each cold start kept the previous `spike-report.json`. These notes are from those reports.

case-01-cold passed. The app was closed. Double-clicking `case-01-cold.s02obk` started pid 22820. That process got the lock and opened one window. Cold start argv was the packaged exe and `C:\Users\filli\OneDrive\Documents\Obelisk-Spike-S02\case-01-cold.s02obk`. The working directory was `C:\WINDOWS\System32`.

case-02-second passed. I left that window open and double-clicked `case-02-second.s02obk`. The same pid 22820 received it as `second-instance` at 22:57:33.721Z. `windowsOpened` stayed 1. No second window opened. The second process's `additionalData.pid` was 28976, and `additionalData.spike` was `s02`. The event argv was the exe, then `--allow-file-access-from-files`, `--secure-schemes=s02`, `--cors-schemes=s02`, `--fetch-schemes=s02`, `--standard-schemes=s02`, `--streaming-schemes=s02`, then the file path. The path is in argv, but it is not a fixed slot. The real app has to pick the file paths out of argv.

case-03 passed. With pid 22820 still open, I selected the three files in `case-03` and pressed Enter. The same window got three `second-instance` events, each with one path: `case-03-a.s02obk` at 22:57:53.452Z, `case-03-b.s02obk` at 22:57:53.530Z, and `case-03-c.s02obk` at 22:57:53.641Z. That is 189 ms from the first of the three to the last. `windowsOpened` stayed 1. The working directory on each event was `C:\WINDOWS\System32`.

case-04 passed. I closed the app and double-clicked `Lesson 04 — café.s02obk`. Pid 35944 got the lock and opened one window. Cold start kept the spaces, the em dash (U+2014), and `é` (U+00E9). The path in the report is `C:\Users\filli\OneDrive\Documents\Obelisk-Spike-S02\Lesson 04 — café.s02obk`, and that file was on disk. The working directory was again `C:\WINDOWS\System32`.

case-05 passed. I closed the app and double-clicked `case-05-onedrive.s02obk` in that same OneDrive Documents folder. Pid 22880 got the lock and opened one window. Cold start showed `C:\Users\filli\OneDrive\Documents\Obelisk-Spike-S02\case-05-onedrive.s02obk`. The working directory was `C:\WINDOWS\System32`.

case-06 passed. I left pid 22880 open and used Open with on `case-06-open-with.s02obk`. The same window received it as `second-instance` at 22:59:09.798Z. `windowsOpened` stayed 1. The event argv had the same Chromium switches before the path.

case-07 passed. I closed the app and ran the alias from PowerShell with the working directory `C:\dev\obelisk`:

```
& "$env:LOCALAPPDATA\Microsoft\WindowsApps\ObeliskSpikeS02.exe" "C:\Users\filli\OneDrive\Documents\Obelisk-Spike-S02\case-07-alias.s02obk"
```

Pid 6308 got the lock, opened one window, and cold start showed that path. The reported cwd was `C:\dev\obelisk`. I closed it and ran the same command again. Pid 12900 was another cold start, it got the lock, and the path and cwd were the same. The alias resolves to `C:\Program Files\WindowsApps\Obelisk.SpikeS02_0.0.1.0_x64__09826e2d9xne4\ObeliskSpikeS02.exe`.

Every Explorer launch in this run used cwd `C:\WINDOWS\System32`. A relative path must not be resolved against cwd. The alias launch is the one that kept `C:\dev\obelisk`.

Electron 45 has no method on `app` for `Windows.ApplicationModel.AppInstance.GetActivatedEventArgs`. `reachableFromThisProcess` was false on every report. The child PowerShell call failed with `CALL_FAILED` (the error text for that code was missing). That child is not this process. The file path was already on argv for every case, so this run does not need that call.

| Case | Result | What the window showed |
|---|---|---|
| case-01-cold | Pass | Pid 22820, one window, cold start, `case-01-cold.s02obk`, cwd `C:\WINDOWS\System32`. |
| case-02-second | Pass | Same pid, `second-instance`, one window. Switches, then the path. |
| case-03 | Pass | Three `second-instance` events, one path each, within 189 ms, one window. |
| case-04 | Pass | Pid 35944, cold start, spaces, em dash, and `é` kept. |
| case-05 | Pass | Pid 22880, one window, the OneDrive Documents path. |
| case-06 | Pass | Same pid 22880, Open with arrived as `second-instance`, one window. |
| case-07 | Pass | Alias, pids 6308 and 12900, each a cold start with the lock, cwd `C:\dev\obelisk`. |

- [x] Pass. Case 1 and case 2 showed the file path in the one window. Cases 3 through 7 did too. On a pass, keep the architecture's design.
- [ ] Fail. Case 1 or case 2 did not. On a fail, the fallback is to drop FR-18 or use the MSIX activation path the spike finds.

### Acceptance criteria

- [x] Given the spike build; when I run S-02; then the findings note records the result and the build it ran on (R-06).
- [x] Given a pass; when the note is reviewed; then the dependent item keeps the architecture's design (R-06).
- [ ] Given a fail; when the note is reviewed; then the fallback is chosen: drop FR-18 or use the MSIX activation path the spike finds (R-06).
- [x] Given the spike code; when the item closes; then no spike code is merged into src/ (R-06).

The fail line does not apply. The run passed, so the fallback is not chosen. The last line is ticked because this change does not add spike code under `src/`.

I then removed the package with `install-spike.ps1 -Action Uninstall`. Obelisk.Dev 0.1.14.0 was still installed after that.

## Proposed notes

Not applied. `docs/SRS.md` and `docs/ARCHITECTURE.md` stay as they are. The 1.3 update uses the pass block.

### If this is a pass

Replace the UNVERIFIED sentence under FR-18 in `docs/SRS.md` with:

> Checked in spike S-02 on Oct 27, 2026, Windows 11 Home 10.0.26300, Electron 45.0.0, commit 0f95f5f, package Obelisk.SpikeS02 0.0.1.0. A double-clicked file reached the process on a cold start through argv, and a second double-click reached the running process through app.requestSingleInstanceLock and the second-instance event. One window stayed open. Selecting three files and pressing Enter delivered three second-instance events, one path each. Open with and the app execution alias also put the path on argv. The second-instance argv includes Chromium switches before the path, so main takes the file paths out of argv instead of reading a fixed index. Explorer set the working directory to C:\WINDOWS\System32, so a relative path is not resolved against cwd. FR-18 keeps that design (ADR-009).

In ADR-009, replace "the activation path needs an MSIX test" with that same result. Add that multi-select is one event per file, and that the working directory for an Explorer launch was `C:\WINDOWS\System32`.

The section 9.1 row for S-02 can say: checked Oct 27, 2026, commit 0f95f5f, Electron 45.0.0, Windows 11 Home 10.0.26300, the path arrived on argv for a cold start and through the second-instance event when the app was already running.

`Windows.ApplicationModel.AppInstance.GetActivatedEventArgs` is not on Electron's `app` object. This run did not need it. The path was on argv in every case.

### If this is a fail

Not used. The run passed, so this fallback is not chosen.

## Uninstall

From `C:\dev\obelisk`, after `collect-results.ps1`:

```
powershell -NoProfile -ExecutionPolicy Bypass -File .\spikes\s02\install-spike.ps1 -Action Uninstall
```

That removes `Obelisk.SpikeS02` only. It also deletes `Obelisk-Spike-S02` under Documents, under Desktop, and under OneDrive Documents. It does not remove Obelisk.Dev, it does not remove the `CN=Obelisk Dev` certificate, and it does not remove `C:\Users\filli\s02-results`.

The same removal without the test-folder cleanup:

```
Get-AppxPackage -Name Obelisk.SpikeS02 | Remove-AppxPackage
```
