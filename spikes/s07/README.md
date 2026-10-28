# Spike S-07: safeStorage in MSIX

Throwaway check for issue 14. Nothing here is part of the app, and nothing here is imported from `src/`.

## Question

When Obelisk runs as a packaged MSIX, does Electron's async safeStorage encrypt and decrypt a saved signature, and how do the encryption-unavailable and re-encrypt states show up?

NFR-08 says each saved signature is encrypted with safeStorage before it is written. NFR-09 says the app saves or shows no signature, and says so, while safeStorage reports encryption unavailable. ADR-007 stores one PNG per signature, encrypted with the async API. sig:get decrypts one. Unavailable or temporarily unavailable: save and show nothing, delete nothing. Re-encrypt when safeStorage asks. OD-15 is that decision.

On a pass, the dependent item keeps the architecture's design.

On a fail, the fallback is: keep signatures unsaved when encryption is unavailable (NFR-09).

The pass/fail line is the packaged round trip, including a restart. The unavailable and re-encrypt rows are written down either way. If a state cannot be produced on Windows, that is the finding.

## Package

The packaged app this spike builds is not Obelisk.Dev. The identity is `Obelisk.SpikeS07`, display name Obelisk Spike S-07, publisher `CN=Obelisk Dev`, version 0.0.1.0. Installing it does not replace Obelisk.Dev, and it does not register `.obk`. It is full trust, x64, Electron 45. The manifest has a `windows.appExecutionAlias` of `ObeliskSpikeS07.exe` and no file type.

`npm run package:msix` at the repo root and this spike both reuse the code-signing cert in `CurrentUser\My` whose subject is `CN=Obelisk Dev`. The log should say `Dev certificate: reused`. If that cert is missing, the script stops. It does not create a certificate. If the log says it would create one, stop.

## What Electron 45 does on Windows

I read Electron 45.0.0 `shell/browser/api/electron_api_safe_storage.cc` and the Chromium 156.0.8078.48 `DPAPIKeyProvider` and `Encryptor` it links. This is the source. The Windows result is the manual section.

The sync methods `isEncryptionAvailable`, `encryptString`, and `decryptString` are deprecated and due for removal in Electron 46. The async methods are `isAsyncEncryptionAvailable`, `encryptStringAsync`, and `decryptStringAsync`.

`decryptStringAsync` resolves to `{ result, shouldReEncrypt }`. `shouldReEncrypt` is true only when decryption succeeded with a key provider that is not the provider used for new encryption. On Windows, Electron registers one async provider, DPAPI, tag `v10`. A successful decrypt of `v10` data therefore reports `shouldReEncrypt` false. There is no second provider to force the flag from the public API.

If decryption fails because that `v10` key is in the key ring with no key, the promise rejects with `safeStorage.decryptStringAsync is temporarily unavailable. Please try again.` That is the temporarily unavailable state. The DPAPI provider returns that status only when `CryptUnprotectData` fails on the stored key.

`OSCrypt::Init` runs before that provider. If DPAPI cannot decrypt the stored key, and a new key can be stored, Init generates a new key and writes it. The provider then sees the new key. Old ciphertext fails with `Error while decrypting the ciphertext provided to safeStorage.decryptStringAsync.` The temporarily unavailable string is not returned. `isEncryptionAvailable()` is true again, and new encrypts work.

If the stored key does not start with `DPAPI`, Init fails and does not replace it. `isEncryptionAvailable()` is false. `encryptStringAsync` rejects. The provider treats that as permanently unavailable, so a `v10` decrypt does not use the temporarily unavailable string.

`isAsyncEncryptionAvailable()` resolves true once the async encryptor has finished initializing. In this Electron build that resolution is not the same check as "a key is loaded."

On Windows the key is a random AES-256-GCM key stored in `Local State` as `os_crypt.encrypted_key`, wrapped with DPAPI. The ciphertext is prefixed `v10`. DPAPI is the current user's logon secret. It protects the key from other Windows users, not from other apps of the same user.

## Cases

