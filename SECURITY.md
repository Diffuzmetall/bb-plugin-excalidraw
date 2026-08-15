# Security policy

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability. Use GitHub's private vulnerability reporting for this repository instead.

Include the affected version, reproduction steps, impact, and any suggested mitigation. Do not include real workspace data, credentials, tokens, or private Excalidraw files.

## Security model

This plugin runs as full-trust code inside the BB server process. Install only source and tags you trust.

Scene writes are confined to the workspace resolved by BB from the active thread and environment. Mutations use SHA-256 compare-and-swap and do not provide a force-overwrite path. Agent and CLI responses omit image bodies and raw file content.

## Dependency advisories

The plugin intentionally pins `@excalidraw/excalidraw` 0.18.1, the current
stable release used by this implementation. At the 0.1.1 release,
`npm audit --omit=dev` reports two high and seven moderate vulnerabilities in
the transitive Excalidraw dependency graph. The affected paths run through
Excalidraw's Mermaid integration to `nanoid`, `lodash-es`, Chevrotain, and
Langium. npm offers no patched Excalidraw version compatible with 0.18.1; its
suggested automatic fix is a downgrade to 0.17.6.

This plugin does not expose Mermaid parsing as an agent or CLI operation, and
external embeddables are disabled. That reduces exposure but does not make the
advisories disappear. Maintainers should review each upstream Excalidraw
release and upgrade as soon as a compatible patched version is available.
