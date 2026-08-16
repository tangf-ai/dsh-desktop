# Agent Note: Unsigned macOS desktop distribution

Status: implemented

English | [中文](2026-08-15-unsigned-macos-desktop-distribution.zh.md)

## Problem

The [Electron desktop preview](2026-08-15-electron-desktop-preview.md) can run from a built repository, but that path requires the workspace, Node, pnpm, and an Electron installation. A Finder-launched application cannot rely on the invoking shell's Node executable or working directory. A distributable application therefore needs its own compatible CLI runtime, a production-only dependency closure with no links back to the source checkout, and an ordinary macOS installation image. The developer-preview channel has no release-owned Developer ID identity or notarization workflow.

## Decision

`pnpm desktop:dmg` builds the repository and produces `apps/desktop/release/DeepSeek-Harness-<version>-arm64.dmg` on Apple-silicon macOS. The image contains `DeepSeek Harness.app` and an `/Applications` shortcut. The packaged main process starts `Contents/Resources/runtime/bin/node` with the deployed `@deepseek-ai/dsh` CLI, and a Finder launch uses the user's home directory as the default Harness working directory.

The build accepts `DSH_DESKTOP_BUNDLED_NODE` or the invoking Node executable, then rejects anything that is not macOS arm64, does not satisfy the repository Node engine, or links to non-system dynamic libraries. `pnpm deploy --prod --legacy` assembles the desktop production closure in a temporary directory outside the workspace. Workspace overrides for `@deepseek-ai/cosmokit` and `@deepseek-ai/schemastery` are copied into that runtime and every link to them is rewritten internally. The deployment-root hoist and unsupported Linux Landlock optional-package links are removed. A traversal rejects every remaining symbolic link that escapes the runtime or has no target.

Electron Builder creates only the `.app`, using the locally installed Electron distribution and `identity: null`; it does not run a certificate-signing or Gatekeeper assessment step. The build runs the deployed CLI before packaging and the CLI inside the completed `.app` afterward. macOS `hdiutil` creates the compressed DMG from that verified application without a separate DMG helper. The result is unsigned and unnotarized; linker-generated ad-hoc Mach-O metadata is acceptable, but a certificate `Authority` is not.

## Verification

`desktop:smoke:dmg` mounts the DMG read-only, checks the application and `/Applications` shortcut, executes the bundled CLI, and rejects any certificate identity reported by `codesign`. It launches the executable from the mounted image with an isolated Harness home, verifies packaged mode, application identity, resource location, loopback navigation, context isolation, renderer sandboxing, disabled Node integration, and Web security, then captures a screenshot. Closing Electron must stop the Harness process tree and make the assigned URL unreachable before the image is detached.

## Alternatives considered

**Sign and notarize the preview image.** A signed public channel requires release-owned Developer ID credentials, hardened-runtime and entitlement review, notarization submission, and stable publisher ownership. Those responsibilities do not belong in a local preview builder, and pretending an ad-hoc signature is a Developer ID identity would misstate Gatekeeper behavior.

**Use a system Node or Electron's embedded Node for the CLI.** Finder does not provide a reliable system Node path, and the CLI's native dependencies must share a known Node ABI. A validated sidecar preserves the existing separate-process lifecycle while making that runtime explicit and relocatable.

**Package the workspace or leave pnpm links intact.** Shipping the checkout would include development dependencies and machine-local paths. Raw `pnpm deploy` output still carries workspace override links, so the build materializes those packages and rejects any other external link rather than depending on the builder machine.

**Use Electron Builder's DMG target.** The `.app` still benefits from Electron Builder's bundle assembly, but its DMG target adds a separately downloaded helper to a task macOS already provides through `hdiutil`. The native image tool produces the required application-plus-shortcut layout without changing the unsigned security posture.

## Consequences

**Bought:** an Apple-silicon user can install and launch the preview without a repository checkout or dependency download; the packaged process uses a validated Node and a self-contained CLI dependency graph; build-time and mounted-image checks cover the same paths Finder launches; certificate absence is an asserted property instead of an assumption.

**Paid:** the image supports only macOS arm64, is large, has no Developer ID signature or notarization, and may require an explicit Gatekeeper override for a quarantined download. It has no auto-update, crash-reporting pipeline, Intel build, or Linux installer. The parallel [unsigned Windows distribution](2026-08-15-unsigned-windows-desktop-distribution.md) has its own native build and verification path. Adding a signed release channel later requires a separate publishing decision and does not change the preview's loopback Web carrier.
