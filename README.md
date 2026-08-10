<p align="center">
  <img src="./branding/icon.svg" width="96" height="96" alt="BB Excalidraw plugin icon">
</p>

<h1 align="center">BB Excalidraw plugin</h1>

<p align="center">
  Native Excalidraw editing in BB, with revision-safe agent tools and matching CLI commands.
</p>

<p align="center">
  <a href="https://github.com/Diffuzmetall/bb-plugin-excalidraw/actions/workflows/ci.yml"><img src="https://github.com/Diffuzmetall/bb-plugin-excalidraw/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/BB-%3E%3D0.35.1-6c5ce7" alt="BB 0.35.1 or newer">
  <img src="https://img.shields.io/badge/Node.js-%3E%3D22.19.0-339933" alt="Node.js 22.19 or newer">
</p>

```bash
bb plugin install git:https://github.com/Diffuzmetall/bb-plugin-excalidraw.git@v0.1.0 --yes
```

> If your BB release already bundles Excalidraw, install the official bundled copy instead: `bb plugin install excalidraw --yes`.

## TL;DR

### The problem

An `.excalidraw` file is JSON, but a generic JSON editor cannot provide the canvas, preserve Excalidraw scene behavior, or safely coordinate concurrent human and agent edits.

### The solution

This plugin adds a native Excalidraw canvas to BB and exposes the same workspace scene through bounded semantic agent tools and `bb excalidraw` CLI commands. Writes use SHA-256 compare-and-swap, so stale agents cannot silently replace newer work.

### Why use it?

| Capability | What you get |
| --- | --- |
| Native canvas | Open and edit `.excalidraw` files inside BB |
| Workspace launcher | Start from **New tab → Actions** and choose an existing drawing or create a new one |
| Revision-safe writes | Every mutation is checked against the revision that was read |
| Agent automation | Read summaries, create scenes, and apply semantic operations without returning raw image bodies |
| Diagram-design skill | BB-native guidance for architectures, workflows, timelines, comparisons, and visual explanations |
| CLI parity | The same read/create/apply workflow is available through `bb excalidraw` |
| Conflict retention | Clean files reload; dirty local drafts remain visible when an external write conflicts |
| Workspace confinement | BB resolves the host and workspace from the active thread and environment |
| Realtime invalidation | Successful external writes refresh clean open documents without CRDT complexity |

## Quick example

```bash
# 1. Install from the tagged Git source.
bb plugin install git:https://github.com/Diffuzmetall/bb-plugin-excalidraw.git@v0.1.0 --yes

# 2. Confirm that BB loaded the plugin.
bb plugin list

# 3. Create a scene in the active thread's workspace.
bb excalidraw create drawings/system.excalidraw \
  --scene '{"elements":[{"id":"box-1","type":"rectangle","x":80,"y":80,"width":240,"height":100,"strokeColor":"#1b1b1f","backgroundColor":"#dbeafe"}]}' \
  --thread <thread-id> \
  --json

# 4. Read the model-safe scene summary and copy its revision.
bb excalidraw read drawings/system.excalidraw \
  --thread <thread-id> \
  --json

# 5. Apply a semantic operation against that exact revision.
bb excalidraw apply drawings/system.excalidraw \
  --expected-sha256 <sha256-from-read> \
  --operations '[{"type":"create","element":{"id":"label-1","type":"text","x":120,"y":110,"width":80,"height":32,"strokeColor":"#1b1b1f","backgroundColor":"transparent","text":"BB","fontSize":24,"color":"#1b1b1f"}}]' \
  --thread <thread-id> \
  --json

# 6. Read again to inspect the new revision.
bb excalidraw read drawings/system.excalidraw --thread <thread-id> --json
```

To use the canvas, choose **Excalidraw** as the default `.excalidraw` opener under **Settings → Files**, then open a drawing from the BB file browser. The canvas menu includes Excalidraw's native **Theme** control: choose light, dark, or system; the preference applies across drawings in this BB client and does not modify scene files.

## Design principles

1. **Workspace files are canonical.** The plugin reads and writes the real `.excalidraw` file through BB's workspace APIs.
2. **Mutations are compare-and-swap.** Read first, apply against the returned SHA-256 revision, then read again.
3. **The server owns authority.** Agent and CLI inputs cannot supply host IDs, workspace roots, absolute paths, or force flags.
4. **Model responses are semantic and bounded.** Scene summaries omit raw file content, image bodies, and deleted Excalidraw tombstones.
5. **Realtime means invalidation, not collaboration.** Successful writes notify other open views; this is not a CRDT or multiplayer cursor system.
6. **Unknown scene data survives edits.** Native app state, files, and unrecognized properties are preserved by scene transformations.

