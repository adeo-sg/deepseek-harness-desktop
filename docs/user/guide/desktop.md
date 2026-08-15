# Install the desktop application

English | [中文](desktop.zh.md)

The desktop application runs the same Web profile and stores the same Harness data as `npx @deepseek-ai/dsh web`, but it serves the UI through Electron IPC and opens no HTTP port. The npx launcher remains on `3080`, Docker uses `4080`, and the Kubernetes local forward uses `4081`, so all modes can run together.

## Choose an asset

Open the [GitHub Releases page](https://github.com/sdkwork-ai/deepseek-harness-desktop/releases), select the intended `dsh-v<version>` release, and download the file for the operating system and CPU architecture.

| Platform | Architecture | Installer | Portable archive |
|---|---|---|---|
| Windows | x64 or arm64 | `DeepSeek-Harness-<version>-win-<arch>.exe` | `DeepSeek-Harness-<version>-win-<arch>.zip` |
| macOS | x64 or arm64 | `DeepSeek-Harness-<version>-mac-<arch>.dmg` | `DeepSeek-Harness-<version>-mac-<arch>.zip` |
| Linux | x64 | `*-linux-x86_64.AppImage`, `*-linux-amd64.deb`, or `*-linux-x86_64.rpm` | `*-linux-x64.tar.gz` |
| Linux | arm64 | `*-linux-arm64.AppImage`, `*-linux-arm64.deb`, or `*-linux-aarch64.rpm` | `*-linux-arm64.tar.gz` |

The Release also contains `SHA256SUMS`, update metadata, a Docker/Kubernetes deployment bundle, and offline Linux container images. Container installation is covered by the [deployment guide](deployment.md).

## Verify the download

Download `SHA256SUMS` beside the selected asset. On macOS or Linux, verify the complete inventory or one named file:

```sh
sha256sum --check SHA256SUMS
sha256sum "DeepSeek-Harness-<version>-linux-x86_64.AppImage"
```

On Windows PowerShell, compare the printed hash with the matching `SHA256SUMS` line:

```powershell
(Get-FileHash .\DeepSeek-Harness-<version>-win-x64.exe -Algorithm SHA256).Hash.ToLower()
Select-String -Path .\SHA256SUMS -Pattern 'DeepSeek-Harness-<version>-win-x64.exe'
```

Release candidates are unsigned. Windows SmartScreen, macOS Gatekeeper, or a Linux desktop may therefore ask for confirmation. Verify the checksum and repository source before approving an operating-system prompt.

## Install

On Windows, run the `.exe` for an assisted per-user installation, or extract the `.zip` and launch `dsh-desktop.exe` without installing it.

On macOS, open the `.dmg` and move DeepSeek Harness to Applications, or extract the `.zip`. An unsigned candidate may require opening the verified application from Finder's context menu.

On Debian or Ubuntu, install the `.deb` package:

```sh
sudo apt install "./DeepSeek-Harness-<version>-linux-<deb-arch>.deb"
```

On Fedora, RHEL, or another RPM-based distribution, install the `.rpm` package:

```sh
sudo rpm -Uvh "./DeepSeek-Harness-<version>-linux-<rpm-arch>.rpm"
```

The AppImage and tar archive are portable alternatives:

```sh
chmod +x "DeepSeek-Harness-<version>-linux-<appimage-arch>.AppImage"
"./DeepSeek-Harness-<version>-linux-<appimage-arch>.AppImage"

mkdir dsh-desktop
tar -xzf "DeepSeek-Harness-<version>-linux-<arch>.tar.gz" -C dsh-desktop
./dsh-desktop/dsh-desktop
```

Use `amd64`/`arm64` for `<deb-arch>`, `x86_64`/`aarch64` for `<rpm-arch>`, and `x86_64`/`arm64` for `<appimage-arch>`. The tar archive uses `x64` or `arm64`.

## First run and updates

Open **Settings -> Models** and configure a provider before starting a session. Desktop and npx launches share `$DSH_HOME` or `~/.dsh`, including profiles, settings, credentials, sessions, attachments, and workspaces. Closing the window keeps the app in the system tray by default; use the tray's Quit command or disable close-to-tray in General settings when a window close must stop the process.

Packaged applications check the matching GitHub release channel after startup. General settings controls automatic checks, stable/prerelease selection, and automatic download. Because release candidates are unsigned, an automatic installation may fail under operating-system policy; use **View release page**, verify `SHA256SUMS`, and install the matching asset manually.

## Remove

Use the operating system's application manager for `.exe`, `.dmg`, `.deb`, and `.rpm` installations. Portable archives and AppImages can be removed by deleting their extracted files. Application removal does not delete the shared Harness home; remove `~/.dsh` separately only when its sessions, settings, credentials, and profiles are no longer needed.
