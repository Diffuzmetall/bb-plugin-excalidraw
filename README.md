<p align="center">
  <img src="./branding/icon.svg" width="96" height="96" alt="BB Excalidraw plugin icon">
</p>

<h1 align="center">BB Excalidraw plugin</h1>

<p align="center">
  Native Excalidraw canvases in BB, plus a diagram-design skill, revision-safe agent tools, and matching CLI commands.
</p>

<p align="center">
  <a href="https://github.com/Diffuzmetall/bb-plugin-excalidraw/actions/workflows/ci.yml"><img src="https://github.com/Diffuzmetall/bb-plugin-excalidraw/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/BB-%3E%3D0.35.1-6c5ce7" alt="BB 0.35.1 or newer">
  <img src="https://img.shields.io/badge/Node.js-%3E%3D22.19.0-339933" alt="Node.js 22.19 or newer">
</p>

```bash
bb plugin install git:https://github.com/Diffuzmetall/bb-plugin-excalidraw.git@v0.1.1 --yes
```

> If your BB release already bundles Excalidraw, install the bundled copy with `bb plugin install excalidraw --yes` instead. Official plugin IDs cannot be shadowed by another installation.

## What this plugin does

An `.excalidraw` file is JSON, but treating it as generic JSON loses the interactive canvas and gives agents an unsafe, unbounded mutation surface. This plugin provides one workflow for humans and agents while keeping the workspace file canonical:

- humans edit the real scene through a native Excalidraw canvas inside BB;
- agents receive a BB-native diagram-design skill and three typed semantic tools;
- scripts use equivalent `bb excalidraw` read, create, and apply commands;
- every mutation is protected by SHA-256 compare-and-swap;
- clean open canvases reconcile external writes immediately;
- dirty local drafts remain visible and enter a conflict state instead of being overwritten.

## Included capabilities

| Capability | Behavior |
| --- | --- |
| Native file opener | Opens `.excalidraw` files as an interactive canvas instead of raw JSON |
| Workspace launcher | **New tab → Actions → Excalidraw** discovers and switches between existing workspace drawings |
| Native theme control | The canvas menu provides Excalidraw's light, dark, and system selector |
| Diagram-design skill | Teaches agents how to plan workflows, architectures, timelines, decisions, comparisons, and feedback loops |
| Semantic agent tools | Read bounded summaries, create scenes, and apply typed operations without native JSON editing |
| CLI parity | Exposes the same safe read/create/apply lifecycle through `bb excalidraw` |
| Safe concurrency | Uses expected revisions, writer nonces, realtime invalidation, and visible dirty conflicts |
| Scene preservation | Preserves native app state, files, images, and unknown properties that semantic operations do not target |
| Model-safe reads | Omits raw scene bytes, base64 image bodies, and deleted Excalidraw tombstones |
| Workspace authority | Resolves the host and workspace from the active BB thread and environment |

## Five-minute quick start

### 1. Install and verify

```bash
bb plugin install git:https://github.com/Diffuzmetall/bb-plugin-excalidraw.git@v0.1.1 --yes
bb plugin list
```

For a development checkout, install the local path instead:

```bash
git clone https://github.com/Diffuzmetall/bb-plugin-excalidraw.git
cd bb-plugin-excalidraw
npm install
npm run check
bb plugin build .
bb plugin install . --yes
bb plugin reload excalidraw
```

### 2. Open or create a drawing

To open an existing scene:

1. Choose **Excalidraw** as the default `.excalidraw` opener under **Settings → Files**.
2. Open the file from BB Files, or choose **New tab → Actions → Excalidraw**.
3. If the workspace contains several drawings, select one from the **Drawing** menu.

The launcher lists existing scenes; it does not invent an empty file. Create a new drawing with an agent or the CLI first.

Example agent request:

> Create `diagrams/order-lifecycle.excalidraw`. Show intake, validation, a payment decision, fulfillment, and a labeled retry loop. Use the Excalidraw tools, validate the final connections, and summarize what you created.

Equivalent CLI create:

```bash
bb excalidraw create diagrams/order-lifecycle.excalidraw \
  --thread <thread-id> \
  --scene '{
    "elements": [
      {
        "id": "intake",
        "type": "rectangle",
        "x": 100,
        "y": 120,
        "width": 220,
        "height": 100,
        "strokeColor": "#1971c2",
        "backgroundColor": "#e7f5ff",
        "label": {
          "id": "intake_label",
          "text": "Order intake",
          "fontSize": 20,
          "color": "#1e1e1e"
        }
      }
    ]
  }' \
  --json
```