## Choose the right installation

| Option | Best for | Canvas | Agent/CLI tools | Update source |
| --- | --- | ---: | ---: | --- |
| BB bundled Excalidraw | Users whose BB release already includes the official plugin | Yes | Yes | BB release |
| This Git repository | Independent installation, review, or maintenance | Yes | Yes | Git tag |
| Generic JSON editor | Emergency inspection only | No | No | Not applicable |

Prefer the bundled copy when available because BB reserves official plugin IDs. Use this repository when the plugin is not bundled or when another agent needs an independently reviewable source tree.

## Installation

### Git source

Use the tagged Git source when Excalidraw is not already reserved as a bundled official plugin:

```bash
bb plugin install git:https://github.com/Diffuzmetall/bb-plugin-excalidraw.git@v0.1.0 --yes
bb plugin list
```

Requirements:

- BB 0.35.1 or newer
- BB Plugin SDK 0.4.x
- Node.js 22.19 or newer for Git-source installation
- Git and npm on `PATH`

### Bundled official plugin

Some BB releases ship Excalidraw as an official bundled plugin. In that case, the plugin ID is reserved and a second Git or local-path copy cannot shadow it:

```bash
bb plugin install excalidraw --yes
bb plugin list
```

### Development checkout

For development against a BB build where the `excalidraw` ID is not reserved:

```bash
git clone https://github.com/Diffuzmetall/bb-plugin-excalidraw.git
cd bb-plugin-excalidraw
npm install
npm run check
npm run test:browser
bb plugin build .
bb plugin install . --yes
bb plugin reload excalidraw
```

The repository is intentionally npm-shaped but has `private: true`; Git is the supported external distribution path, and accidental npm publication is disabled.

## CLI reference

All commands resolve workspace authority from `--thread` or the calling BB context. Paths must be normalized workspace-relative paths.

### Read

```bash
bb excalidraw read <path> [--thread <thread-id>] [--json]
```

Returns a bounded semantic summary and the current SHA-256 revision. It does not return raw scene JSON or base64 image bodies.

### Create

```bash
bb excalidraw create <path> \
  --scene '<semantic-scene-json>' \
  [--thread <thread-id>] \
  [--json]
```

Creates a new scene only when the destination does not already exist. A collision returns a structured conflict instead of overwriting the file.

### Apply

```bash
bb excalidraw apply <path> \
  --expected-sha256 <revision> \
  --operations '<operations-json>' \
  [--thread <thread-id>] \
  [--json]
```

Applies up to 500 semantic operations atomically. A stale revision returns the current revision and leaves the file unchanged.

## Agent tool reference

| Tool | Purpose |
| --- | --- |
| `excalidraw_scene_read` | Read a bounded semantic scene summary and revision |
| `excalidraw_scene_create` | Create a new scene without overwriting an existing path |
| `excalidraw_scene_apply` | Apply semantic operations against an expected revision |

Recommended agent workflow:

1. Call `excalidraw_scene_read`.
2. Plan operations from the returned summary.
3. Call `excalidraw_scene_apply` with the returned revision.
4. If a conflict is returned, read again and re-plan; never retry blindly.
5. Read once more to verify the result.

## Safety limits

| Limit | Value |
| --- | ---: |
| Scene file size | 20 MiB |
| Elements per scene | 10,000 |
| Operations per apply | 500 |
| Text per element | 20,000 Unicode code points |
| Model-facing response | 256 KiB |

Additional boundaries:

- no force overwrite;
- no absolute paths or traversal paths;
- no caller-supplied workspace roots or host IDs;
- no raw scene file content or base64 image bodies in agent/CLI inputs or responses;
- deleted Excalidraw tombstones are excluded from semantic summaries;
- external embeddables are disabled;
- link navigation is limited to HTTP and HTTPS.

## Architecture

```text
BB file browser / editor slot
            │
            ▼
     Excalidraw React canvas
            │ explicit save + writer nonce
            ▼
       Save coordinator
            │ expected SHA-256
            ▼
       BB workspace RPC ───────────────┐
            │                         │ successful write
            ▼                         ▼
 canonical .excalidraw file   realtime invalidation
            ▲                         │
            │                         ▼
   semantic scene adapter      other open canvas views
            ▲
            │
 agent tools / bb excalidraw CLI
```

BB supplies the Plugin SDK and shared frontend runtime when the plugin runs. The matching SDK files under `vendor/bb-plugin-sdk` exist only to make standalone typechecking and tests reproducible. Excalidraw's production stylesheet is checked in as `excalidraw.css` with its fonts inlined so Git and path installs can build without relying on conditional CSS exports.