| # | Case | What it answers |
|---|---|---|
| 1 | `encrypt` | Round trip in the packaged app. `encryptStringAsync`, then `decryptStringAsync`, then the ciphertext is written. The file must not hold the name or the PNG text. |
| 2 | `decrypt` | The same ciphertext after a new process. This is the restart. It also records `shouldReEncrypt`. |
| 3 | `invalid-header` | `Local State` is given a key that does not start with `DPAPI`. The probe records `isEncryptionAvailable`, `isAsyncEncryptionAvailable`, and the encrypt and decrypt errors. The original key and the ciphertext are put back. |
| 4 | `dpapi-fail` | `Local State` is given a `DPAPI` prefix plus bytes `CryptUnprotectData` cannot open. The probe records whether the temporarily unavailable string appears. The original key and the ciphertext are put back. |

Cases 1 and 2 are the pass/fail. Cases 3 and 4 are how the unavailable states show, or the finding that Windows did not produce one. `shouldReEncrypt` on case 2 is the re-encrypt row. If it is false, and case 4 does not produce a second provider, the re-encrypt state was not produced on Windows.

The sample is a JSON string: a name, a fixed time, and a 1x1 PNG in base64. The packaged app writes that ciphertext to `cipher.bin` in the output folder and to `signature.sig` under `app.getPath('userData')`. The key stays in that userData `Local State`. S-01 found that MSIX redirects that AppData path into the package LocalCache. Case 2 reads both copies.

## Window

The window is shown as soon as it is created, with background `#F4F1EA`, and it is not resized after that. On Windows the caption is the same hidden title bar and 32px overlay the Obelisk window uses. The page keeps 32px clear at the top. The `s07:` scheme is registered with the same privileges as `app:`: standard, secure, fetch, cors, stream, `bypassCSP` false, service workers off. The page response carries the same Content-Security-Policy shape, with `s07:` in place of `app:`, and no `unsafe-eval` and no `unsafe-inline`. Styles are in `renderer.css`. Press F12 for DevTools, or start with `--devtools`.

The page lists the phase, `isEncryptionAvailable`, `isAsyncEncryptionAvailable`, the match, `shouldReEncrypt`, and any error text. The app writes `walkthrough.png` when that page is up. A command launch exits after the report is written. A Start-menu launch stays open. The numbered steps do not use the Start menu.

## Smart App Control

On this PC Smart App Control started out enforcing. `HKLM\SYSTEM\CurrentControlSet\Control\CI\Policy` had `VerifiedAndReputablePolicyState` = 1. Code Integrity events 3033 and 3077 said the dev-signed exe did not meet the Enterprise signing level requirements. The policy id was `{0283ac0f-fff1-49ae-ada1-8a933130cad6}`.

The first attempt started `C:\Program Files\WindowsApps\Obelisk.SpikeS07_0.0.1.0_x64__09826e2d9xne4\ObeliskSpikeS07.exe` with `Process.Start`. Windows returned "An Application Control policy has blocked this file". The package then gained an `ObeliskSpikeS07.exe` app execution alias, the same kind Spike S-02 used. With Smart App Control still enforcing, that alias was blocked too, both from `Process.Start` and from ShellExecute. `IApplicationActivationManager` activation was blocked as well. Turning Smart App Control off is what let the runs below start.

The script still starts `%LOCALAPPDATA%\Microsoft\WindowsApps\ObeliskSpikeS07.exe`. It passes `--phase` and `--output` on the command line, and it also sets `OBELISK_S07_PHASE` and `OBELISK_S07_OUTPUT`. The command line wins if both are present. The recorded `argv` is the real exe path under `C:\Program Files\WindowsApps` followed by `--phase` and `--output`, which is what the alias launch resolved to once Smart App Control was off.

Finding: a dev-signed MSIX can't be started at all on a PC with Smart App Control enforcing, so manual testing needs it off (or a trusted signature), and the alias change alone didn't fix it. The alias launch stays. Obelisk's scripts keep using the alias rather than the WindowsApps path.

## Run it on this PC

Windows 11 Home 10.0.26300. The clone is `C:\dev\obelisk`. Node on this PC is v24.21.0. The GitHub job uses Node 22.23.4. Those do not have to match. The package is Electron 45.0.0 from the app dependency, not from the system Node.

