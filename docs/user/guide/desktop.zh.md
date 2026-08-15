# 安装桌面应用

[English](desktop.md) | 中文

桌面应用运行与 `npx @deepseek-ai/dsh web` 相同的 Web profile，并保存相同的 Harness 数据，但它通过 Electron IPC 提供 UI，不打开 HTTP 端口。npx 启动器仍使用 `3080`，Docker 使用 `4080`，Kubernetes 本地转发使用 `4081`，因此这些模式可以同时运行。

## 选择资产

打开 [GitHub Releases 页面](https://github.com/sdkwork-ai/deepseek-harness-desktop/releases)，选择目标 `dsh-v<version>` Release，再下载与操作系统和 CPU 架构匹配的文件。

| 平台 | 架构 | 安装包 | 便携归档 |
|---|---|---|---|
| Windows | x64 或 arm64 | `DeepSeek-Harness-<version>-win-<arch>.exe` | `DeepSeek-Harness-<version>-win-<arch>.zip` |
| macOS | x64 或 arm64 | `DeepSeek-Harness-<version>-mac-<arch>.dmg` | `DeepSeek-Harness-<version>-mac-<arch>.zip` |
| Linux | x64 | `*-linux-x86_64.AppImage`、`*-linux-amd64.deb` 或 `*-linux-x86_64.rpm` | `*-linux-x64.tar.gz` |
| Linux | arm64 | `*-linux-arm64.AppImage`、`*-linux-arm64.deb` 或 `*-linux-aarch64.rpm` | `*-linux-arm64.tar.gz` |

Release 还包含 `SHA256SUMS`、更新元数据、Docker/Kubernetes 部署包以及离线 Linux 容器镜像。容器安装方法见[部署指南](deployment.md)。

## 校验下载文件

将 `SHA256SUMS` 下载到所选资产旁。在 macOS 或 Linux 上校验完整清单或一个指定文件：

```sh
sha256sum --check SHA256SUMS
sha256sum "DeepSeek-Harness-<version>-linux-x86_64.AppImage"
```

在 Windows PowerShell 中，将打印出的 hash 与 `SHA256SUMS` 中的匹配行进行比较：

```powershell
(Get-FileHash .\DeepSeek-Harness-<version>-win-x64.exe -Algorithm SHA256).Hash.ToLower()
Select-String -Path .\SHA256SUMS -Pattern 'DeepSeek-Harness-<version>-win-x64.exe'
```

候选版本尚未签名，因此 Windows SmartScreen、macOS Gatekeeper 或 Linux 桌面环境可能要求确认。批准操作系统提示前，请先校验摘要与仓库来源。

## 安装

在 Windows 上运行 `.exe` 完成当前用户安装，或解压 `.zip` 并直接启动 `dsh-desktop.exe`。

在 macOS 上打开 `.dmg`，再将 DeepSeek Harness 移入 Applications，或解压 `.zip`。对于未签名的候选版本，可能需要从 Finder 上下文菜单打开已校验的应用。

在 Debian 或 Ubuntu 上安装 `.deb` 包：

```sh
sudo apt install "./DeepSeek-Harness-<version>-linux-<deb-arch>.deb"
```

在 Fedora、RHEL 或其他基于 RPM 的发行版上安装 `.rpm` 包：

```sh
sudo rpm -Uvh "./DeepSeek-Harness-<version>-linux-<rpm-arch>.rpm"
```

AppImage 与 tar 归档是便携安装方式：

```sh
chmod +x "DeepSeek-Harness-<version>-linux-<appimage-arch>.AppImage"
"./DeepSeek-Harness-<version>-linux-<appimage-arch>.AppImage"

mkdir dsh-desktop
tar -xzf "DeepSeek-Harness-<version>-linux-<arch>.tar.gz" -C dsh-desktop
./dsh-desktop/dsh-desktop
```

`<deb-arch>` 使用 `amd64`/`arm64`，`<rpm-arch>` 使用 `x86_64`/`aarch64`，`<appimage-arch>` 使用 `x86_64`/`arm64`。tar 归档使用 `x64` 或 `arm64`。

## 首次运行与更新

开始会话前，打开**设置 -> 模型**并配置提供方。桌面与 npx 启动共用 `$DSH_HOME` 或 `~/.dsh`，包括 profile、设置、凭据、会话、附件和工作区。默认关闭窗口后应用会留在系统托盘中；需要关闭窗口即停止进程时，请使用托盘的退出命令，或在通用设置中关闭「关闭到托盘」。

打包应用会在启动后检查匹配的 GitHub 发布通道。通用设置可以控制自动检查、稳定版/预发布版选择与自动下载。候选版本尚未签名，自动安装可能被操作系统策略拒绝；此时使用**查看发布页**，校验 `SHA256SUMS`，再手动安装匹配资产。

## 卸载

通过操作系统的应用管理器卸载 `.exe`、`.dmg`、`.deb` 和 `.rpm` 安装。便携归档与 AppImage 可直接删除解压文件。卸载应用不会删除共享的 Harness home；只有在不再需要其中的会话、设置、凭据与 profile 时，才另行删除 `~/.dsh`。