## Development

```bash
npm ci
npm run typecheck
npm test
npx playwright install --with-deps chromium
npm run test:browser
bb plugin build .
```

`npm run check` runs typechecking plus the unit/integration suite. Browser tests cover canvas mounting, accessibility, link policy, and deterministic scene behavior. After upgrading `@excalidraw/excalidraw`, regenerate and review the vendored production stylesheet with `npm run vendor:css`.

Before publishing a tag, also verify a clean runtime-only source build:

```bash
sandbox=$(mktemp -d)
rsync -a --exclude .git --exclude node_modules --exclude dist ./ "$sandbox/"
cd "$sandbox"
npm install --ignore-scripts --omit=dev --omit=optional --no-audit --no-fund
bb plugin build .
```

Expected build artifacts:

```text
dist/
├── app.css
├── app.js
├── app.meta.json
├── server.js
├── server.js.map
└── server.meta.json
```

## Troubleshooting

### `plugin id "excalidraw" is reserved`

Your BB release already bundles the official plugin. Install it with:

```bash
bb plugin install excalidraw --yes
```

Do not try to shadow the bundled ID with a Git or local-path installation.

### A file opens as JSON instead of a canvas

Choose **Excalidraw** as the default `.excalidraw` opener under **Settings → Files**, then reopen the file.

### Build fails resolving `@excalidraw/excalidraw/index.css`

The Excalidraw package exports different CSS files through production/development conditions. Upgrade BB to a release with the compatible plugin builder, confirm `bb --version`, and retry `bb plugin build .`.

### Apply returns a conflict

Another writer changed the scene after your read. Read the scene again, plan against the new summary, and apply using the new SHA-256 revision. The plugin intentionally has no force-overwrite path.

### The plugin does not appear after installation

```bash
bb plugin list
bb plugin enable excalidraw
bb plugin reload excalidraw
```

Then inspect the BB server log for build or compatibility errors.

### Browser tests cannot find Chromium

```bash
npx playwright install --with-deps chromium
npm run test:browser
```

## Limitations

- This is not CRDT collaboration: there are no multiplayer cursors or automatic merge semantics.
- The plugin opens `.excalidraw` scenes, not arbitrary JSON, SVG, PNG, or JPEG files.
- Agent and CLI operations are semantic and bounded; they do not expose arbitrary raw scene editing.
- Image bodies stay in the workspace file and are not returned to models.
- Git-source installation needs Node.js, Git, npm, and a compatible BB plugin builder.
- `@excalidraw/excalidraw` is pinned to 0.18.1. Its Mermaid dependency graph currently carries transitive advisories described in [`SECURITY.md`](./SECURITY.md).

## FAQ

### Why not edit the JSON directly?

Direct JSON replacement bypasses semantic validation, scene preservation rules, response limits, and compare-and-swap conflict handling.

### Does the plugin upload drawings to an external service?

No. Workspace files remain canonical and are accessed through BB's workspace APIs. The plugin itself does not add an external storage service.

### Can an agent overwrite a newer human edit?

Not silently. Apply requires the revision returned by a previous read. If the revision is stale, the operation returns a conflict and does not write.

### Does realtime invalidation merge two dirty documents?

No. Clean documents reload after a foreign write. A dirty document keeps its local draft and enters a visible conflict state.

### Why is the Plugin SDK vendored?

Only to reproduce the SDK runtime and declarations used by standalone tests and typechecking. BB supplies the real SDK at runtime.

### Why is the package marked private if the GitHub repository is public?

`private: true` prevents accidental npm publication. The supported external installation source is Git.

### Can I install this over BB's bundled Excalidraw plugin?

No. Bundled official plugin IDs are reserved. Use the bundled copy supplied by that BB release.

## Security

This plugin runs as full-trust code inside the BB server process. Install only source and tags you trust. See [`SECURITY.md`](./SECURITY.md) for the authority model, vulnerability reporting, and current dependency-advisory status.

## Contributing

Bug reports and focused pull requests are welcome. Read [`CONTRIBUTING.md`](./CONTRIBUTING.md) before proposing changes, and preserve the workspace-authority, compare-and-swap, and model-output safety boundaries.

## License and attribution

MIT licensed. See:

- [`LICENSE`](./LICENSE)
- [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md)
- [`scene-adapter.ATTRIBUTION.md`](./scene-adapter.ATTRIBUTION.md)

The repository vendors BB Plugin SDK files for standalone development and includes the complete applicable MIT notice.