# Spike S-01: MSIX save and rename

Throwaway check for issue 8. Nothing here is part of the app, and nothing here is imported from `src/`.

## Question

When Obelisk runs as a packaged MSIX, does a write into the real Documents folder, and into a second folder, land on that path with no MSIX file-system redirection? Does writeAtomic's last step, a temp file in the same folder and then one rename over the existing file, replace the target in one step?

The packaged app this spike builds is not Obelisk.Dev. The identity is `Obelisk.SpikeS01`, display name Obelisk Spike S-01, publisher `CN=Obelisk Dev`. Installing it does not replace Obelisk.Dev, and it does not register `.obk`. It is the same kind of package as `npm run package:msix`: full trust, x64, Electron 45, the same certificate approach. The dev package's manifest does not turn file-system virtualization off. This spike does not turn it off either.

NFR-10 says a save target holds the previous bytes or the complete new file, never part of one. NFR-12 says a save is done only after the complete file has replaced the target. R-06 is the risk that an MSIX write is not the write we expect. R-07 is the risk that a lock makes the rename fail. The architecture's writeAtomic is a temp file `.~obk-<128-bit hex>.tmp` in the same folder, exclusive create, flush, then one rename. On a failure it removes the temp file. The architecture retries EPERM or EBUSY three times, 100 ms apart.

AppData is the contrast. MSIX virtualizes parts of AppData. This spike records where `app.getPath('userData')` and `app.getPath('documents')` resolve when the package is running, and a process outside the package runs Get-Item on the paths the package claims.

## What Node does on Windows

I read libuv's Windows `fs__rename` on the v1.x line. It calls `MoveFileExW` with `MOVEFILE_REPLACE_EXISTING` and nothing else. There is no retry in that function. Node's `fs.rename` is that call. A temp file in the same folder stays on the same volume, so the replace is not a copy onto another drive. The running `uv` version is in the report. The Windows result below is the check. The source note is not a substitute for it.

The stress loop in this spike retries EPERM, EBUSY, and EACCES up to twelve times, 40 ms apart, and records when a retry was needed. The extra tries are there because the watcher, or the indexer, can hold the target for a moment. EACCES is included because access denied is the other code that call returns. The read-only case and the open-file case do not retry. They record the first error, check that the old bytes are still there, clear the condition, and try once more so a held file is not left behind.

The watcher polls. It opens the target sharing read, write, and delete, reads the bytes, and closes the handle before it checks them. A missing file or a buffer that is not one complete payload is a failure. A sharing error is counted and is not, by itself, a half-written file. A poll can miss a gap shorter than the time between reads. If it sees a gap, the replace was not one step.

## Cases

| # | Case | Settles | What it does |
|---|---|---|---|
| 1 | `documents-new` | R-06 | writeAtomic creates `Documents\Obelisk-Spike-S01\documents-new.txt`. |
| 2 | `second-folder-new` | R-06 | The same write under `Obelisk-Spike-S01` in the second folder. |
| 3 | `rename-replace-documents` | R-06, R-07 | Forty replaces of a 64 KB payload in that Documents folder. A watcher polls the target. |
| 4 | `rename-replace-second` | R-06, R-07 | The same replace in the second folder. |
| 5 | `rename-readonly` | R-07 | The target has the read-only attribute. The first `fs.rename` error is recorded. |
| 6 | `rename-open` | R-07 | Another process holds the file and does not share delete. The first `fs.rename` error is recorded. |
| 7 | `appdata-contrast` | R-06 | Writes under `app.getPath('userData')`, under Roaming, and under Local. |

The unpackaged check runs only `rename-replace-documents`, `rename-readonly`, and `rename-open`, and it runs them in `spikes/s01/output/work`. That folder is not Documents. Those three answer the rename mechanics on that machine. They do not answer redirection.

Cases 1, 2, 4, and 7, and the Documents path of case 3, run in the packaged app. The package cannot decide redirection by itself. A child of the package has the same virtual view. `confirm-outside.ps1` is started by a normal process and runs Get-Item.

On the packaged run, an outside watcher is started before the app, on the go file the app writes. That watcher is not a child of the package. The app also starts its own watcher. The outside one is the rename result that counts for redirection. The GitHub job uses the runner Desktop as the second folder. A folder picked on this PC, including a OneDrive folder, is only in the manual section.

## Window