### 3. Use the canvas theme selector

Open the canvas menu and use the native **Theme** row:

- sun: light mode;
- moon: dark mode;
- monitor: follow the BB/system light-dark mode.

The preference applies across drawings in this BB client. Theme changes are UI-only: they do not dirty or rewrite scene files.

## Agent-native diagram skill

The plugin contributes the `excalidraw` skill to workspace-backed BB agents. It is enabled together with these tools:

| Tool | Purpose |
| --- | --- |
| `excalidraw_scene_read` | Read a bounded semantic summary and current revision |
| `excalidraw_scene_create` | Create a scene at a new workspace-relative path |
| `excalidraw_scene_apply` | Atomically apply semantic operations against an expected revision |

The agent is explicitly instructed to use the semantic tools or CLI and never edit native `.excalidraw` JSON directly.

### What the skill teaches

The skill treats a diagram as a visual explanation rather than a grid of labeled cards. Before drawing, the agent identifies:

- the audience and the question the diagram must answer;
- the primary reading direction;
- the dominant entity, transition, or result;
- whether the output is an overview or a technical teaching artifact;
- whether each relationship is sequential, causal, hierarchical, optional, convergent, or bidirectional.

It then chooses geometry that expresses that meaning:

| Diagram pattern | Recommended structure |
| --- | --- |
| Sequence or workflow | One dominant horizontal or vertical flow with every transition connected |
| Fan-out | One source, separated targets, and one distinct arrow per target |
| Convergence | Multiple inputs aligned toward one clearly separated result |
| Decision | A diamond with explicitly labeled outgoing outcomes |
| Timeline | A spine, ordered markers, and nearby free-standing milestone labels |
| Hierarchy | A tree or meaningful framed system boundaries |
| Feedback loop | A dominant forward path with the return arrow routed outside it |
| Comparison | Parallel lanes with common baselines and matching scale |
| System architecture | Owned components grouped in frames, with concrete boundary and event labels |

The complete guidance lives in [`skills/excalidraw/references/design-guide.md`](./skills/excalidraw/references/design-guide.md).

### Safe agent workflow

For an existing scene, the expected loop is:

1. **Read** — inspect the revision, bounds, labels, connections, overlaps, images, and element counts.
2. **Plan** — choose stable semantic IDs, coordinates, regions, and arrow routes before writing.
3. **Apply** — send one bounded create/update/delete batch using the exact revision from the read.
4. **Handle conflicts** — if the revision is stale, read again and re-plan; never retry blindly.
5. **Validate** — read again and verify the new revision, expected labels, bound connections, plausible bounds, and intentional overlaps.
6. **Inspect visually** — ask the user to review the live BB canvas when spacing, clipping, hierarchy, or crossings require human judgment.

For larger diagrams, the skill builds in coherent passes:

1. establish the main flow and major regions;
2. add one region per apply batch;
3. connect regions only after both endpoints exist;
4. namespace IDs by region, such as `ingest_queue` and `review_decision`;
5. read and validate after every meaningful batch.

### Visual defaults

The skill includes practical starting values rather than forcing one visual style:

- title text: 28–36 px;
- section headings: 20–26 px;
- labels: 16–20 px;
- primary process: approximately 220×100;
- secondary process: approximately 160×80;
- sequence gap: 100–160 px;
- major-region gap: 220–320 px;
- outer margin: at least 80 px.

Its default palette assigns color by semantic purpose:

| Purpose | Fill | Stroke |
| --- | --- | --- |
| Neutral process | `#e7f5ff` | `#1971c2` |
| Start or input | `#fff3bf` | `#e67700` |
| Success or output | `#d3f9d8` | `#2b8a3e` |
| Decision | `#ffec99` | `#f08c00` |
| AI or automation | `#e5dbff` | `#7048e8` |
| Warning or error | `#ffe3e3` | `#c92a2a` |
| Neutral text or line | `transparent` | `#1e1e1e` |

### Useful agent prompts

Create a technical architecture:

> Create `diagrams/event-processing.excalidraw`. Explain how API requests fan out to workers and converge at aggregation. Include concrete event names, frame the backend boundary, and validate every connection after creation.

Improve an existing workflow:

> Read `diagrams/release-flow.excalidraw`, preserve its current content, and make the approval decision and rollback loop easier to read. Use the current revision, then read again and report the final bounds and connections.

Create a teaching diagram:

