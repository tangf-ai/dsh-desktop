# Agent Note: 未签名 Windows 桌面发行版

Status: implemented

[English](2026-08-15-unsigned-windows-desktop-distribution.md) | 中文

## Problem

[Electron 桌面预览版](2026-08-15-electron-desktop-preview.md)可以在 Windows 上从源码运行，但可分发应用不能依赖仓库检出、用户安装的 Node 或 workspace 链接。Windows 还需要使用 Windows Electron 文件和原生依赖构建安装包，并在相同操作系统上验证可执行文件。交叉编译产物无法证明内置 CLI 可以启动、renderer 可以加载或 `taskkill` 可以关闭已打包的进程树。

## Decision

`pnpm desktop:exe` 在 Windows x64 上构建仓库，并生成 `apps/desktop/release/DeepSeek-Harness-Setup-<version>-x64.exe`。引导式用户级 NSIS 安装包会创建开始菜单和桌面快捷方式，并允许自定义安装目录。它包含 Windows Electron 应用、Windows x64 `node.exe`，以及与并行的[未签名 macOS 发行版](2026-08-15-unsigned-macos-desktop-distribution.md)相同的纯生产 `@deepseek-ai/dsh` 依赖闭包。打包后的主进程在 Windows 上选择 `runtime/bin/node.exe`。

共享打包模块会校验原生 Node 版本、运行已部署 CLI、在 bundle 内部实体化两个 workspace override 包，仅对 `node_modules` 下的包级条目探测 Windows junction 目标并复制其内容（包括被 `lstat` 识别为非目录的 junction）、移除不支持的 Landlock 链接，并拒绝所有仍然逃出运行时的依赖链接。Electron Builder 同时创建用于验证的解包应用和 NSIS 安装包。应用可执行文件和安装包都不包含 Authenticode 签名。

`Desktop Windows distribution` 工作流会针对 `main`、相关 PR、手动运行和发布标签，在原生 `windows-2025` runner 上构建。发布标签必须等于 `v` 加桌面包版本。单元测试、原生打包和 packaged smoke 全部通过后，标签运行会创建包含 Windows 安装包的 GitHub Release 草稿。公开发布是独立的评审操作，需要先提供 macOS 产物和发布说明。

## Verification

`desktop:smoke:win` 使用复制的 `node.exe` 运行内置 CLI，拒绝应用或安装包意外出现 Authenticode 签名，并使用隔离的 Harness home 启动解包后的已打包可执行文件。它会验证打包模式、应用身份、资源位置、回环导航、上下文隔离、renderer 沙箱、已禁用的 Node 集成和 Web 安全，然后捕获截图。关闭 Electron 后，必须停止 Harness 进程树，并让分配到的 URL 无法访问。

## Alternatives considered

**在 macOS 上交叉构建安装包。** Electron Builder 可以从其他宿主组装部分 Windows 构建目标，但产品会携带原生 Node sidecar 和原生 NPM 依赖。异构宿主构建无法执行这些字节或演练 Windows 进程树清理，因此不能提供所需发布证据。

**发布便携 ZIP 而不是安装包。** ZIP 可以避开 NSIS，但会失去安装目录选择、开始菜单集成、桌面快捷方式和常规卸载行为。引导式用户级安装包无需管理员安装即可提供这些预期 Windows 工作流。

**要求预览版必须使用 Authenticode 签名。** 签名公开渠道需要发行方持有的证书或 Trusted Signing 凭据、时间戳、发布者连续性和受保护的 secret 管理。预览版会说明缺少签名并验证其确实不存在，而不是暗示自己拥有并不存在的身份。

## Consequences

**收益：**Windows x64 用户无需开发工具即可安装并启动桌面预览版；打包后的 CLI 使用经过原生校验的 Node 和自包含依赖；真实 Windows runner 会验证安装包所包含的同一应用字节；只有通过单元、打包和生命周期检查的产物才会进入 GitHub。

**代价：**安装包体积较大，只支持 Windows x64，并且因为没有受认可的发布者，可能触发 Microsoft Defender SmartScreen。安装包没有自动更新或崩溃报告。进程树清理仍依赖 CLI 根进程存在时执行 `taskkill`；未来由 Job Object 持有进程仍是更强的异常退出设计。
