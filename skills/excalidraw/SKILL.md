---
name: excalidraw
description: Design, create, inspect, and safely revise clear Excalidraw diagrams in a BB workspace using semantic tools. Use for architectures, workflows, timelines, comparisons, concept maps, and visual explanations.
---

# Excalidraw diagram workflow

Create diagrams as visual explanations, not collections of labeled boxes. Make the layout communicate sequence, hierarchy, branching, convergence, boundaries, or feedback before the labels are read.

Use BB's semantic Excalidraw tools. Never edit native `.excalidraw` JSON directly.

## 1. Clarify the diagram

Before changing a scene, identify:

- the audience and the question the diagram must answer;
- the primary reading direction;
- the most important element or transition;
- whether the user needs a concise overview or a technical teaching artifact;
- which relationships are causal, sequential, hierarchical, optional, or bidirectional.

For a technical diagram, verify real names, APIs, event types, or payload examples before drawing. Prefer concrete evidence over generic labels when the details matter.

Read [references/design-guide.md](references/design-guide.md) before creating a substantial diagram.

## 2. Read before writing

For an existing file, call `excalidraw_scene_read` first. Use its `revision`, bounds, labels, connections, overlaps, and element counts to plan the change.

For a new file, choose a new workspace-relative `.excalidraw` path. Create is create-only and must never replace an existing scene.

Prefer the native tools:

- `excalidraw_scene_read`
- `excalidraw_scene_create`
- `excalidraw_scene_apply`

The equivalent CLI is available through Bash:

```bash
bb excalidraw read <path> --json
bb excalidraw create <path> --scene '<semantic-scene-json>' --json
bb excalidraw apply <path> \
  --expected-sha256 <revision> \
  --operations '<semantic-operations-json>' \
  --json
```

Inside a BB agent thread, the CLI infers the thread. Outside a thread, add `--thread <thread-id>`.

Read [references/semantic-format.md](references/semantic-format.md) for the supported element fields and examples. Do not send native Excalidraw fields that are absent from the semantic contract.

## 3. Plan before creating elements

Assign stable, descriptive semantic IDs. Plan coordinates and connections before calling create or apply.

Use visual structures that match the meaning:

- sequence: horizontal or vertical flow;
- one-to-many: fan-out from a clear source;
- many-to-one: convergence into the result;
- hierarchy: tree or framed regions;
- decision: diamond with explicitly labeled outcomes;
- feedback: closed loop with a readable return path;
- comparison: parallel lanes with aligned baselines;
- lifecycle: timeline with ordered milestones;
- system boundary: frame containing owned components.

Avoid equal-card grids unless the concepts are genuinely peers. Use free-standing text for titles and annotations; use a labeled shape only when the shape represents an entity, state, action, decision, or endpoint.

## 4. Build in bounded passes

For a small diagram, create the complete scene in one operation.

For a larger diagram:

1. establish the main flow and section bounds;
2. add one coherent region per apply batch;
3. add cross-region arrows after both endpoints exist;
4. keep IDs namespaced by region, such as `ingest_queue` or `review_decision`;
5. read after each meaningful batch.

Place new content relative to the returned scene bounds when editing an existing scene. Leave generous gaps between regions and shorter, consistent gaps within a region.

## 5. Validate semantically

After every create or apply, read the scene again and verify:

- the returned revision changed after a write;
- expected labels and element types exist;
- each intended relationship appears in `connections`;
- arrows bind to the correct semantic IDs;
- bounds are plausible and not unexpectedly huge;
- shape-to-shape overlaps are intentional;
- label/container overlaps are expected and can be ignored;
- the result is not truncated and no elements were unexpectedly omitted.

Then ask the user to inspect the live BB canvas when visual judgement is important. If the user reports clipping, crossings, crowding, or weak hierarchy, adjust coordinates, dimensions, labels, or arrow points with another CAS-guarded apply.

## 6. Handle conflicts safely

Apply must use the exact revision returned by the latest read. On conflict:

1. read again;
2. reconsider the operation against the new scene;
3. retry only with the new revision.

Never force overwrite, pass absolute paths, expose workspace roots or host IDs, include raw scene bytes, or use data URLs.

## Completion checklist

Before reporting completion, confirm:

- the visual structure matches the intended meaning;
- the reading direction is obvious;
- important elements have stronger scale or spacing;
- labels are concise and concrete;
- technical claims use real terminology;
- connections and decisions are explicit;
- repeated elements are aligned and evenly spaced;
- semantic read validation passes after the final write.