The dev certificate is already in `LocalMachine\TrustedPeople`. Do not run `ensure-dev-cert.ps1` on this PC. That script is only for the GitHub runner, which has no cert yet. Smart App Control has to be off for these commands. With it enforcing, the dev-signed package does not start.

From `C:\dev\obelisk`, in PowerShell, in this order. Each command is one line.

1. `npm ci`
2. `node node_modules\electron\install.js`
3. `npm ci --prefix spikes\s07`
4. `npm --prefix spikes\s07 run package:msix`
5. `powershell -NoProfile -ExecutionPolicy Bypass -File .\spikes\s07\install-spike.ps1 -Action Install -Msix .\spikes\s07\dist\msix\Obelisk-Spike-S07.msix`
6. `powershell -NoProfile -ExecutionPolicy Bypass -File .\spikes\s07\install-spike.ps1 -Action Run -Phase Encrypt`
7. `powershell -NoProfile -ExecutionPolicy Bypass -File .\spikes\s07\install-spike.ps1 -Action Run -Phase Decrypt`
8. `powershell -NoProfile -ExecutionPolicy Bypass -File .\spikes\s07\observe-states.ps1`
9. `powershell -NoProfile -ExecutionPolicy Bypass -File .\spikes\s07\collect-results.ps1`
10. `powershell -NoProfile -ExecutionPolicy Bypass -File .\spikes\s07\install-spike.ps1 -Action Uninstall`

Step 4 should log `Dev certificate: reused`. If it stops because it would create a certificate, stop. Do not install that package.

Step 5 removes `Obelisk.SpikeS07` if it is already installed, then installs this build. The `Obelisk.SpikeS07` 0.0.1.0 package already on this PC is replaced, including the new alias. You do not uninstall it first. Step 5 prints `S07_DEV_BEFORE` and `S07_DEV_AFTER`. Those two Obelisk.Dev values have to match. Obelisk.Dev 0.1.14.0 is already installed on this PC. The script does not remove it, and it does not import a certificate.

Steps 6, 7, and 8 start `%LOCALAPPDATA%\Microsoft\WindowsApps\ObeliskSpikeS07.exe` and print `S07_ALIAS` with that path. They pass `--phase` and `--output`. They do not start the exe under `C:\Program Files\WindowsApps`.

Step 6 is the round trip. It writes `spikes\s07\output\packaged\report-encrypt.json`, `cipher.bin`, and `walkthrough.png`. Read `encryptionAvailable`, `asyncEncryptionAvailable`, `plaintextMatch`, `leaks`, `shouldReEncrypt`, `deprecationWarnings`, and `argv`.

Step 7 is the restart. It writes `report-decrypt.json`. Read `plaintextMatch`, `restart`, and `shouldReEncrypt`. The process is new. The key is the one the first process stored.

Step 8 runs the invalid-header case and the dpapi-fail case, restores `Local State`, and decrypts again. It writes `states-report.json`. Read each experiment's `encryptionAvailable`, `asyncEncryptionAvailable`, `encryptError`, `decryptError`, and `temporarilyUnavailable`. `cipherUnchanged` and `restoredDecryptMatch` should both be true. Nothing in those two cases is allowed to delete the ciphertext.

Step 9 copies the reports to `C:\Users\filli\s07-results` and prints `S07_COLLECTED`. Step 10 removes `Obelisk.SpikeS07` only. It does not remove `C:\Users\filli\s07-results`, and it does not remove the `CN=Obelisk Dev` certificate.

These commands write the ciphertext under `spikes\s07\output\packaged`, not under Documents. Documents on this PC is `C:\Users\filli\OneDrive\Documents`. The key is still under the package's app data. If Windows redirects that path, `observe-states.ps1` edits the LocalCache copy, not the path the package thinks it used.

## GitHub Actions

Workflow: `.github/workflows/spike-s07.yml`, on `windows-latest`, Node 22.23.4. The job stops after 40 minutes. Unpackaged `npm start` stops after 8 minutes. Packaging stops after 20 minutes. The install step stops after 20 minutes.

`CI` is set, so `npm start` is the unpackaged check. It does not install an MSIX. It launches Electron, encrypts the sample, launches Electron again, and decrypts it. It requires `walkthrough.png`.

