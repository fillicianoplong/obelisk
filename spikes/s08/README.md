# Spike S-08: utilityProcess decoding

Throwaway check for issue 15. Nothing here is part of the app, and nothing here is imported from `src/`.

## Question

Can `.obk` decoding run in a sandboxed Electron 45 `utilityProcess`, and does a FormatCodec built on yauzl 3.4.0 and yazl 3.3.1 pass the hostile-file checks there?

## What was tested

A small FormatCodec under `spikes/s08/src/` reads with yauzl and writes with yazl. The same checks run under plain Node and inside an Electron 45 utility process (`utilityProcess.fork`, service name `obk-decode`). Hostile archives are generated in code, including a zip bomb whose local and central headers both claim 64 uncompressed bytes. Caps are enforced by counting inflated bytes. A file that fails a check is hashed before and after the open.

Out of scope, and not claimed: H-10 through H-32 (schema, JSON duplicates, image headers, frame counts, link schemes, export escaping). A successful open in this spike only means the archive passed the section 6.6 archive rules that H-01 to H-09 cover.

MB in this note is 1024 × 1024 bytes, matching section 6.6. 25 MB is 26,214,400 bytes, 20 MB is 20,971,520 bytes, 200 MB is 209,715,200 bytes, and 250 MB is 262,144,000 bytes.

## Versions

| Piece | Version |
|---|---|
| yauzl | 3.4.0 |
| yazl | 3.3.1 |
| @types/yauzl | 3.4.0 |
| @types/yazl | 3.3.1 |
| Electron | 45.0.0 (Chrome 156.0.8078.48) |
| Node, the check runner | 22.23.4 |
| Node inside the utility process | 24.22.0 (the Node that Electron 45 ships) |

yauzl and yazl are dependencies of `spikes/s08/package.json` only, with `save-exact=true` and this directory's own lockfile. They are not in the app `package.json`, so the packager and the MSIX build do not ship them. Electron is the app's existing devDependency. The spike launches that binary by the path in `node_modules/electron/path.txt`. Putting the two libraries in the app's devDependencies would still have kept them out of a production install, but a later `npm install` at the repo root would be one step away from a dependency the app does not use yet. A spike-local package cannot be required from `src/` without an explicit path, and the app build does not look there.

## Where it ran

The command is `npm start` in `spikes/s08` (typecheck, compile, generate samples, run under Node, fork the utility process, compare the two results). Workflow: `.github/workflows/spike-s08.yml`, on `windows-latest` and `ubuntu-latest`, Node 22.23.4. It does not run the app's typecheck, lint, or test jobs. The Ubuntu job starts Electron under `xvfb-run` because that runner has no display.

### Windows

Two `windows-latest` jobs, both with the host not started with `--no-sandbox`. The image is the same, and the case lists match each other and match Linux.

