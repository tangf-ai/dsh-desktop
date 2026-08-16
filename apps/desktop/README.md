# @deepseek-ai/dsh-desktop

English | [中文](README.zh.md)

Cross-platform Electron desktop preview for DeepSeek Harness. It owns the application window and supervises the existing `dsh web` profile on an operating-system-assigned loopback port, so the desktop view uses the same Host composition, Client plugins, session data, tools, and Web UI as the browser application.

Source mode runs on macOS, Linux, and Windows. Packaged distributions are an unsigned Apple-silicon macOS DMG and an unsigned Windows x64 NSIS installer; Linux installers are not published.

This independently maintained community application is not an official DeepSeek release. It retains the upstream `@deepseek-ai` package name because it is built inside the DeepSeek Harness workspace; the name identifies source compatibility, not an npm publication by this repository. See the [repository overview](../../README.md) for upstream attribution.

## Build the macOS DMG

On Apple-silicon macOS, build the application and unsigned DMG from a repository checkout:

```sh
pnpm desktop:dmg
```

The command writes `apps/desktop/release/DeepSeek-Harness-<version>-arm64.dmg`. Open the image and drag `DeepSeek Harness.app` onto its Applications shortcut. The application contains its production dependency closure and a validated macOS arm64 Node runtime, so launching the installed app does not require a repository checkout, Node, pnpm, or an Electron download.

This developer-preview image is deliberately unsigned and unnotarized. It contains no Developer ID certificate identity; macOS Mach-O files may still report linker-generated ad-hoc metadata. Gatekeeper may require Control-clicking the installed application and choosing Open. If quarantine still blocks a locally built artifact that you trust, remove that attribute explicitly:

```sh
xattr -dr com.apple.quarantine "/Applications/DeepSeek Harness.app"
```

`pnpm desktop:smoke:dmg` mounts the image read-only, verifies the bundled runtime and absence of a certificate identity, starts the packaged application, checks the live Electron security preferences, captures `.artifacts/desktop-dmg.png`, closes the app, and confirms that its loopback URL stops responding.

## Build the Windows installer

On Windows x64, build the application and unsigned NSIS installer from a repository checkout:

```powershell
pnpm desktop:exe
```

The command writes `apps/desktop/release/DeepSeek-Harness-Setup-<version>-x64.exe` and keeps the unpacked application under `apps/desktop/dist/win-unpacked` for verification. The installed application contains its production dependency closure and a validated Windows x64 `node.exe`, so it does not require a repository checkout, Node, pnpm, or an Electron download.

The installer and application executables have no Authenticode signature. Microsoft Defender SmartScreen may identify the downloaded installer as an unrecognized application and require an explicit override. `pnpm desktop:smoke:win` rejects an unexpected signature, runs the bundled CLI, launches the unpacked packaged application with an isolated Harness home, validates its packaged identity and live Electron security preferences, captures `.artifacts/desktop-windows.png`, closes the app, and confirms that its loopback URL stops responding.

## Run from source

From a built repository checkout:

```sh
pnpm desktop
```

The root `pnpm run build` command builds this app together with the Host packages and Web frontend. `DSH_DESKTOP_CWD` selects the initial Harness working directory; source mode otherwise uses pnpm's invocation directory or the process working directory, while a Finder-launched packaged app uses the user's home directory. `DSH_DESKTOP_STARTUP_TIMEOUT_MS` changes the 60-second startup deadline and accepts values from 1 through 600000 milliseconds.

After building, `pnpm desktop:smoke` runs a keyless real-application check on a machine with a graphical desktop. It starts an isolated Harness home, validates the rendered frame and live Electron security preferences, writes `.artifacts/desktop-preview.png`, closes the app, and verifies that the assigned loopback URL stops responding.

The published source package also exposes `dsh-desktop`. Its Node launcher starts the package's Electron dependency and passes that same Node executable to the Electron main process, which then starts the installed `@deepseek-ai/dsh` CLI dependency without changing the native-module ABI.

Source mode resolves its platform Electron executable lazily. The first source run needs network access unless the executable is already cached; `ELECTRON_MIRROR` selects an alternate download mirror when the default endpoint is unavailable. Packaged distributions contain Electron and do not use this download path.

## Security and lifecycle

The child binds only `127.0.0.1` and requests port `0`, so the operating system selects an unused port. The Electron renderer has context isolation and sandboxing enabled, Node integration disabled, WebViews blocked, and top-level navigation restricted to that exact loopback origin. HTTP and HTTPS links outside the application open through the operating system browser.

The Electron process owns exactly one isolated Harness process tree. It waits for the Loader-settled `dsh web:` readiness line before navigating away from the loading page and reports startup or unexpected runtime exits. On POSIX, shutdown sends SIGTERM and then bounded SIGKILL to the entire process group and waits for group exit; on Windows it uses `taskkill /T /F` because Node signals cannot provide a catchable graceful tier. The outer Node launcher separately bounds Electron shutdown, so either process layer can reach quiescence when its child stops responding.

## Model Experience

The desktop preview runs the exact Web profile, including its model-visible surface context. It adds no prompt, tool, or session event of its own.

#### KV Cache effect

None beyond the existing Web profile; the Electron lifecycle owner does not assemble provider requests.

## Known Limitations and Deferred Work

- **Unsigned native installers** — the DMG supports macOS arm64 and is neither Developer ID signed nor notarized; the NSIS installer supports Windows x64 and has no Authenticode signature. Intel macOS, Windows arm64, Linux installers, auto-update, and crash reporting are not included. Source mode remains available on macOS, Linux, and Windows.
- **Loopback Web carrier** — the preview opens a local HTTP/WebSocket listener and does not yet implement the planned `file://` plus IPC carrier. The Host trust fence prevents browser DNS rebinding but is not local-process authentication.
- **No automatic runtime restart** — an unexpected Harness child exit produces a blocking error and closes the application instead of reconstructing the Cordis tree.
- **Windows crash cleanup is fail-loud** — ordinary shutdown uses `taskkill /T /F` while the CLI root still identifies its tree. If that root disappears unexpectedly before cleanup, Windows provides no group-liveness probe; an unsuccessful `taskkill` makes shutdown fail instead of claiming that descendants are gone. A future Job Object owner can replace this limit.
- **No desktop-native capability providers** — directory selection and path opening continue through the Web profile's existing Host providers rather than Electron dialog APIs.