> Build `diagrams/session-reconnect.excalidraw` as a technical teaching diagram. Show the client, WebSocket, reconnect state, invalidation event, and CAS retry. Use short implementation-level labels instead of generic boxes.

## Semantic scene contract

The semantic contract is intentionally smaller than native Excalidraw JSON. It supports the visual primitives agents need while keeping writes typed, reviewable, and bounded.

### Supported elements

| Element | Key semantic fields |
| --- | --- |
| `rectangle`, `ellipse`, `diamond` | Position, size, colors, optional bound label |
| `text` | Position, dimensions, text, font size, color |
| `arrow` | Relative points, optional label, optional start/end bindings |
| `line` | Relative points and optional label, without bindings |
| `frame` | Position, dimensions, colors, and boundary name |

Common fields include stable `id`, coordinates, dimensions, `strokeColor`, `backgroundColor`, optional `groupIds`, and optional `frameId`. IDs are 1–128 characters and use letters, numbers, `_`, or `-`.

For the full field-level contract and valid examples, read [`skills/excalidraw/references/semantic-format.md`](./skills/excalidraw/references/semantic-format.md).

### Read output

A semantic read returns a model-safe summary rather than native scene JSON:

- current SHA-256 `revision`;
- scene `bounds`;
- total and per-type element counts;
- semantic IDs, types, labels, groups, and frame membership;
- arrow connection endpoints;
- detected overlaps;
- bounded image metadata without image bodies;
- truncation and omitted-element indicators.

Deleted native elements are excluded. Responses are capped at 256 KiB and progressively omit overlap, image, connection, and element detail when necessary.

### Apply operations

Apply accepts an atomic array of three operation types:

```json
[
  {
    "type": "create",
    "element": {
      "id": "published",
      "type": "ellipse",
      "x": 860,
      "y": 120,
      "width": 180,
      "height": 90,
      "strokeColor": "#2b8a3e",
      "backgroundColor": "#d3f9d8"
    }
  },
  {
    "type": "update",
    "id": "review",
    "elementType": "diamond",
    "changes": {
      "x": 520,
      "width": 200
    }
  },
  {
    "type": "delete",
    "id": "obsolete_note"
  }
]
```

Each semantic ID may be targeted only once in a batch. Updates declare the existing element type so unsupported field combinations fail validation instead of being silently ignored.

## CLI reference

All commands resolve workspace authority from `--thread` or the calling BB context. Paths must be normalized, workspace-relative `.excalidraw` paths.

### Read

```bash
bb excalidraw read <path> [--thread <thread-id>] [--json]
```

Returns the bounded semantic summary and current revision.

### Create

```bash
bb excalidraw create <path> \
  --scene '<semantic-scene-json>' \
  [--thread <thread-id>] \
  [--json]
```

Create is create-only. If the destination exists, the command returns a structured conflict and does not overwrite it.

### Apply

```bash
bb excalidraw apply <path> \
  --expected-sha256 <revision> \
  --operations '<semantic-operations-json>' \
  [--thread <thread-id>] \
  [--json]
```

Apply supports up to 500 operations atomically. A stale revision returns the current revision and leaves the file unchanged.

Inside a BB agent thread, the CLI can infer the thread. Outside a thread context, provide `--thread <thread-id>`.

## Canvas and concurrency behavior

The canvas and semantic writers coordinate around the same canonical workspace file.

### Human edits

- The editor does not save merely because it mounted.
- Viewport movement and theme changes are not durable scene changes.
- Pointer-up, blur, and Mod+S flush a real dirty draft.
- Save status stays hidden while clean and appears only while loading, dirty, saving, conflicted, or failed.

### External agent or CLI writes

- A clean editor reads and imperatively applies the new scene to the mounted Excalidraw canvas.
- Programmatic reconciliation is excluded from undo history and does not bounce the old canvas back to disk.
- A dirty editor retains the exact local draft and shows a conflict.
- **Reload** discards the dirty draft, reads the current file, and reconciles the real canvas.
- Closing the final editor releases its save coordinator so a later reopen starts from the current file.

Realtime invalidation is not CRDT collaboration. There are no multiplayer cursors, automatic field merges, or silent last-writer-wins behavior.

## Safety boundaries

| Limit | Value |
| --- | ---: |
| Scene file size | 20 MiB |
| Expanded elements per scene | 10,000 |
| Operations per apply | 500 |
| Text per element | 20,000 Unicode code points |
| Points per line or arrow | 1,000 |
| Model-facing response | 256 KiB |

