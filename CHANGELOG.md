# Changelog

## Unreleased

## 0.2.2 — 2026-09-17

- Declare BB 0.43.1 — the release this plugin is developed, built, and run against — as the minimum supported BB in `engines.bb` and in the README badge/requirements, replacing the unverified 0.35.1 claim.
- `source-build` now installs that same release as its pinned builder (`bb-app@0.43.1`, the CLI BB ships to plugin installs) and builds with it, instead of checking out the BB monorepo at a commit and installing it with pnpm. The job keeps verifying a production-only Git install at the declared minimum without depending on a repository snapshot.

## 0.2.1 — 2026-09-17

- Import the plugin SDK from the `@bb/plugin-sdk` specifier BB supplies at runtime instead of the npm distribution name. BB's plugin build keeps that specifier external and the host maps it to its own SDK copy, so a production-only Git install builds without the published package present. The `source-build` CI job failed on the npm name, which no BB builder externalizes, and a bundle importing it cannot run on BB versions older than the rename.
- Resolve the SDK declarations from the published package in `tsconfig.json`, and alias the canonical specifier to that package in the Vitest configs so tests keep using its `/testing` helpers.

## 0.2.0 — 2026-09-16

- Claim only `.excalidraw` in the file opener: BB resolves a file by the extension after its last dot, so claiming `md` diverted every Markdown file to this plugin and its fallback to BB's preview shadowed the Markdown opener the user had chosen. Ordinary Markdown keeps its own opener; Obsidian `.excalidraw.md` notes open from the Excalidraw picker.

## 0.1.1 — 2026-08-15

- Add Excalidraw's native light, dark, and system theme selector without changing scene files.
- Apply clean external revisions and conflict reloads to the live Excalidraw canvas without stale reverse saves.
- Release cached save coordinators after their final editor consumer closes.
- Expand the README with the BB-native agent diagram workflow.
- Separate the plugin's MIT license from the vendored BB Plugin SDK notice.
- Verify production-only Git installs with a pinned BB 0.35.1 builder in CI.
- Document the known transitive Excalidraw dependency advisories and exposure boundary.

## 0.1.0 — 2026-08-10

- Add native `.excalidraw` viewing and editing in BB.
- Add SHA-256 compare-and-swap saves and realtime conflict handling.
- Add bounded semantic read, create, and apply tools for agents and the BB CLI.
- Add accessibility, link-policy, package, browser, and scene-preservation coverage.
- Add an Excalidraw launcher to the thread panel Actions menu.
- Discover workspace drawings and switch between them from the launcher.
- Show save status only while loading, dirty, saving, conflicted, or failed.
- Bundle Excalidraw CSS and fonts for compatibility with BB source installs.
- Enable the Excalidraw skill and semantic tools for agents in live workspaces.
- Add BB-native diagram planning, layout, palette, semantic-format, and validation guidance.
