# Excalidraw diagram skill integration

The BB-native `excalidraw` skill incorporates general diagram-design ideas evaluated from [`coleam00/excalidraw-diagram-skill`](https://github.com/coleam00/excalidraw-diagram-skill), reviewed at commit `8646fcc9f74f38539c6cdb4c969723336a96ddcd`.

## Why this is an adaptation

The upstream repository did not contain a license when reviewed. Its prose, templates, renderer, and other files therefore were not copied into this project.

The BB skill was written independently around common diagram-design principles:

- geometry should express the relationship being explained;
- technical diagrams benefit from concrete terminology and examples;
- large diagrams should be built and reviewed in bounded sections;
- finished diagrams require a validation pass.

## BB-specific design

The upstream workflow writes native Excalidraw JSON and uses a separate Python/Playwright renderer. That would bypass this plugin's safety boundary.

The integrated skill instead:

- uses `excalidraw_scene_read`, `excalidraw_scene_create`, and `excalidraw_scene_apply`;
- uses SHA-256 compare-and-swap revisions;
- never asks the agent to edit native scene JSON;
- validates bounded summaries, connections, overlaps, and scene bounds;
- relies on BB's live Excalidraw canvas for final visual inspection;
- uses only element fields accepted by the semantic schema.

If the upstream project later adopts a compatible license, its rendering approach can be evaluated separately. It should not replace the semantic write boundary.