Additional invariants:

- no force-overwrite operation;
- no absolute or traversal paths;
- no caller-supplied workspace roots or host IDs;
- no raw scene content or base64 image bodies in agent/CLI inputs or responses;
- no native `.excalidraw` JSON editing by agents;
- no external embeddables;
- link navigation is limited to HTTP and HTTPS;
- unknown native data and image files survive semantic edits.

## Architecture

```text
                         workspace-backed BB agent
                                   │
                    excalidraw skill + instructions
                                   │
          ┌────────────────────────┴────────────────────────┐
          │                                                 │
 semantic read/create/apply tools                 bb excalidraw CLI
          │                                                 │
          └────────────────────────┬────────────────────────┘
                                   ▼
                      semantic schema + adapter
                                   │ expected SHA-256
                                   ▼
BB Files / Actions ──► Excalidraw canvas ──► save coordinator
          │                    │                     │
          │                    └──── dirty conflict ┤
          │                                          ▼
          └──────────────────────────────► canonical workspace file
                                                     │
                                             successful write
                                                     ▼
                                            realtime invalidation
                                                     │
                                             other open canvases
```

BB supplies the Plugin SDK and shared frontend runtime. The files under `vendor/bb-plugin-sdk` reproduce that runtime and its declarations only for standalone typechecking and tests.

Excalidraw's production stylesheet is checked in as `excalidraw.css`, with fonts inlined, so Git and path installs do not depend on conditional package CSS exports.

## Installation options

| Option | Use when | Command |
| --- | --- | --- |
| Bundled official plugin | Your BB release reserves the `excalidraw` plugin ID | `bb plugin install excalidraw --yes` |
| Tagged Git source | BB does not bundle the plugin | `bb plugin install git:https://github.com/Diffuzmetall/bb-plugin-excalidraw.git@v0.1.1 --yes` |
| Local path | Developing or testing this checkout | `bb plugin install . --yes` |

Requirements for a source installation:

- BB 0.35.1 or newer;
- BB Plugin SDK 0.4.x compatibility;
- Node.js 22.19 or newer;
- Git and npm on `PATH`.

The package is intentionally marked `private: true`. Git is the supported external distribution path; accidental npm publication is disabled.

## Development

```bash
npm ci
npm run typecheck
npm test
npx playwright install --with-deps chromium
npm run test:browser
bb plugin build .
```

`npm run check` runs typechecking and the unit/integration suite. Browser tests exercise the real canvas, native theme control, accessibility, link policy, external reconciliation, dirty conflicts, Reload, and reopen behavior.

CI also installs only production dependencies and builds the plugin with the
BB 0.35.1 CLI, matching the Git-source installation path used by released
tags.

After upgrading `@excalidraw/excalidraw`, regenerate and review the vendored stylesheet:

```bash
npm run vendor:css
```

Before publishing a tag, verify a runtime-only source build:

```bash
sandbox=$(mktemp -d)
rsync -a --exclude .git --exclude node_modules --exclude dist ./ "$sandbox/"
cd "$sandbox"
npm install --ignore-scripts --omit=dev --omit=optional --no-audit --no-fund
bb plugin build .
```

Expected artifacts:

```text
dist/
├── app.css
├── app.js
├── app.meta.json
├── server.js
├── server.js.map
└── server.meta.json
```

## Repository structure

```text
.
├── app.tsx                         # Canvas file opener, launcher, theme, and conflict UI
├── server.ts                       # RPC, agent tools, skill/tool configuration, and CLI registration
├── cli.ts                          # bb excalidraw command surface
├── scene-service.ts                # Workspace authority and scene read/write handlers
├── save-coordinator.ts             # Debounce, CAS saves, conflict state, and realtime reconciliation
├── semantic-schema.ts              # Strict semantic scene and operation contracts
├── scene-adapter.ts                # Native Excalidraw ↔ semantic transformations
├── scene-read-summary.ts           # Bounded model-safe scene summaries
├── realtime-invalidation.ts        # Writer filtering and reconciliation decisions
├── skills/excalidraw/
│   ├── SKILL.md                    # Agent workflow and completion checklist
│   └── references/
│       ├── design-guide.md         # Layout patterns, palette, hierarchy, and review guidance
│       └── semantic-format.md      # Supported fields, operations, and JSON examples
├── docs/
│   └── excalidraw-diagram-skill-integration.md
├── scripts/vendor-excalidraw-css.mjs
└── vendor/bb-plugin-sdk/           # Standalone SDK runtime/types used by tests and typecheck
```