The runner does not have the `CN=Obelisk Dev` cert, so the job stores one in `CurrentUser\My` before packaging. `package:msix` then has to log `Dev certificate: reused`. The job fails if that line is missing, or if the package step created a certificate.

The job installs `Obelisk.SpikeS07`, then starts Encrypt and Decrypt through the `ObeliskSpikeS07.exe` alias. If that session encrypted, it also runs `observe-states.ps1` and requires the ciphertext to survive and to decrypt after the key is restored. If the session cannot encrypt, the job prints `S07_SESSION unavailable` and still requires the report, the picture, Electron 45.0.0, `windowsStore`, and an unchanged Obelisk.Dev. It then removes `Obelisk.SpikeS07`. It does not remove Obelisk.Dev. The GitHub image does not enforce Smart App Control. The alias launch is still the one the job uses.

That packaged check is the GitHub Windows image. It is not Windows 11 Home 10.0.26300. The manual section is the run on this PC.

## Manual results

Run on this PC on October 27, 2026, at 5:16 PM Pacific, from commit `a9f81193dc9a9e668a11510128986084c26bb1cb`. Windows 11 Home 10.0.26300. Smart App Control was off for this run. The package was Obelisk.SpikeS07 0.0.1.0 (`Obelisk.SpikeS07_0.0.1.0_x64__09826e2d9xne4`), Electron 45.0.0 (Chrome 156.0.8078.48, Node 24.22.0). Obelisk.Dev 0.1.14.0 stayed installed. The spike package was removed afterward. Reports are the files under `spikes\s07\output\packaged`, copied to `C:\Users\filli\s07-results`.

| Case | Result |
|---|---|
| encrypt round trip | Exit 0. `plaintextMatch` true, `leaks` empty, `sessionEncryption` true. |
| restart | Exit 0. `plaintextMatch` true, `restart` true, `cipherUnchanged` true. |
| isEncryptionAvailable | true on encrypt and on the restart. false for invalid-header. true for dpapi-fail. |
| isAsyncEncryptionAvailable | true on encrypt, on the restart, and in both state experiments, including invalid-header. |
| unavailable | The temporarily unavailable string never appeared. invalid-header: encrypt and decrypt both throw `Error while encrypting the text provided to safeStorage.encryptStringAsync.` and `Error while decrypting the ciphertext provided to safeStorage.decryptStringAsync.` dpapi-fail: encrypt succeeded, decrypt throws that same generic decrypt error. `cipherUnchanged` true and `restoredDecryptMatch` true. |
| re-encrypt | `shouldReEncrypt` false on encrypt and on the restart. The re-encrypt state was not produced. |

`deprecationWarnings` is empty. The sync calls still printed the three `(electron)` removal lines on stderr, because the spike called `isEncryptionAvailable`, `encryptString`, and `decryptString` once.

A bad key shows up only as a generic decrypt error, so the app must treat any decrypt failure as signature unavailable. `isAsyncEncryptionAvailable` staying true is not the unavailable check.

- [x] Pass. The packaged round trip and the restart both returned the signature, and the ciphertext held no readable name or PNG. On a pass, the dependent item keeps the architecture's design.
- [ ] Fail. The packaged app did not encrypt and decrypt the signature. On a fail, the fallback is: keep signatures unsaved when encryption is unavailable (NFR-09).

### Acceptance criteria

- [x] Given the spike build; when I run S-07; then the findings note records the result and the build it ran on (OD-15).
- [x] Given a pass; when the note is reviewed; then the dependent item keeps the architecture's design (OD-15).
- [ ] Given a fail; when the note is reviewed; then the fallback is chosen: keep signatures unsaved when encryption is unavailable (NFR-09) (OD-15).
- [x] Given the spike code; when the item closes; then no spike code is merged into src/ (OD-15).

## Proposed notes

Not applied. `docs/SRS.md` and `docs/ARCHITECTURE.md` stay as they are. This run is a pass, so the 1.3 update uses the pass block. The fail block is not the outcome.

### Source, either way

