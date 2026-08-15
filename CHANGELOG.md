# Changelog

## Unreleased

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
