# Spike S-06: GIF and WebP frame counting

Throwaway check for issue 13. Nothing here is part of the app, and nothing here is imported from `src/`.

## Question

Can I count the frames of a GIF or a WebP, including an animated WebP, and read each frame's size, without decoding pixels? And can the sandboxed renderer in Electron 45 make a PNG of the first frame, with no Node in that page?

## What was tested

Two walkers under `spikes/s06/src/` read the container and stop before the pixels. `gif-walk.ts` walks GIF87a and GIF89a blocks. `webp-walk.ts` walks RIFF chunks, including ANMF frames and the VP8 or VP8L dimension fields inside them. Neither allocates a pixel buffer. `decodedPixelBytes` stays 0, and a check fails if it does not.

The same files are then opened in a hidden `BrowserWindow` (`sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, `webSecurity: true`). The page is a classic script with no imports. It decodes frame 0 with `ImageDecoder`, draws it to a canvas, and encodes `image/png` with `canvas.toBlob`. It also draws the file with an `img` element and with `createImageBitmap`, so I can see whether those three agree. `ImageDecoder.frameCount` is the Chromium count I compare with the walk.

The samples are built in code: static and animated GIF, GIF87a, interlaced GIF, a local palette, a transparent half, a frame that does not cover the logical screen, comment and application extensions that lie about the frame count, a separator byte after the trailer, a missing trailer, a truncated file, 1,000 and 1,001 frames, a logical screen of 65535, a frame descriptor of 65535, and the 250 million pixel boundary. WebP samples cover still and animated, lossless and lossy, with and without alpha, an odd size, a frame offset, an EXIF chunk that contains the letters ANMF, an animation bit that does not match the chunks, an ANMF chunk pasted past the RIFF size, a canvas of 16777216, a VP8 header that claims 16383 while the ANMF box is 1 by 1, 1,000 and 1,001 frames, and the same pixel boundary.

The limits I checked are the ones in architecture section 6.6: image size 1 to 8000 from the header, at most 1,000 frames, at most 250 million pixels across the frames, and each frame inside the canvas. Those are H-27, H-28, and H-29, plus the still-image size rule.

## Versions

| Piece | Version | License |
|---|---|---|
| omggif | 1.0.10 | MIT |
| wasm-webp | 0.1.0 | MIT |
| libwebp, inside wasm-webp (`encoderVersion()`) | 1.3.2 | BSD-3-Clause |
| Electron | 45.0.0 (Chrome 156.0.8078.48) | |
| Node, the check runner | 22.23.4 | |
| Node inside Electron | 24.22.0 | |

omggif and wasm-webp are dependencies of `spikes/s06/package.json` only, with `save-exact=true` and this directory's own lockfile. They are not in the app `package.json`. omggif writes the GIF samples and is a second reader for GIF geometry. wasm-webp writes the WebP samples, and its libwebp decoder is a second reader for WebP frame sizes. The method I would put in the app is the walker plus `ImageDecoder` and a canvas in the renderer. Neither library decodes pixels for the count, and neither runs in the page.

## Where it ran

The command is `npm start` in `spikes/s06` (typecheck, compile, build the 46 samples, walk them under Node, open the ones that should render in Electron, write `output/spike-report.json`). Workflow: `.github/workflows/spike-s06.yml`, on `windows-latest` and `ubuntu-latest`, Node 22.23.4. The Ubuntu job starts Electron under `xvfb-run`. The workflow does not run the app's typecheck, lint, or test jobs. Those stay on the main CI workflow.

### Linux, with a display

A machine with a display, kernel `6.12.94+`, `#1 SMP PREEMPT_DYNAMIC Mon Oct 26 18:36:23 UTC 2026`. Node on the runner was 22.23.4. The host was not started with `--no-sandbox`.

- The page reported no `process`, no `require`, no `module`, no `Buffer`, and no `electron`. The user agent was Chrome/156.0.8078.48 Electron/45.0.0.
- The preload, which is the only script that may import Electron, reported `process.sandboxed` true, `process.type` `renderer`, and `contextIsolated` true.
- `app.getAppMetrics()` named the page process type `Tab`. On Linux that API leaves `sandboxed` and `integrityLevel` empty.
- `/proc/<pid>/status` for that process: Seccomp `2`, NoNewPrivs `1`, CapEff `0000000000000000`. Seccomp 2 is a filter.
- The renderer command line contains `--type=renderer` and `--enable-sandbox`.
- The report outcome is `pass`. Node checks were 48/48. Every renderer assertion passed.

### Windows

Run [40461995542](https://github.com/fillicianoplong/obelisk/actions/runs/40461995542), job "Node and sandboxed renderer (windows-latest)". The host was not started with `--no-sandbox`.

| Field | Value |
|---|---|
| Runner | GitHub Actions 1000000519 |
| Image | `20261021.278.1` (`win25-vs2026`) |
| OS | Windows Server 2025 Datacenter, `10.0.26100` |
| Electron | 45.0.0, Chrome 156.0.8078.48, Node 24.22.0 inside Electron |
| `getAppMetrics()` for the Tab | `sandboxed: true`, integrity level `untrusted` |
| Outcome | `pass`. Node 48/48. Renderer assertions passed. |

The page had no `process`, `require`, `module`, `Buffer`, or `electron`. The preload reported `process.sandboxed` true, `process.type` `renderer`, and `contextIsolated` true. The case list matches the Linux runs.

### Linux, GitHub `ubuntu-latest`

The same run, [40461995542](https://github.com/fillicianoplong/obelisk/actions/runs/40461995542), job "Node and sandboxed renderer (ubuntu-latest)". Image `20261023.334.3` (`ubuntu24`), kernel `6.17.0-1022-azure`, runner GitHub Actions 1000000518. Electron is started under `xvfb-run`.

The setuid sandbox helper aborted (`chrome-sandbox` is not owned by root with mode 4755). The spike retried the host with `--no-sandbox`, and the report records `hostNoSandbox: true`. After that retry the page still had no Node globals. The preload still reported `process.sandboxed` true, `process.type` `renderer`, and `contextIsolated` true. The renderer command line contains `--type=renderer`, `--enable-sandbox`, and `--no-sandbox`. Seccomp is 0, NoNewPrivs is 1, and CapEff is 0. `getAppMetrics()` leaves `sandboxed` and `integrityLevel` empty on Linux. Node checks were 48/48, the renderer assertions passed, and the outcome is `pass`. The `--no-sandbox` retry is a limit of this image. The Windows job did not use it, and the machine with a display did not use it.

## How the checks are done

GIF. The walker reads `GIF87a` or `GIF89a`, the logical screen, and the global palette size, and skips the palette. Extension blocks (`0x21`) are skipped by their sub-block lengths. A graphics-control extension supplies delay, disposal, and transparency for the following image. A Netscape 2.0 or ANIMEXTS 1.0 extension supplies the loop count. Loop 0 means forever. A comment, a plain-text extension, and any other application extension are not frames, even when their payload contains an image-separator byte. An image descriptor (`0x2C`) is a frame: left, top, width, height, local palette, and the interlace bit. The LZW data is skipped by sub-block length. The trailer is `0x3B`. Bytes after the trailer are not more frames. A file with image descriptors and no trailer is `missing-trailer`.

WebP. The walker reads `RIFF` / `WEBP` and honors the RIFF size as the end of the container. An ANMF chunk past that size is counted in `framesPastContainer` and is not a frame. VP8X supplies the canvas (one plus a 24-bit width and height, so the declared maximum is 16777216) and the animation and alpha flags. ANIM is the background and a 16-bit loop count. An ANMF frame stores x and y in 2-pixel units, then width and height as one plus a 24-bit value, then duration, disposal, and blend. The payload after those 16 bytes is inner chunks (`ALPH`, `VP8 `, `VP8L`). The walker reads the size fields of a VP8 keyframe (start code `9d 01 2a`, 14-bit width and height) or a VP8L stream (signature `0x2f`, 14-bit width and height, alpha bit, version bits must be 0). It does not decode the residual. A still image is one frame, from the VP8 or VP8L header, or from VP8X plus that header. If the ANMF box and the coded header disagree, the reason includes `size-mismatch`. The pixel sum uses the larger of the two boxes, so a small ANMF box cannot hide a huge coded size.

The limit check refuses `bad-canvas` above 8000, `too-many-frames` above 1000, `frame-outside` when a frame rectangle leaves the canvas, `bitstream-oversize` when a coded header is outside 1..8000, `size-mismatch`, and `pixel-budget` above 250 million. The sums use bigint. A sample that only exists to show a huge header must finish in under 200 ms with a heap delta under 8,000,000 bytes.

A byte scan for `0x2C` or for the letters ANMF is recorded only to show that it over-counts. The structured walk is the count I trust.

The renderer page receives each file as base64, because the job list crosses the context bridge. For an asserted sample, `ImageDecoder.frameCount` must equal the walk, a canvas-sized PNG must decode back to that size, and any color probes must hit one of the canvas-sized surfaces. Lossy fixtures have no color probe. Observe samples are recorded and do not fail the run.

## Results

Outcome: **pass** on the display machine, on Windows image `20261021.278.1`, and on Ubuntu image `20261023.334.3` (run 40461995542). Node 48/48 on each (46 files, plus a PNG round-trip and a source check that `renderer.ts` does not import Node or Electron). Renderer assertions passed on each. The sandbox probe passed on each. `hostNoSandbox` is false on the display machine and on Windows. It is true on the Ubuntu image, as recorded above.

### Counting without decoding: pass

The walk matched omggif 1.0.10 on every GIF it can read (geometry, interlace, local palette, transparency index, delay in centiseconds times 10). omggif throws on a plain-text extension, so that one file has no oracle; the walk counted the image descriptor and skipped the extension. The walk matched libwebp 1.3.2 on frame count for the WebP files it decoded. libwebp reports a frame's decoded size as either the bitstream size or the canvas size for an offset frame; the check accepts either, and the walk's own rectangle is the ANMF box.

`ImageDecoder.frameCount` in Electron 45 matched the walk on every file that Chromium decodes, including both 1,000-frame files, the comment lie, the trailing separator, the application-extension lie, the EXIF lie, and the file with a third ANMF past the RIFF size (2 frames, not 3).

Heap and time on the hostile headers, from the Node walk on this machine:

| Sample | Result | Pixels summed | Heap delta | Time |
|---|---|---|---|---|
| GIF logical screen 65535, frame 1 by 1 | `bad-canvas` | 1 | 1,224 | under 1 ms |
| GIF frame descriptor 65535 on an 8 by 8 screen | `frame-outside`, `pixel-budget` | 4,294,836,225 | 1,224 | under 1 ms |
| GIF, four 8000 by 8000 frames | `pixel-budget` | 256,000,000 | 1,672 | under 1 ms |
| GIF, two 8000 by 8000 frames | accepted | 128,000,000 | 1,208 | under 1 ms |
| GIF, 1,001 frames of 1 by 1 | `too-many-frames` | 1,001 | about 0.9 MB of frame records | 1.1 ms |
| WebP canvas 16777216 by 1, bitstream 1 by 1 | `bad-canvas`, `size-mismatch` | 1 | 1,736 | under 1 ms |
| WebP ANMF 1 by 1, VP8 header 16383 | `bitstream-oversize`, `pixel-budget`, `size-mismatch` | 268,402,689 | 2,584 | under 1 ms |
| WebP, four declared 8000 by 8000 frames | `pixel-budget` | 256,000,000 | 5,872 | under 1 ms |
| WebP, 1,001 ANMF headers | `too-many-frames` | 1,001 | about 1.2 MB of frame records | 1.9 ms |

The 1,000-frame GIF and the 1,000-frame lossless WebP were accepted. Chromium reported `frameCount` 1000 for both, and frame 0 was red and frame 1 was blue. No sample allocated a pixel buffer for the count.

### Lies and edges

| Sample | Walk | Chromium |
|---|---|---|
| Netscape loop 99, two GIF frames | 2 frames, loop 99 | `frameCount` 2, `repetitionCount` 99 |
| Comment contains `0x2C`; separator after the trailer; app extension says 99 frames | 2 frames. A raw `0x2C` scan is higher | `frameCount` 2 |
| Plain-text extension | 1 frame | `frameCount` 1 |
| GIF with the trailer byte removed | `missing-trailer`, 1 completed frame | `frameCount` 1, and the PNG is the red frame |
| Truncated GIF and WebP, and a non-image | refused, 0 frames | not sent to the renderer |
| ANIM loop patched to 99, two WebP frames | 2 frames, loop 99 | `frameCount` 2, `repetitionCount` 98 |
| EXIF payload contains the letters ANMF | 2 frames. A raw ANMF scan is higher | `frameCount` 2 |
| Third ANMF appended past the RIFF size | 2 frames, `framesPastContainer` 1 | `frameCount` 2, and libwebp also reports 2 |
| VP8X animation bit clear, two ANMF frames | 2 frames, note `animation-flag-clear` | ImageDecoder: "Failed to retrieve track metadata." `img` and `createImageBitmap` cannot decode it |
| Animation bit set, ANIM present, no ANMF | `animation-flag-empty`, 0 frames | not sent to the renderer |
| GIF frame drawn at (4, 4), 8 by 8 on a 16 by 16 screen | frame box 8 by 8 at (4, 4) | canvas-sized bitmap 16 by 16. (0, 0) is transparent. (8, 8) is red |
| WebP ANMF 4 by 4 at (2, 2) on an 8 by 8 canvas | frame box 4 by 4 at (2, 2) | canvas-sized bitmap 8 by 8. (0, 0) is transparent. (3, 3) is red |

Loop 0 on both formats is "repeat forever" in Chromium (`repetitionCount` comes back as infinity, which the page stores as `repeatsForever`). I do not use the loop field as a frame count.

The WebP `repetitionCount` of 98 for a container loop of 99 is Chromium's count of repeats after the first play. The walker keeps the ANIM field, 99. Frame count was 2 either way.

wasm-webp's lossy encoder is a poor color fixture. A solid red encoded at quality 100 came back from Chromium as about (143, 57, 15) through `img` and `createImageBitmap`, and about (194, 46, 0) through `ImageDecoder`. libwebp's own `decodeRGBA` of those same bytes was nearly red. I checked those files for frame count, PNG size, and (for the animated one) that the two frames differ. I did not check them for red. Lossless WebP, GIF, and the lossy-with-alpha files were exact or within a couple of levels. The transparent GIF half was exact: opaque red on the left, alpha 0 on the right.

### First-frame PNG: pass

For the animated GIF and the animated lossless WebP, all 64 by 64, the PNG from `ImageDecoder` frame 0 has pixel (32, 32) = 255, 0, 0, 255. Frame 1 is 0, 0, 255, 255. The `img` element, `createImageBitmap`, and the canvas that places the frame at its x, y agreed on those pixels. The files are `output/gif-animated.png` and `output/webp-animated-lossless.png` when the spike has just been run. They are not part of the app.

The PNG is the canvas-sized composite, which is the first frame as displayed. An offset frame is transparent outside its rectangle and colored inside it. That is the image I would hand to Word, PDF, and print. It is made at export time in the renderer. This spike does not store it in a document.

### Sandbox: pass

The page that produced the PNG had no Node on all three runs. The preload's `process.sandboxed` was true on all three.

On the display machine the host was not started with `--no-sandbox`, the command line had `--enable-sandbox`, and Seccomp was 2. On Windows image `20261021.278.1` the host was not started with `--no-sandbox`, and `getAppMetrics()` reported the Tab as `sandboxed: true` with integrity level `untrusted`. On Ubuntu image `20261023.334.3` the setuid helper aborted, the host retried with `--no-sandbox`, and Seccomp was 0. `process.sandboxed` stayed true there. `getAppMetrics()` on Linux leaves `sandboxed` and `integrityLevel` empty, so the Windows fields are the ones I use for that API.

## Decision

Pass. Counting and the first-frame PNG both work for GIF and for animated WebP. The dependent work keeps the architecture's design (OD-18): keep the animation and play it in the editor; Word, PDF, and print use a first-frame PNG made in the renderer. I am not taking the fallback that refuses animated WebP and keeps GIF only.

What I will follow when this is built:

- Count with the block walk and the chunk walk. Do not scan for a separator byte or for the letters ANMF.
- Apply the 8000, 1,000-frame, and 250-million-pixel limits to the sizes from that walk, before any pixel decode. A coded header that is larger than the ANMF box counts as the larger size.
- Bound a WebP count by the RIFF size. Chromium and libwebp both ignore an ANMF past it.
- Refuse a GIF with no trailer. The completed-frame count matches what Chromium played, and the spec still requires the trailer.
- When ANMF chunks are present and the VP8X animation bit is clear, still count those frames against the caps, then refuse the file. Chromium cannot decode it, so it cannot be played or exported.
- Read the loop from the container. Chromium's WebP `repetitionCount` was one lower than the ANIM field on the sample I tried. It is not the frame count.
- Make the export PNG in the sandboxed renderer with `ImageDecoder` frame 0, a canvas at the canvas size, and `toBlob('image/png')`.

## Proposed documentation edit

Do not apply this in the spike. Suggested replacement for the architecture section 6.6 line:

> **UNVERIFIED:** Counting GIF and WebP frames without decoding, and making the first frame in the renderer. Check in spike S-06.

Suggested text:

> **Checked in spike S-06 (Electron 45.0.0, Chrome 156.0.8078.48, Windows image 20261021.278.1, Ubuntu image 20261023.334.3, run 40461995542):** GIF and WebP frame counts and frame sizes come from a container walk, before any pixel decode. GIF blocks are walked per GIF89a: image descriptors are frames, LZW sub-blocks are skipped by length, and a Netscape loop count is not a frame count. WebP chunks are walked per the RIFF container: the canvas comes from VP8X, each ANMF rectangle is read from the frame header (x and y are in 2-pixel units), and the VP8 or VP8L header inside the frame is peeked for the coded size. The limits in this section apply to those sizes: 8000 pixels on a side, 1,000 frames, 250 million pixels across the frames, and each frame inside the canvas. A coded size that disagrees with the ANMF box is refused, and the pixel sum uses the larger box. The RIFF size bounds the count; Chromium and libwebp 1.3.2 both ignore an ANMF chunk past it. A GIF with no trailer is refused. ANMF chunks with the VP8X animation bit clear are still counted, and the file is refused because the renderer cannot decode it. The first-frame PNG for Word, PDF, and print is made in the sandboxed renderer: `ImageDecoder` frame 0, drawn to a canvas at the canvas size, then `canvas.toBlob('image/png')`. On the fixtures, an `img` element and `createImageBitmap` produced the same canvas-sized image for GIF and lossless WebP. The page had no Node. `process.sandboxed` was true on Windows, on a Linux machine with a display, and on the GitHub Ubuntu image. On Windows, with the host not started with `--no-sandbox`, `getAppMetrics()` reported the page as sandboxed with integrity level `untrusted`. On the display machine the renderer command line contained `--enable-sandbox` and Seccomp was 2. The GitHub Ubuntu image's setuid sandbox helper is not configured, so that job retried the host with `--no-sandbox` and Seccomp was 0; the page still reported `process.sandboxed` true.

Suggested replacement for the SRS section 6.10 line:

> **UNVERIFIED:** Counting frames and reading frame sizes from GIF and WebP headers before decoding, and taking the first frame for export, are unchecked. Check against the GIF89a and WebP container specifications in spike S-06 of the architecture.

Suggested text:

> **Checked in spike S-06 (Electron 45.0.0, Windows image 20261021.278.1, Ubuntu image 20261023.334.3):** Frame counts and frame sizes for GIF and WebP, including animated WebP, are read from the GIF89a block structure and the WebP RIFF chunks before decoding. The first frame used for Word, PDF, and print is a PNG produced in the sandboxed renderer from `ImageDecoder` frame 0. See architecture spike S-06.
