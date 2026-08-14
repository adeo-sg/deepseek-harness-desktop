# Agent Note: Electron 下 Win32 文件夹对话框 worker 以纯 node 运行

Status: implemented

[English](2026-08-14-electron-dialog-worker-plain-node.md) | 中文

## Problem

在 Electron 桌面壳层中选择文件夹会失败,报 `win32 folder dialog worker exited before reporting a result`。原生目录选择器会派生一个子进程来承载 koffi/COM 的 `IFileOpenDialog` 对话,而驱动在子进程未发送任何 IPC 消息就退出时拒绝。`dsh web`(纯 node 进程)里子进程运行正常;桌面壳层里它每次都瞬间退出。

## Decision

spawner(`dsh-host-directory-picker-native` 的 `win32-dialog-host.ts`)用 `process.execPath` 启动子进程——在 Electron 下那是 **Electron 二进制**,于是子进程被当作 Electron app(第二个实例)启动,而不是把 worker 脚本当作 node 运行,还没到对话框就退出了。`spawnDialogWorker` 现在无条件在子进程 env 里设置 `ELECTRON_RUN_AS_NODE: '1'`:只有 Electron 二进制会赋予该变量语义,所以纯 node 宿主不受影响;而在桌面壳层下,子进程以纯 node 运行 worker——这正是 `dsh web` 一直以来的语义。source 平面(tsx 引导)与打包(`lib/worker.cjs`)两条 spawn 分支共用该 env,因此 dev 与打包壳层行为一致。

## Alternatives considered

| 已拒绝 | 一句话理由 |
|---|---|
| 用随附的 node 运行时派生（`ELECTRON_BUNDLED_NODE`） | `ELECTRON_RUN_AS_NODE` 用一个环境变量复用已在运行的 Electron 二进制；再捆绑一个运行时会把安装体积翻倍且无收益 |
| 检测 Electron 后选用不同的 execPath | 该变量在纯 node 下是惰性的，一条无条件 spawn 路径即可同时服务两种宿主，无需分叉 |
| 在进程内打开对话框（不派生） | 子进程把阻塞式 COM 对话与其 koffi 面与主进程隔离；移除会改变驱动的 abort/生命周期契约 |

## Verification

- 单元 spec(`tests/win32-dialog-host.spec.ts`)钉住 spawn 契约:`process.execPath` + worker 入口 + `ELECTRON_RUN_AS_NODE: '1'` + `ipc` stdio 通道 + `windowsHide`。
- 一次性 Electron 探针从构建出的 `lib/index.js` 调用 `pickNativeDirectory`,在对话框打开后 abort:它 reject 为 `native directory picker aborted`(对话框打开、abort 服务将其关闭)——修复前则是 `exited before reporting a result`。同一探针对 **打包** `resources/app` 布局跑结果一致。
- 全部 directory-picker、interaction/approval、sandbox/fs、connection(IPC + 特权方法钉死)与 apiproxy host 域套件通过。

## Consequences

桌面壳层的原生文件夹选择器现在像 web GUI 一样打开系统对话框。代价是给对话框子进程加了一个环境变量,它在 Electron 之外是惰性的。相关配置面不变:`host.pickDirectory` 仍钉死在回环信任(桌面 IPC 桥把渲染进程归一化到回环)、选择器后端选择(`directory-picker-auto` 在回环 win32 启动下选 native)未动,`host.listDirectory`/`host.createDirectory` 仍要求 browse capability,与 web 组合完全一致。