| Field | Run [40442767845](https://github.com/fillicianoplong/obelisk/actions/runs/40442767845) | Run [40443190314](https://github.com/fillicianoplong/obelisk/actions/runs/40443190314) |
|---|---|---|
| Runner | GitHub Actions 1000000495 | GitHub Actions 1000000498 |
| Image | `20261021.278.1` (`win25-vs2026`) | `20261021.278.1` (`win25-vs2026`) |
| OS | Windows Server 2025 Datacenter, `10.0.26100` | Windows Server 2025 Datacenter, `10.0.26100` |
| `getAppMetrics()` sandboxed | `false` | `false` |
| `getAppMetrics()` integrityLevel | `high` | `high` |

Both jobs: Node 22.23.4 on the runner, Electron 45.0.0, Chrome 156.0.8078.48, Node 24.22.0 inside the utility process, yauzl 3.4.0, yazl 3.3.1. `getAppMetrics()` type `Utility`, name `obk-decode`, serviceName `node.mojom.NodeService`. Child `process.type` is `utility`. Child `process.sandboxed` is unset. The report is `ok`, with `sameResults`, `nodePass`, and `electronPass` all true, and no failures.

`sandboxed` and `integrityLevel` are the Windows fields on `ProcessMetric` (filled on Windows and macOS, empty on Linux). Integrity `high` is the normal level for an unsandboxed process, not the `untrusted` or `low` level of a Chromium sandbox.

### Linux, with a display

A machine with a display, kernel `6.12.94+`, `#1 SMP PREEMPT_DYNAMIC Mon Oct 19 22:12:29 UTC 2026`. The host was not started with `--no-sandbox`.

- `process.type` in the child is `utility`. `process.sandboxed` is unset.
- `app.getAppMetrics()` names the child `obk-decode`, type `Utility`, service `node.mojom.NodeService`. On Linux that API leaves `sandboxed` and `integrityLevel` empty.
- `/proc/self/status` for the child: Seccomp `0`, NoNewPrivs `0`, CapEff `0000000000000000`. Seccomp 0 means no seccomp filter.
- The child's `/proc/self/cmdline` contains `--type=utility` and `--service-sandbox-type=none`.
- The report is `ok`, and the case list matches Windows.

### Linux, GitHub `ubuntu-latest`

Image `20261023.334.3` (`ubuntu24`), kernel `6.17.0-1022-azure`.

Run 40442767845 (runner GitHub Actions 1000000494) passed every Node sample, and that case list matches Windows. Electron did not start. The setuid sandbox helper aborted (`chrome-sandbox` is not owned by root with mode 4755). The spike retried the host with `--no-sandbox`, and that retry exited because the runner had no display (`Missing X server or $DISPLAY`).

Run 40443190314 (runner GitHub Actions 1000000499) starts the host under `xvfb-run`. The setuid helper still aborts, the report records `hostNoSandbox: true`, and the utility process then runs. Its command line contains `--type=utility`, `--service-sandbox-type=none`, and `--no-sandbox` (the host flag, inherited). Seccomp is 0 and NoNewPrivs is 0. `process.type` is `utility`. `process.sandboxed` is unset. `getAppMetrics()` leaves `sandboxed` and `integrityLevel` empty on Linux. The case list matches the Windows utility process. This `--no-sandbox` retry is a limit of the GitHub Ubuntu image. The Windows jobs did not use it, and they still report the utility process as not sandboxed.

## How the checks are done

yauzl 3.4.0 is opened with `lazyEntries`, `autoClose: false`, `decodeStrings: false`, `strictFileNames: true`, and `validateEntrySizes: false`.

`validateEntrySizes` stays off on purpose. With it on, yauzl stops an entry when the inflated output passes the size in the header. A bomb that claims 64 bytes would die at 64 bytes, which trusts the header and never reaches the 25, 20, or 250 MB caps. This codec counts the bytes it actually inflates and destroys the stream once a cap is passed. The counted total includes only the bytes that fit, so a stop at the cap reports exactly 25, 20, or 250 MB, not a chunk past it. If an entry finishes under the cap and the count is not the declared uncompressed size, the reason is `declared-size-mismatch`. yauzl does not check the payload CRC, so the codec computes it while it reads.

`decodeStrings` stays off because yauzl otherwise rewrites `\` to `/` and then rejects some names itself, which hides the reason. Names are the central-directory bytes (`fileNameRaw`), read as Latin-1. The codec classifies them. Encrypted entries, methods other than store (0) and deflate (8), directories, symlinks, and a per-entry disk number other than 0 are refused before any payload is read. Exact and case-only duplicate names are refused before the allowlist, so `manifest.json` plus `Manifest.json` is a case duplicate and not a generic bad name. The allowlist is `manifest.json`, `document.json`, and `images/` plus 64 lowercase hex digits plus `.png`, `.jpg`, `.gif`, or `.webp`. Local and central headers must agree on name bytes, method, CRC, compressed size, uncompressed size, and flags. `manifest.json` and `document.json` must both be present. Payloads are read only after those checks.

The file-size cap uses `stat` and does not open the zip. The entry cap uses `entryCount` from the end of the central directory and returns before `eachEntry`, so a 2,001-entry archive does not have its entry payloads read. yauzl has already read the end-of-central-directory record to learn that count, which is the "central directory first" behavior in ADR-013. The unchanged-file check still hashes the bytes on disk, including the sparse file over 200 MB, so a refusal can be shown not to have written.

Multi-disk is refused from the end-of-central-directory disk number, and again from each central-directory disk-number-start field. yauzl does not keep that per-entry field, so the codec reads those bytes itself and does not read entry payloads to do it.

The bomb's compressed size in both headers is the real deflate size, so the inflater is given the whole stream. The uncompressed size in both headers is 64. The two headers agree with each other. The lie is against the bytes. A second sample declares 32 bytes and really holds 1,000, which is under every cap, and is refused as `declared-size-mismatch` after the real 1,000 bytes are read. That is the check that a small declared size is not trusted when the entry does fit in the cap.

Hostile names are not written with yazl. yazl rewrites backslashes and rejects `..` and absolute paths, so those samples are built by the spike's own zip writer. Legitimate files (the valid open, and the 200-image save) are written with yazl: fixed mtime `2020-01-01T00:00:00Z`, `forceDosTimestamp`, compression level 6, mode `0o100644`. Byte-identical means two encodes in the same runtime. Node's zlib and Electron's zlib are not required to match each other, and those hashes are not compared across runtimes. The flag that the two saves matched is compared, and it is true in both.

The utility process writes its report and then exits. The pipe back to the host stays open for the life of the process, so the event loop would not drain on its own. After the report is on disk the active handles are that pipe. Exiting is the child finishing, not a second decoder.

## Results

Windows Node, the Windows utility process, and Linux Node refused the same samples for the same reasons, with the same byte counts. The Linux utility process on a machine with a display did the same. yauzl and yazl did not fail a check, so this note does not propose replacing them.

### Sandbox: fail

Electron 45.0.0's `ForkOptions` (`utilityProcess.fork`) has no `sandbox` field. The fields it does have are `env`, `execArgv`, `cwd`, `session`, `partition`, `stdio`, `serviceName`, `allowLoadingUnsignedLibraries` (macOS), `disclaim` (macOS TCC, not a sandbox), and `respondToAuthRequests`. The spike still passes `sandbox: true`. The types do not declare it, and the process that comes back is not sandboxed.

On Windows, with the host not started with `--no-sandbox`, `app.getAppMetrics()` reports `sandboxed: false` and `integrityLevel: "high"` for the `obk-decode` utility process. On Linux, with the host also not started with `--no-sandbox`, the child command line contains `--service-sandbox-type=none` and Seccomp is 0. `process.sandboxed` is unset in both. That flag is documented for a sandboxed renderer.

This does not pass "decoding runs in a sandboxed utilityProcess". Decoding still runs in the utility process. See Decision.

### Hostile samples: pass

| Sample | Reason | Payloads read | Bytes counted |
|---|---|---|---|
| H-01 file over 200 MB (209,715,201 bytes) | `file-too-large` | 0, zip not opened | 0 |
| H-01 2,001 entries | `too-many-entries` | 0 | 0 |
| H-02 document bomb, declared 64, real 25 MB + 1 | `document-cap` | manifest and the document | 26,214,450, of which the document contributed 26,214,400 |
| H-02 image bomb, declared 64, real 20 MB + 1 | `image-cap` | manifest, document, image | 20,971,601, of which the image contributed 20,971,520 |
| H-02 total, honest per-entry sizes, last image crosses 250 MB | `total-cap` | 15 | 262,144,000 exactly |
| H-02 declared 32, real 1,000 | `declared-size-mismatch` | 2 | 1,050 |
| H-03 encrypted, method 99, multi-disk, entry on another disk | `encrypted`, `unsupported-compression`, `multi-disk` | 0 | 0 |
| H-04 `../`, nested `..`, leading `/`, backslash, `C:`, `D:` | `dot-dot`, `leading-slash`, `backslash`, `drive-letter` | 0 | 0 |
| H-05 UNC, `//server`, `:Zone.Identifier`, `::$DATA`, `CON`, `CON.txt`, `con`, `images/CON.png` | `network-path`, `stream-suffix`, `device-name` | 0 | 0 |
| H-06 `Manifest.json` beside `manifest.json`; two `document.json` | `case-duplicate`, `repeated-name` | 0 | 0 |
| H-07 local name and CRC differ from the central header | `header-mismatch` | 0 | 0 |
| H-08 directory, symlink, name `nested.zip`, image bytes that are a zip | `directory`, `symlink`, `nested-zip` | 0, or 1 for the inner signature | 0, or 120 for the inner signature |
| H-09 missing manifest or document | `missing-manifest`, `missing-document` | 0 | 0 |
| yazl-written archive with one image | `ok` | 3 | 312 |

The three bombs are smaller on disk than the bytes they inflate to (document bomb 119,254 bytes on disk, image bomb 96,636, total-cap archive 1,192,992). Reading did not continue to the real uncompressed size.

### Byte-identical save: pass

Two yazl encodes of the same 200-image document were equal (`saveIdentical: true`) under Node and in the utility process. Each archive is 64,677 bytes, 202 entries, 43,294 uncompressed bytes. Opening the buffer succeeded.

### Refused files unchanged: pass

Every refused sample, and the valid archive, had the same size, the same sha256, and the same mtime after the open as before it. The codec does not write the file it is reading. yauzl is opened with `fs` read mode.

## Decision

Decoding of `.obk` files runs in an Electron utilityProcess. Electron 45 does not OS-sandbox that process (`sandboxed: false` and integrity level `high` on Windows; `--service-sandbox-type=none` and Seccomp 0 on Linux). That is accepted. The utility process still isolates crashes and memory from main and from other tabs, which is the architecture's design. Main is equally unsandboxed and more privileged, so this is no worse than decoding in main.

Rejected: decode in main. Same sandbox status, more privilege, and no crash isolation from the rest of the app.

Not pursued now: a hidden sandboxed renderer with a pure-JS ZIP library. A sandboxed renderer has no Node, so it cannot run yauzl, and switching libraries would partly reverse ADR-013. That can be revisited later.

Fallback, if a future Electron version or a defect forces decoding out of the utility process: decode in main, using the same yauzl 3.4.0 and yazl 3.3.1 code and the same checks. The defence in either place is the hostile-ZIP checks and the real-byte caps (25 MB, 20 MB, and 250 MB), which this spike passed.

## Proposed documentation edit

Do not apply this in the spike. The architecture should later say that the utility process is not OS-sandboxed in Electron 45. Suggested replacement for the section 6.4 line:

> **UNVERIFIED:** Decoding .obk files in a sandboxed utilityProcess instead of main. Check in spike S-08.

Suggested text:

> **Checked in spike S-08 (Electron 45.0.0, Windows image 20261021.278.1):** Decoding runs in a utilityProcess, for crash and memory isolation from main. That process is not OS-sandboxed in Electron 45. `utilityProcess.fork` has no sandbox option. On Windows, with the host not started with `--no-sandbox`, `getAppMetrics()` reports `sandboxed: false` and integrity level `high`. On Linux the process command line contains `--service-sandbox-type=none` and Seccomp is 0. The defence is the hostile-file checks and the real-byte caps. yauzl 3.4.0 and yazl 3.3.1 passed H-01 to H-09, those caps, a byte-identical 200-image save, and unchanged refused files under Node 22.23.4 and inside that utility process, with the same byte counts on Windows and on Linux. If a later Electron version or a defect forces decoding out of the utility process, it moves to main with the same libraries and the same checks. ADR-013 stays.

Related sentence in the ADR-013 context:

> Decoding may move to a sandboxed utilityProcess (R-08, spike S-08).

Suggested replacement:

> Decoding runs in a utilityProcess. Spike S-08 found that an Electron 45 utilityProcess is not OS-sandboxed. The hostile-file checks and the real-byte caps are the defence. If that process cannot be used, decoding falls back to main.
