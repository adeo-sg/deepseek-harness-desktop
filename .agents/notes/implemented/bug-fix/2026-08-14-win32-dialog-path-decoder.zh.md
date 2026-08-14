# Agent Note: 在 Electron 中不使用 external buffer 解码 Win32 文件夹路径

Status: implemented

[English](2026-08-14-win32-dialog-path-decoder.md) | 中文

## 问题

`IFileOpenDialog` 将所选文件系统路径作为 COM 管理的 `PWSTR` 返回。Electron 的 Node 运行时不允许 Koffi 创建 external-buffer view，因此用 `koffi.view()` 读取该指针可能在用户选择文件夹后、终端 IPC 消息到达前终止 dialog worker。使用模拟指针的源码边界测试无法覆盖这个运行时限制。

## 决策

Win32 绑定使用 Koffi 的 `decode.string16()` 读取路径；该方法复制以 NUL 结尾的 UTF-16 字符串，不创建 external buffer。每次 `GetDisplayName` 成功后都在 `finally` 中调用 `CoTaskMemFree`，包括解码失败的情况。worker 完成和父进程中止清理由子进程 IPC 生命周期继续负责。

## 备选方案

**保留 external-buffer view 并放宽 Electron 设置。** 不予采用：external-buffer 限制由 Electron 控制，修改进程设置会扩大原生内存暴露范围，也没有修正解码器约定。

**把整个 Windows 选择器迁移到 Electron dialog API。** 不予采用：原生 provider 还服务于非 Electron 宿主；保留隔离子进程中的 COM 会话可以共用一个跨宿主 provider，并让阻塞式原生调用离开宿主事件循环。

**通过手工分配字节缓冲区解码。** 不予采用：这需要为以 NUL 结尾的 COM 分配区增加另一份原生拷贝和长度策略，而 Koffi 已提供所需的 UTF-16 解码器。

## 影响

打包后的 Electron 应用通过同一 IPC 结果协议返回所选文件夹路径，包括非 ASCII 路径。解码失败仍会拒绝选择，但会释放 COM 分配区，使父进程能够报告错误，而不是只看到无法解释的 worker 退出。

## 测试

绑定测试使用不提供 external-buffer API 的模拟环境，覆盖选择、解码失败、COM 释放和内存释放。打包 Electron probe 使用原生 Windows 指针运行 Koffi UTF-16 解码器；桌面打包启动 smoke 继续覆盖组装后的首次运行路径。