## Documentation

| Document | Contents |
| --- | --- |
| [`skills/excalidraw/SKILL.md`](./skills/excalidraw/SKILL.md) | Agent planning, mutation, conflict, and validation workflow |
| [`skills/excalidraw/references/design-guide.md`](./skills/excalidraw/references/design-guide.md) | Diagram patterns, dimensions, palette, labels, and review questions |
| [`skills/excalidraw/references/semantic-format.md`](./skills/excalidraw/references/semantic-format.md) | Complete semantic element and operation examples |
| [`docs/excalidraw-diagram-skill-integration.md`](./docs/excalidraw-diagram-skill-integration.md) | Provenance and BB-native adaptation rationale |
| [`SECURITY.md`](./SECURITY.md) | Authority model, reporting, and dependency advisories |
| [`CONTRIBUTING.md`](./CONTRIBUTING.md) | Development workflow and invariants for changes |
| [`CHANGELOG.md`](./CHANGELOG.md) | Released and unreleased behavior |

## Troubleshooting

### `plugin id "excalidraw" is reserved`

Your BB release already bundles the official plugin. Use:

```bash
bb plugin install excalidraw --yes
```

Do not try to shadow the bundled plugin ID with a Git or local-path copy.

### A file opens as JSON

Choose **Excalidraw** under **Settings → Files**, then reopen the `.excalidraw` file.

### Actions says no drawings were found

The launcher only lists existing workspace files. Ask an agent to create a scene with `excalidraw_scene_create`, or use `bb excalidraw create`, then reopen the action.

### The agent cannot see the Excalidraw skill or tools

Verify that:

- `bb plugin list` reports `excalidraw` as running;
- the thread uses a workspace-backed environment;
- the plugin has been reloaded after installation.

The plugin deliberately supplies no workspace tools when the agent environment has no workspace path.

### Apply returns a conflict

Another writer changed the scene after the last read. Read again, plan against the new summary, and apply using the new revision. There is intentionally no force option.

### The canvas is light while BB uses a dark palette

Open the canvas menu and choose the moon for explicit dark mode, or the monitor to follow BB/system light-dark mode. BB palette selection and BB light-dark mode are separate settings.

### Build cannot resolve Excalidraw CSS or fonts

Upgrade to a compatible BB plugin builder, confirm `bb --version`, and retry `bb plugin build .`. The repository vendors the resolved production CSS and inlined fonts for source-install compatibility.

### Browser tests cannot find Chromium

```bash
npx playwright install --with-deps chromium
npm run test:browser
```

## Limitations

- This is realtime invalidation with conflict protection, not multiplayer CRDT collaboration.
- The file opener handles `.excalidraw` scenes, not arbitrary JSON, SVG, PNG, or JPEG files.
- Semantic operations expose supported diagram primitives, not arbitrary native Excalidraw fields.
- Images are preserved, but image bodies are not returned to agents or CLI consumers.
- The launcher discovers existing drawings; scene creation belongs to the agent tools or CLI.
- Git-source installation requires Node.js, Git, npm, and a compatible BB plugin builder.
- `@excalidraw/excalidraw` is pinned to 0.18.1. Its transitive Mermaid dependency advisories are documented in [`SECURITY.md`](./SECURITY.md).

## Skill provenance

The BB-native skill independently adapts general diagram-design ideas evaluated from `coleam00/excalidraw-diagram-skill`. That repository had no license when reviewed, so its prose, templates, renderer, and code were not copied.

This integration uses BB semantic tools and the live canvas instead of raw JSON, Python rendering, or Playwright-driven scene generation. See [`docs/excalidraw-diagram-skill-integration.md`](./docs/excalidraw-diagram-skill-integration.md) for details.

## Security

This plugin runs as full-trust code inside the BB server process. Install only source and tags you trust. Report suspected vulnerabilities privately as described in [`SECURITY.md`](./SECURITY.md); do not attach real workspace scenes, tokens, or credentials.

## Contributing

Bug reports and focused pull requests are welcome. Read [`CONTRIBUTING.md`](./CONTRIBUTING.md), and preserve the workspace-authority, compare-and-swap, bounded-output, and no-raw-JSON boundaries.

## License and attribution

MIT licensed. See:

- [`LICENSE`](./LICENSE)
- [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md)
- [`scene-adapter.ATTRIBUTION.md`](./scene-adapter.ATTRIBUTION.md)
