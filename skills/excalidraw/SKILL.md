---
name: excalidraw
description: Use when reading, creating, or safely applying semantic changes to an Excalidraw workspace scene.
---

# Excalidraw scenes

Use semantic reads and mutations. Do not edit native `.excalidraw` JSON directly.

1. Read first: `bb excalidraw read <path> --thread <thread-id> --json`.
2. Use the returned revision to plan a create or apply operation.
3. Create only new paths. Apply uses the read revision as `expectedSha256`.
4. Read again and inspect bounds, labels, connections, overlaps, and image metadata.

The CLI uses its current thread context when available; otherwise `--thread` is
required. The server resolves workspace authority from that thread per call.
Never provide host IDs, root paths, absolute paths, raw scene bytes, data URLs,
or a force-overwrite option.

Commands:

- `bb excalidraw read <path> [--thread <thread-id>] --json`
- `bb excalidraw create <path> [--thread <thread-id>] --json`
- `bb excalidraw apply <path> [--thread <thread-id>] --json`

On a conflict, read again, reconsider the semantic operation, and retry only
with the new revision. Do not attempt an unconditional overwrite.
