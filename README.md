# BB Excalidraw plugin

View, edit, and safely automate `.excalidraw` drawings in [BB](https://github.com/get-bb/bb).

The plugin embeds Excalidraw in BB, keeps workspace files canonical, and exposes bounded semantic operations to agents and the `bb` CLI. It does not run a sidecar service or expose raw image data to models.

## Install

Install the tagged Git source:

```bash
bb plugin install git:https://github.com/Diffuzmetall/bb-plugin-excalidraw.git@v0.1.0 --yes
bb plugin list
```

If your BB release already bundles Excalidraw as an official plugin, use the bundled copy instead:

```bash
bb plugin install excalidraw --yes
```

Then choose Excalidraw as the default `.excalidraw` opener under **Settings → Files**.

Requirements:

- BB 0.35.1 or newer
- BB Plugin SDK 0.4.x
- Node.js 22.19 or newer when installing from Git
- Git and npm on `PATH` for Git-source installation

## Capabilities

- Native `.excalidraw` canvas inside BB
- Explicit save with SHA-256 compare-and-swap conflict protection
- Clean-document reload and dirty-document conflict retention
- Workspace confinement resolved from the active thread and environment
- Semantic agent tools:
  - `excalidraw_scene_read`
  - `excalidraw_scene_create`
  - `excalidraw_scene_apply`
- Matching CLI commands:

```bash
bb excalidraw read drawings/flow.excalidraw --thread <thread-id> --json
bb excalidraw create drawings/new.excalidraw --scene '<json>' --thread <thread-id> --json
bb excalidraw apply drawings/flow.excalidraw \
  --expected-sha256 <sha256> \
  --operations '<json>' \
  --thread <thread-id> \
  --json
```

Read a scene first, apply against the returned revision, and read again to inspect the result.

## Safety limits

- Maximum scene size: 20 MiB
- Maximum elements: 10,000
- Maximum operations per apply: 500
- Maximum text length: 20,000 Unicode code points per element
- Maximum model-facing response: 256 KiB
- No force overwrite, absolute paths, workspace roots, host IDs, raw file content, or base64 image bodies in agent/CLI inputs
- External embeddables are disabled; links are limited to HTTP and HTTPS

## Development

```bash
npm install
npm run check
npm run test:browser
bb plugin build .
```

The repository vendors the matching BB Plugin SDK 0.4.1 runtime and declarations under `vendor/bb-plugin-sdk` only to keep standalone typechecking and tests reproducible. BB supplies the SDK at plugin runtime.

For local path development on a BB build where the `excalidraw` id is not reserved:

```bash
bb plugin install . --yes
bb plugin reload excalidraw
```

## Licensing

The plugin is MIT licensed. See [`LICENSE`](./LICENSE), [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md), and [`scene-adapter.ATTRIBUTION.md`](./scene-adapter.ATTRIBUTION.md).
