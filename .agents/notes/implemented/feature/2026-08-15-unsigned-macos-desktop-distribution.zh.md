# Agent Note: 未签名 macOS 桌面发行版

Status: implemented

[English](2026-08-15-unsigned-macos-desktop-distribution.md) | 中文

## Problem

[Electron 桌面预览版](2026-08-15-electron-desktop-preview.md)可以从已构建的仓库运行，但该路径需要 workspace、Node、pnpm 与 Electron 安装。从 Finder 启动的应用不能依赖调用 shell 的 Node 可执行文件或工作目录。因此，可分发应用需要自带兼容的 CLI 运行时、没有链接指回源码检出的纯生产依赖闭包，以及常规 macOS 安装镜像。开发者预览渠道没有由发行方持有的 Developer ID 身份或公证工作流。

## Decision

`pnpm desktop:dmg` 在 Apple 芯片 macOS 上构建仓库，并生成 `apps/desktop/release/DeepSeek-Harness-<version>-arm64.dmg`。镜像包含 `DeepSeek Harness.app` 与 `/Applications` 快捷方式。打包后的主进程使用 `Contents/Resources/runtime/bin/node` 启动已部署的 `@deepseek-ai/dsh` CLI，从 Finder 启动时则默认使用用户 home 作为 Harness 工作目录。

构建过程接受 `DSH_DESKTOP_BUNDLED_NODE` 或调用方 Node 可执行文件，并拒绝任何并非 macOS arm64、不满足仓库 Node engine，或链接到非系统动态库的可执行文件。`pnpm deploy --prod --legacy` 在 workspace 外的临时目录中组装桌面生产依赖闭包。`@deepseek-ai/cosmokit` 与 `@deepseek-ai/schemastery` 的 workspace override 会被复制到该运行时中，所有指向它们的链接都会改写为内部链接。部署根目录的 hoist 链接与不受支持的 Linux Landlock 可选包链接会被移除。遍历检查会拒绝其余任何逃逸出运行时或没有目标的符号链接。

Electron Builder 只生成 `.app`，使用本地安装的 Electron 发行文件并设置 `identity: null`；它不会执行证书签名或 Gatekeeper 评估步骤。构建过程会在打包前运行已部署 CLI，并在打包后再次运行完整 `.app` 内的 CLI。macOS `hdiutil` 从经过校验的应用创建压缩 DMG，无需单独的 DMG helper。产物未签名且未公证；允许 linker 生成的 ad-hoc Mach-O 元数据，但不允许存在证书 `Authority`。

## Verification

`desktop:smoke:dmg` 以只读方式挂载 DMG，检查应用与 `/Applications` 快捷方式，执行内置 CLI，并拒绝 `codesign` 报告的任何证书身份。它会使用隔离的 Harness home 启动挂载镜像中的可执行文件，校验打包模式、应用身份、资源位置、回环导航、上下文隔离、renderer 沙箱、已禁用的 Node 集成与 Web 安全，然后捕获截图。关闭 Electron 后，必须先停止 Harness 进程树并让分配到的 URL 无法访问，才会卸载镜像。

## Alternatives considered

**签名并公证预览镜像。** 公开签名渠道需要由发行方持有的 Developer ID 凭据、hardened runtime 与 entitlement 审查、公证提交和稳定的发布方所有权。这些责任不属于本地预览构建器，把 ad-hoc 签名伪装成 Developer ID 身份也会误述 Gatekeeper 行为。

**让 CLI 使用系统 Node 或 Electron 内置 Node。** Finder 不提供可靠的系统 Node 路径，CLI 的原生依赖还必须共享已知 Node ABI。经过校验的 sidecar 保留现有独立进程生命周期，同时让该运行时明确且可重定位。

**打包 workspace 或保留 pnpm 链接。** 交付源码检出会包含开发依赖与机器本地路径。原始 `pnpm deploy` 输出仍带有 workspace override 链接，因此构建过程会实体化这些包并拒绝其他外部链接，而不依赖构建机器。

**使用 Electron Builder 的 DMG target。** `.app` 仍受益于 Electron Builder 的 bundle 组装，但其 DMG target 会为 macOS 已由 `hdiutil` 提供的任务增加一次单独 helper 下载。系统镜像工具无需改变未签名安全姿态，即可生成应用加快捷方式的所需布局。

## Consequences

**收益：**Apple 芯片用户无需仓库检出或下载依赖即可安装并启动预览版；打包进程使用经过校验的 Node 与自包含 CLI 依赖图；构建期与挂载镜像检查覆盖 Finder 启动的相同路径；证书身份缺失是经过断言的属性，而非假设。

**代价：**镜像只支持 macOS arm64，体积较大，没有 Developer ID 签名或公证，带有隔离属性的下载可能需要明确绕过 Gatekeeper。它没有自动更新、崩溃报告流水线、Intel 构建或 Linux 安装包。并行的[未签名 Windows 发行版](2026-08-15-unsigned-windows-desktop-distribution.md)使用独立的原生构建与验证路径。未来新增签名发行渠道需要独立的发布决策，也不会改变预览版的回环 Web 载体。