The window is shown as soon as it is created, with background `#F4F1EA`, and it is not resized after that. On Windows the caption is the same hidden title bar and 32px overlay the Obelisk window uses. The page keeps 32px clear at the top. The `s01:` scheme is registered with the same privileges as `app:`: standard, secure, fetch, cors, stream, `bypassCSP` false, service workers off. The page response carries the same Content-Security-Policy shape, with `s01:` in place of `app:`, and no `unsafe-eval` and no `unsafe-inline`. Styles are in `renderer.css`. Press F12 for DevTools, or start with `--devtools`.

The window lists `app.getPath('userData')`, `app.getPath('documents')`, desktop, AppData, temp, the exe, and whether the process is packaged. It shows the case it is on and the result of each case. It writes `walkthrough.png` when the first case is up and `results.png` when the run is written down. The page keeps asking for state until the window is gone. Once the window is closed, that call returns the last state and does not throw.

## Run it on this PC

Windows 11 Home 10.0.26300. The clone is `C:\dev\obelisk`. Node is 22.23.4, the version in `.github/workflows/ci.yml` and in `.github/workflows/spike-s01.yml`. `node -v` should print `v22.23.4`. The dev certificate is already in `LocalMachine\TrustedPeople`. `npm run package:msix` at the repo root and this spike both reuse the code-signing cert in `CurrentUser\My` whose subject is `CN=Obelisk Dev`. The log should say `Dev certificate: reused`. If it says `Dev certificate: created`, stop. That cert is not the one already trusted.

From `C:\dev\obelisk`, in PowerShell:

```
npm ci
node node_modules\electron\install.js
npm ci --prefix spikes\s01
npm --prefix spikes\s01 run package:msix
powershell -NoProfile -ExecutionPolicy Bypass -File .\spikes\s01\install-spike.ps1 -Action Install -Msix .\spikes\s01\dist\msix\Obelisk-Spike-S01.msix
npm --prefix spikes/s01 run packaged -- --second "$env:USERPROFILE\Desktop"
```

`Install` does not import a certificate. The package is signed by the `CN=Obelisk Dev` certificate already in `LocalMachine\TrustedPeople`. `obelisk-spike-s01.cer` is written next to the MSIX. The log should say `Dev certificate: reused` before that file is written.

From `spikes\s01` the package command is `npm run package:msix`, and the run command is `npm run packaged -- --second "$env:USERPROFILE\Desktop"`.

`npm --prefix spikes/s01 run packaged` launches the installed `ObeliskSpikeS01.exe`, shows the window, and runs every case. The second folder in that command is the Desktop. To use a OneDrive-synced folder instead, pass that folder as `--second`. That path is the part that needs a person. The script then runs `confirm-outside.ps1` in the same PowerShell process that started the package, which is not inside the package.