Electron 45 deprecates `isEncryptionAvailable`, `encryptString`, and `decryptString`, and removes them in Electron 46. Obelisk calls `isAsyncEncryptionAvailable`, `encryptStringAsync`, and `decryptStringAsync`. `decryptStringAsync` returns `result` and `shouldReEncrypt`. A rejected decrypt whose message says temporarily unavailable is the NFR-09 temporarily unavailable state. On that result, and when encryption is unavailable, save nothing and delete nothing. This run never produced that string. A bad key shows up only as a generic decrypt error, so the app must treat any decrypt failure as signature unavailable.

### If this is a pass

Replace the UNVERIFIED sentence under the app data records in `docs/ARCHITECTURE.md` section 6.8 with:

> Checked in spike S-07 on October 27, 2026, Windows 11 Home 10.0.26300, Electron 45.0.0, commit a9f81193dc9a9e668a11510128986084c26bb1cb, package Obelisk.SpikeS07 0.0.1.0. encryptStringAsync and decryptStringAsync round-tripped a signature in the packaged MSIX, and the same ciphertext decrypted after a new process. isEncryptionAvailable was true. isAsyncEncryptionAvailable was true. The unavailable rows: a stored key that does not start with DPAPI makes isEncryptionAvailable false, and both encrypt and decrypt throw the generic error. A DPAPI prefix that CryptUnprotectData cannot open leaves isEncryptionAvailable true, and the old ciphertext fails with `Error while decrypting the ciphertext provided to safeStorage.decryptStringAsync.` The temporarily unavailable string did not appear. shouldReEncrypt was false. A bad key shows up only as a generic decrypt error, so the app must treat any decrypt failure as signature unavailable. Saved signatures keep ADR-007.

Replace the UNVERIFIED sentence in `docs/SRS.md` section 7.2 with:

> Checked in spike S-07 on the same build. Obelisk uses the async safeStorage API. The sync methods are deprecated in Electron 45 and due for removal in Electron 46. DPAPI inside the MSIX package encrypted and decrypted the signature, including after a restart. While encryption is unavailable, nothing is saved or deleted (NFR-09). The temporarily unavailable string did not appear. A bad key shows up only as a generic decrypt error, so the app must treat any decrypt failure as signature unavailable: save nothing and delete nothing.

The section 9.1 row for S-07 can say: checked October 27, 2026, commit a9f81193dc9a9e668a11510128986084c26bb1cb, Electron 45.0.0, Windows 11 Home 10.0.26300, the async API round-tripped in the MSIX package, shouldReEncrypt was false, and a bad key is a generic decrypt error, so any decrypt failure means the signature is unavailable.

### If this is a fail

Replace the UNVERIFIED sentence under the app data records in `docs/ARCHITECTURE.md` section 6.8 with:

> Checked in spike S-07 on [date], Windows 11 Home 10.0.26300, Electron 45.0.0, commit [commit], package Obelisk.SpikeS07 0.0.1.0. The async safeStorage API did not encrypt and decrypt inside the MSIX package. Saved signatures stay unsaved while encryption is unavailable (NFR-09). ADR-007's encrypted file waits until a later check passes.

Replace the UNVERIFIED sentence in `docs/SRS.md` section 7.2 with:

> Checked in spike S-07 on the same build. Async safeStorage did not provide DPAPI encryption inside the MSIX package. The app saves no signature while encryption is unavailable, and it says so (NFR-09).

The section 9.1 row for S-07 can say: checked [date], commit [commit], Electron 45.0.0, Windows 11 Home 10.0.26300, the fallback is to keep signatures unsaved when encryption is unavailable.

## Uninstall

From `C:\dev\obelisk`, after `collect-results.ps1`:

```
powershell -NoProfile -ExecutionPolicy Bypass -File .\spikes\s07\install-spike.ps1 -Action Uninstall
```

That removes `Obelisk.SpikeS07` only. It also deletes `Obelisk-Spike-S07` under Documents and Desktop. It does not remove Obelisk.Dev, it does not remove the `CN=Obelisk Dev` certificate, and it does not remove `C:\Users\filli\s07-results`.

The same removal without the test-folder cleanup:

```
Get-AppxPackage -Name Obelisk.SpikeS07 | Remove-AppxPackage
```
