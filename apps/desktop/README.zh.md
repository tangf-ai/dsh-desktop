# @deepseek-ai/dsh-desktop

[English](README.md) | 中文

面向 DeepSeek Harness 的跨平台 Electron 桌面预览应用。它持有应用窗口，并在操作系统分配的回环端口上监督现有的 `dsh web` profile，因此桌面视图与浏览器应用使用相同的 Host 组合、Client 插件、会话数据、工具和 Web UI。

源码模式支持 macOS、Linux 和 Windows。打包发行版包括未签名的 Apple 芯片 macOS DMG 和未签名的 Windows x64 NSIS 安装包；目前不发布 Linux 安装包。

这个独立维护的社区应用不是 DeepSeek 官方发行版。它构建于 DeepSeek Harness workspace 内，因此保留上游 `@deepseek-ai` 包名；该名称表示源码兼容性，不代表本仓库通过 NPM 发布。上游归属说明见[仓库概述](../../README.md)。

## 构建 macOS DMG

在 Apple 芯片 macOS 上，从仓库检出构建应用与未签名 DMG：

```sh
pnpm desktop:dmg
```

该命令写入 `apps/desktop/release/DeepSeek-Harness-<version>-arm64.dmg`。打开镜像，把 `DeepSeek Harness.app` 拖到其中的 Applications 快捷方式上。应用包含生产依赖闭包和经过校验的 macOS arm64 Node 运行时，因此启动已安装应用时不需要仓库检出、Node、pnpm 或下载 Electron。

该开发者预览镜像有意不签名，也不做公证。它不包含 Developer ID 证书身份；macOS Mach-O 文件仍可能显示 linker 生成的 ad-hoc 元数据。Gatekeeper 可能要求按住 Control 键点击已安装应用并选择“打开”。如果隔离属性仍阻止启动你信任的本机构建产物，可明确移除该属性：

```sh
xattr -dr com.apple.quarantine "/Applications/DeepSeek Harness.app"
```

`pnpm desktop:smoke:dmg` 会以只读方式挂载镜像，校验内置运行时与证书身份确实缺失，启动打包后的应用，检查 Electron 实际安全参数，捕获 `.artifacts/desktop-dmg.png`，关闭应用，并确认其回环 URL 已停止响应。

## 构建 Windows 安装包

在 Windows x64 上，从仓库检出构建应用与未签名 NSIS 安装包：

```powershell
pnpm desktop:exe
```

该命令生成 `apps/desktop/release/DeepSeek-Harness-Setup-<version>-x64.exe`，并把用于验证的解包应用保留在 `apps/desktop/dist/win-unpacked`。安装后的应用包含生产依赖闭包和经过校验的 Windows x64 `node.exe`，因此不需要仓库检出、Node、pnpm 或下载 Electron。

安装包和应用可执行文件都没有 Authenticode 签名。Microsoft Defender SmartScreen 可能把下载的安装包标记为无法识别的应用，并要求用户明确允许。`pnpm desktop:smoke:win` 会拒绝意外出现的签名，运行内置 CLI，使用隔离的 Harness home 启动解包后的已打包应用，验证其打包身份和 Electron 实际安全参数，捕获 `.artifacts/desktop-windows.png`，关闭应用，并确认其回环 URL 已停止响应。

## 从源码运行

在已构建的仓库检出中运行：

```sh
pnpm desktop
```

根级 `pnpm run build` 会与 Host 包和 Web 前端一同构建本应用。`DSH_DESKTOP_CWD` 选择 Harness 的初始工作目录；源码模式未设置时使用 pnpm 的调用目录或进程工作目录，从 Finder 启动的打包应用则使用用户 home。`DSH_DESKTOP_STARTUP_TIMEOUT_MS` 修改默认 60 秒的启动时限，允许 1 至 600000 毫秒。

构建后，在有图形桌面的机器上运行 `pnpm desktop:smoke`，可执行无 API Key 的真实应用检查。它会启动隔离的 Harness home，验证渲染后的 frame 和 Electron 实际安全参数，写入 `.artifacts/desktop-preview.png`，关闭应用，并确认分配到的回环 URL 已停止响应。

发布的源码包还提供 `dsh-desktop`。它的 Node 启动器运行包内 Electron 依赖，并把同一个 Node 可执行文件传给 Electron 主进程；主进程随后启动已安装的 `@deepseek-ai/dsh` CLI 依赖，不改变原生模块 ABI。

源码模式会延迟解析对应平台的 Electron 可执行文件。除非该文件已进入缓存，首次从源码运行时需要网络访问；默认端点不可用时，可用 `ELECTRON_MIRROR` 选择其他下载镜像。打包发行版已包含 Electron，不使用该下载路径。

## 安全与生命周期

子进程只绑定 `127.0.0.1` 并请求端口 `0`，由操作系统选择空闲端口。Electron renderer 启用上下文隔离与 sandbox，禁用 Node 集成，禁止 WebView，并将顶层导航限制在该回环 origin。应用外部的 HTTP 与 HTTPS 链接通过操作系统浏览器打开。

Electron 进程只拥有一棵隔离的 Harness 进程树。它等到 Loader 停稳后的 `dsh web:` 就绪行出现，才从加载页导航至应用；启动失败或运行时意外退出会明确报错。在 POSIX 上，关闭流程先向整个进程组发送 SIGTERM，超过有界宽限期后再发送 SIGKILL，并等待进程组退出；在 Windows 上则使用 `taskkill /T /F`，因为 Node 信号无法提供可捕获的优雅阶段。最外层 Node 启动器还会独立限制 Electron 关闭时长，因此任一进程层的子进程停止响应时都能达到静止状态。

## 模型体验

桌面预览版运行完整 Web profile，包括其面向模型的界面上下文；自身不增加 prompt、工具或会话事件。

#### KV Cache 影响

除现有 Web profile 外无额外影响；Electron 生命周期所有者不组装 provider 请求。

## 已知限制与暂缓事项

- **未签名的原生安装包**：DMG 支持 macOS arm64，既无 Developer ID 签名也未公证；NSIS 安装包支持 Windows x64，没有 Authenticode 签名。尚不包含 Intel macOS、Windows arm64、Linux 安装包、自动更新和崩溃报告。源码模式仍支持 macOS、Linux 和 Windows。
- **回环 Web 载体**：预览版会打开本地 HTTP／WebSocket 监听，尚未实现规划中的 `file://` 加 IPC 载体。Host 信任栅栏可阻止浏览器 DNS rebinding，但不是针对本地进程的认证。
- **不自动重启运行时**：Harness 子进程意外退出时会显示阻塞错误并关闭应用，而不会重建 Cordis 树。
- **Windows 崩溃清理会明确失败**：普通关闭会在 CLI 根进程仍可标识其进程树时使用 `taskkill /T /F`。如果该根进程在清理前意外消失，Windows 没有进程组存活探针；未成功的 `taskkill` 会使关闭失败，而不会声称后代进程已消失。未来可由 Job Object 所有权替换这一限制。
- **没有桌面原生能力提供方**：目录选择和路径打开仍使用 Web profile 现有的 Host 提供方，而不是 Electron dialog API。