The reports land in `C:\dev\obelisk\spikes\s01\output\packaged\`:

- `spike-report.json` from the packaged app
- `outside-report.json` from Get-Item
- `watch-outside-documents.json` and `watch-outside-second.json` from the outside watchers
- `walkthrough.png` and `results.png`

`outside-report.json` has a verdict for each file: `real`, `redirected`, `both`, `mismatch`, or `missing`. `real` means Get-Item opened the path the app wrote, the sha256 matched, and that path is not under the package LocalCache and not under the install folder.

The script prints `S01_VERDICT` and `S01_PATHS`. Those two lines, plus the verdicts and the watcher counts, are what goes in the manual section.

`Get-AppxPackage -Name Obelisk.Dev` and `Get-AppxPackage -Name Obelisk.SpikeS01` can both be installed. The install script checks that Obelisk.Dev's package full name does not change.

`npm start` in `spikes\s01`, with `CI` unset, opens the unpackaged window only. It does not answer the MSIX question.

### Optional: Start menu, then Get-Item by hand

The Start menu app is Obelisk Spike S-01. It asks for the second folder. Use Desktop, or pick a folder. It does not exit on its own. The outside check is not automatic on this path, because a process this app starts would still be inside the package. After the window says the run is written down, run this from a normal PowerShell window, not from inside the app:

```
powershell -NoProfile -ExecutionPolicy Bypass -File C:\dev\obelisk\spikes\s01\confirm-outside.ps1 -Claim "$env:USERPROFILE\Documents\Obelisk-Spike-S01\output\claim.json" -Report "$env:USERPROFILE\Documents\Obelisk-Spike-S01\output\outside-report.json"
```

That script runs Get-Item. The same check by hand, if you want to see the file itself:

```
Get-Item -LiteralPath "$env:USERPROFILE\Documents\Obelisk-Spike-S01\documents-new.txt"
Get-FileHash -LiteralPath "$env:USERPROFILE\Documents\Obelisk-Spike-S01\documents-new.txt" -Algorithm SHA256
Get-Item -LiteralPath "$env:USERPROFILE\Desktop\Obelisk-Spike-S01\second-new.txt"
```

Use the second folder you picked in place of Desktop. Compare the hash with `spike-report.json`.

## GitHub Actions

Workflow: `.github/workflows/spike-s01.yml`, on `windows-latest`, Node 22.23.4. The job stops after 40 minutes. Unpackaged `npm start` stops after 8 minutes. Packaging stops after 20 minutes. The install step stops after 15 minutes.

`CI` is set, so `npm start` is the unpackaged check. It does not install an MSIX. It does not write to Documents. The rename, read-only, and open cases run in `spikes/s01/output`.

The job then builds `Obelisk-Spike-S01.msix`, installs `Obelisk.SpikeS01`, launches it, and runs `confirm-outside.ps1` from the job. That PowerShell is not the packaged process. The second folder is the runner Desktop. The job then removes `Obelisk.SpikeS01` and the `Obelisk-Spike-S01` test folders. It does not remove Obelisk.Dev.

Those results are the GitHub Windows image. They are not Windows 11 Home 10.0.26300. The manual section is the run on this PC.

## Manual results

I ran the packaged app on this PC on Oct 27, 2026, at 1:35 PM Pacific, from commit `8f4c177`. I built the MSIX here with `npm --prefix spikes\s01 run package:msix` and installed it with `install-spike.ps1`. The package was Obelisk.SpikeS01 0.0.1.0, x64. Obelisk.Dev 0.1.14.0 stayed installed and was not replaced. The command was `npm --prefix spikes/s01 run packaged -- --second "$env:USERPROFILE\Desktop"`. The window ran mode auto, packaged, windowsStore. The system Node on that command was v24.21.0. The package itself was Electron 45.0.0 (Chrome 156.0.8078.48, Node 24.22.0). All six self-checks passed, and `walkthrough.png` and `results.png` were saved. These lines are from `outside-report.json`, which `confirm-outside.ps1` wrote outside the package.

Documents on this PC is OneDrive Known Folder Move. `app.getPath('documents')` returned `C:\Users\filli\OneDrive\Documents`, the same path as the known folder. The Documents case is the OneDrive case. The second folder was `C:\Users\filli\Desktop`, a plain local folder. The known Desktop is `C:\Users\filli\OneDrive\Desktop`, and this run did not use that path. `app.getPath('userData')` returned `C:\Users\filli\AppData\Roaming\Obelisk Spike S-01`.

`documents-new` was real. Get-Item opened `C:\Users\filli\OneDrive\Documents\Obelisk-Spike-S01\documents-new.txt`, the hash matched, and there was no copy under the package LocalCache.

`second-folder-new` was real. Get-Item opened `C:\Users\filli\Desktop\Obelisk-Spike-S01\second-new.txt`, the hash matched, and there was no LocalCache copy.

`rename-replace-documents` passed. The watcher inside the package saw 80 reads (47 of fill A, 33 of fill B). The outside watcher saw 99 reads (68 of fill A, 31 of fill B). Missing, partial, and locked reads were all 0. One replace in that OneDrive folder needed a second try after a transient rename failure. The file that stayed was a complete payload.

`rename-replace-second` passed. The inside watcher saw 76 reads (47 of fill A, 29 of fill B). The outside watcher saw 98 reads (69 of fill A, 29 of fill B). Missing, partial, and locked reads were all 0. Every rename took one attempt.

`rename-readonly` recorded `fs.rename` failing with EPERM, errno -4048. The old bytes stayed, the temp file was removed, and the replace finished after the read-only attribute was cleared.

`rename-open` recorded `fs.rename` failing with EPERM, errno -4048, while another process held the file and did not share delete. The old bytes stayed, the temp file was removed, and the replace finished after that handle closed.

`appdata-contrast` was redirected. The userData, Roaming, and Local files were missing at the paths the package named. Get-Item found them under `C:\Users\filli\AppData\Local\Packages\Obelisk.SpikeS01_09826e2d9xne4\LocalCache\`, in the Roaming and Local trees there. A redirected AppData file does not fail the Documents check. It is the contrast.

- [x] Pass. Get-Item from outside the package saw the Documents file and the second-folder file at the paths the app wrote, the hashes matched, and those paths were not under LocalCache. The outside watcher saw no missing file and no half-written file for either rename. Obelisk can keep writeAtomic as specified for those folders (NFR-10, NFR-12, R-06, R-07).
- [ ] Fail. Documents or the second folder was redirected, the hash did not match, or a watcher saw the target missing or half-written. writeAtomic has to change, and the architecture note for S-01 has to change with it (R-06, R-07).

Writes into Documents, including this OneDrive-synced Documents folder, and into the local Desktop folder, landed on the real path. The temp file and the rename replaced the target in one step. A reader never saw the file missing or half-written.

I then removed the package with `install-spike.ps1 -Action Uninstall`. The test files were still in `OneDrive\Documents\Obelisk-Spike-S01` and `Desktop\Obelisk-Spike-S01` after that.

### Acceptance criteria

- [x] Given the spike build; when I run S-01; then the findings note records the result and the build it ran on (R-06, R-07).
- [x] Given a pass; when the note is reviewed; then the dependent item keeps the architecture's design (R-06, R-07).
- [ ] Given a fail; when the note is reviewed; then the fallback is chosen: change writeAtomic per the findings and update the architecture (R-06, R-07).
- [x] Given the spike code; when the item closes; then no spike code is merged into src/ (R-06, R-07).

The fail line does not apply. The run passed, so the fallback is not chosen. The last line is ticked because this change does not add spike code under `src/`.

## Proposed notes

Not applied. `docs/SRS.md` and `docs/ARCHITECTURE.md` stay as they are. The 1.3 update uses the pass block. It has three findings from the run above.

### If this is a pass

Replace the UNVERIFIED sentence under the save contract in `docs/ARCHITECTURE.md` section 6.1 with:

> Checked in spike S-01 on Oct 27, 2026, Windows 11 Home 10.0.26300, Electron 45.0.0, commit 8f4c177. In the packaged MSIX, writeAtomic's temp file and rename landed in the real Documents folder and in the second folder. Documents on that PC is OneDrive Known Folder Move, `C:\Users\filli\OneDrive\Documents`, and `app.getPath('documents')` returned that path. The second folder was the plain local Desktop, `C:\Users\filli\Desktop`. Get-Item from outside the package opened those paths, the hashes matched, and the paths were not under the package LocalCache. The outside watcher saw only complete payloads during the replaces. `fs.rename` over the existing file is the one replace step on those folders.

Replace the UNVERIFIED sentence in section 5.6 with:

> Checked in spike S-01 on the same build. MSIX did not redirect Documents or the local Desktop. It did redirect `app.getPath('userData')` (`C:\Users\filli\AppData\Roaming\Obelisk Spike S-01`), Roaming, and Local into `C:\Users\filli\AppData\Local\Packages\Obelisk.SpikeS01_09826e2d9xne4\LocalCache\`. Those files are private to the package and are removed on uninstall. Settings and recovery files can live there. A document must not default to AppData.

In the section 6.1 retry row, add EACCES next to EPERM and EBUSY. Keep a few tries with a short backoff (three tries, 100 ms apart). One rename in the OneDrive Documents folder failed once with EPERM and the next try replaced the file. If the tries are used up, show the error, keep the previous file, and delete the temp file (NFR-10, R-07).

The read-only target and the open target both returned EPERM, errno -4048. The old bytes stayed, and the temp file was removed. The save error should say when the file is read-only, and when another program has it open.

The section 9.1 row for S-01 can say: checked Oct 27, 2026, commit 8f4c177, Electron 45.0.0, Windows 11 Home 10.0.26300, Documents (OneDrive) and the local Desktop were not redirected, and the rename replaced the file in one step.

### If this is a fail

Not used. The run passed, so this fallback is not chosen.

## Uninstall

From `C:\dev\obelisk`:

```
powershell -NoProfile -ExecutionPolicy Bypass -File .\spikes\s01\install-spike.ps1 -Action Uninstall
```

That removes `Obelisk.SpikeS01` only. It also deletes `Obelisk-Spike-S01` under Documents, under Desktop, and under the second folder recorded in `spikes\s01\output\packaged\second-path.txt`. It does not remove Obelisk.Dev, and it does not remove the `CN=Obelisk Dev` certificate.

The same removal without the test-folder cleanup:

```
Get-AppxPackage -Name Obelisk.SpikeS01 | Remove-AppxPackage
```
