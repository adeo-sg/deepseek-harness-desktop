# Agent Note: 减少桌面安装包文件处理并使用直接 ZIP 解压

Status: implemented

[English](2026-08-14-desktop-installer-payload-and-zip-extraction.md) | 中文

## 问题

桌面包必须保持 `asar` 关闭，因为 profile module fallback 的链接目标必须是真实包目录。Electron-builder 因此会把 workspace 依赖闭包作为普通文件复制。开发源码、source map 和编译器元数据向 `resources/app` 增加了约 14,000 个文件，而 NSIS 的 differential 7z 路径会先解压到临时目录，再复制到安装目录。

## 决策

桌面文件集合在保留运行时 `lib`、前端配置和包清单后，排除 source map、TypeScript 系列源码以及 TypeScript 构建元数据。NSIS 目标设置 `differentialPackage: false` 和 `useZip: true`，使安装器将剩余内容直接解压到目标目录。当前应用没有自动更新器消费 differential package 元数据。

## 备选方案

**启用 `asar` 并保留现有 fallback 链接。** 不予采用：asar 是文件，不能作为 profile 所需真实目录 junction 的目标。

**继续使用 differential 7z 载荷。** 不予采用：它的文件体积较小，但临时解压和复制在这个文件数量较多的包上构成首次安装的主要成本。

**只设置 `useZip` 而不关闭 differential packaging。** 不予采用：只要 differential packaging 开启，electron-builder 仍会保持 7z 格式，因此不会改变安装行为。

## 影响

打包应用保留运行时依赖闭包，同时移除非运行时文件。实测 Windows 构建的 `resources/app` 从约 27,000 个文件、199 MB 降至约 13,000 个文件、113 MB。ZIP 安装器比旧 7z 安装器更大，但直接解压显著减少首次安装的文件操作；不再生成 differential update 产物。

## 测试

优化后的解包目录通过 carrier、bridge、前端 bundle 和首次运行 session smoke。Windows 静默安装 probe 分别计时新旧安装器在全新每用户目录中的安装：旧布局（27,361 个文件，differential 7z）约 129 秒，优化布局（12,934 个文件，直接 ZIP 解压）约 22 秒。中间一次保留 differential 7z 载荷但应用排除项的构建在安装时解压失败，证实 `useZip` 只有同时关闭 `differentialPackage` 才会改变解压方式。过滤后仍保留 native worker 产物。
