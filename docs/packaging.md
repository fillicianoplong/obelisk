# Packaging

`npm run package:msix` builds the app, packs an x64 MSIX, and signs it with a self-signed dev certificate. It embeds `packaging/icons/obelisk.ico` in `Obelisk.exe`. How to trust the certificate, install, launch, and remove the package is in the [README](../README.md#dev-msix).

## Build

- On Windows, install the [Windows 10 SDK](https://developer.microsoft.com/windows/downloads/windows-sdk/) so `makeappx.exe`, `makepri.exe`, and `signtool.exe` are available, then run these commands from this repository:

```
npm ci
npm run package:msix
npm run check:fuses -- dist/msix/Obelisk-Dev.msix
```

- Each run overwrites `dist/msix/Obelisk-Dev.msix` and `dist/msix/obelisk-dev.cer`.

## Icon

- The icon is a bold forward slash on a rounded square.
- The corners outside the tile are transparent.
- The tile fills the icon box on the taskbar, the window icon, and `Square44x44Logo`.
- The tile is `#3B4654` and the slash is `#E6EAF0`.
- The same icon is used on a light taskbar and a dark taskbar.

## Window icon

- The window uses `obelisk.ico` once, the same tile.
- That file holds frames at 16, 20, 24, 32, 40, 48, 64, and 256, each drawn at that size.
- Sizes below 256 are plain BMP; only 256 is PNG.
- The window is given the `.ico` path, so at 100% the title bar uses the 16 px frame (20 at 125%, 24 at 150%).

## Resource index

- Before packing, the build runs `makepri` on the package layout root so `resources.pri` names the logos `Files/assets/...`, which is what the manifest paths ask for.
- Indexing from the assets folder drops that prefix and Windows falls back to the loose file.
- `priconfig.xml` is not in the package.
- The running and pinned taskbar buttons use that index, not the window icon.
- The index has no plated `Square44x44Logo.targetsize-*` image, because Windows was choosing that tile for the taskbar.
- It has `targetsize-*_altform-unplated` and `targetsize-*_altform-lightunplated` at the sizes Windows asks for.
- Those two files are the same tile, so the taskbar picture does not change with Windows mode.
- `Square44x44Logo.png` and its scale-200 copy are that same tile.
- `BackgroundColor` is `transparent`.

## Package version

- The package version in `package.json` is what the MSIX identity uses (0.1.15.0).
- Raise it when the icons change so Windows does not keep the previous install's cached icons.

## Certificate

- The build reuses the `CN=Obelisk Dev` certificate in `Cert:\CurrentUser\My` while that certificate is still valid.
- It creates one only when none is there or it has expired.
- The private key stays in the current-user store and is not written to the repository.
- Trust the public certificate again only after a new one is created.
- Trusting the dev certificate takes one administrator step on the machine.
- Install and launch then run as a standard user.
- Store builds are signed by Microsoft, so that administrator step is only for this dev certificate.

## Package contents

- The package contains `package.json` and the built `dist` files.
- Liberation Serif ships in `assets/fonts` with its license, and the build copies those files to `dist/renderer/fonts` so the page can load them.
- Source maps stay out of the package.

## App data

- The Start-menu app id is `Obelisk`.
- The package is per user.
- Check the install folder (the `InstallLocation` from `Get-AppxPackage -Name Obelisk.Dev`) and confirm the app did not add or change files there.
- The app writes its data under `%APPDATA%\Obelisk`.
- The installed dev MSIX redirects that folder to `%LOCALAPPDATA%\Packages\<package family>\LocalCache\Roaming\Obelisk`.

## Settings for now

- [Settings (#60)](https://github.com/fillicianoplong/obelisk/issues/60) will replace this file.
- Until then, the theme is `%APPDATA%\Obelisk\settings.json`.
- Inside the dev MSIX that path is the redirect above: `%LOCALAPPDATA%\Packages\<package family>\LocalCache\Roaming\Obelisk\settings.json`.
- `<package family>` is `PackageFamilyName` from `Get-AppxPackage -Name Obelisk.Dev`.

The file looks like this:

```json
{
  "theme": "system"
}
```

- `theme` is `light`, `dark`, or `system`.
- `system` is Match Windows, and it is the default.
- A missing file, broken JSON, or any other value is treated as `system`.
- Obelisk reads the file when it starts, so edit it and then start Obelisk again.
- A Windows light, dark, or contrast change still shows up while Obelisk is open.
