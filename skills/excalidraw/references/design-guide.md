# BB Excalidraw design guide

Use this guide to turn a verbal explanation into a readable semantic diagram.

## Choose the level of detail

Use an overview when the user needs orientation, a decision, or a quick explanation. Keep one dominant flow and only the components required to understand it.

Use a teaching diagram when the user needs to implement or debug a real system. Include concrete event names, endpoints, state transitions, short payload examples, or implementation terms. Separate the overview from the details with frames or spatial regions.

## Establish a visual sentence

Write a one-line claim before laying out elements. Examples:

- Requests fan out to independent workers and converge at aggregation.
- A draft crosses validation and approval boundaries before publication.
- Client state advances through ordered events and can return through retry.

The geometry should make that sentence visible. If the same row of rectangles could represent any subject, the structure is not specific enough.

## Pattern selection

### Flow

Place actions in reading order and connect every transition. Use consistent vertical centers for left-to-right flows or consistent horizontal centers for top-to-bottom flows.

### Fan-out

Use one source, multiple separated targets, and one arrow per target. Keep target spacing regular so arrows have distinct routes.

### Convergence

Place inputs along one axis and the result beyond a shared convergence area. Route arrows so their endpoints remain distinguishable.

### Decision

Use a diamond for the condition. Label outgoing arrows with outcomes. Do not encode outcomes by position alone.

### Timeline

Use a line as the spine, small markers for milestones, and nearby free-standing text. Keep intervals consistent unless duration itself is meaningful.

### Hierarchy

Use a frame for a real ownership or system boundary. Use lines and text for lightweight taxonomy. Avoid nesting frames when whitespace already communicates grouping.

### Feedback loop

Keep the forward path dominant and route the return arrow outside it. Label the condition that causes repetition.

### Comparison

Use parallel lanes, common baselines, and matching scale. Encode differences with labels, color purpose, or a changed structure—not arbitrary decoration.

## Layout defaults

These are starting points, not hard limits:

- title text: 28–36 px;
- section heading: 20–26 px;
- labels: 16–20 px;
- primary process: about 220×100;
- secondary process: about 160×80;
- gap within a sequence: 100–160 px;
- gap between major regions: 220–320 px;
- outer margin: at least 80 px.

Give the most important element more size or surrounding whitespace. Keep arrow paths short and avoid placing unrelated elements between connected endpoints.

## Color vocabulary

Use a small, repeatable palette. Colors indicate purpose rather than ownership by random categories.

| Purpose | Fill | Stroke |
| --- | --- | --- |
| Neutral/process | `#e7f5ff` | `#1971c2` |
| Start/input | `#fff3bf` | `#e67700` |
| Success/output | `#d3f9d8` | `#2b8a3e` |
| Decision | `#ffec99` | `#f08c00` |
| AI/automation | `#e5dbff` | `#7048e8` |
| Warning/error | `#ffe3e3` | `#c92a2a` |
| Neutral text/line | `transparent` | `#1e1e1e` |

Keep text dark on light fills. Use the same fill/stroke pair for the same semantic purpose throughout one scene.

## Labels and evidence

Use short labels inside shapes. Put explanations, examples, and annotations in separate text elements nearby.

For technical teaching diagrams, include only evidence that helps the reader understand a real boundary or transformation. A short event sequence or payload fragment is useful; a large wall of code is not.

## Review questions

- Can the reader find the start in one glance?
- Does every arrow have an unambiguous source and destination?
- Are decision outcomes named?
- Are section boundaries meaningful rather than decorative?
- Is any shape present only to hold text?
- Are technical details concrete and accurate?
- Do unintended shape overlaps or arrow crossings remain?
