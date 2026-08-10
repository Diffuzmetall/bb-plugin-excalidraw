# Semantic scene format

BB Excalidraw tools accept a deliberately smaller contract than native Excalidraw JSON. Use only the fields documented here.

## Scene

A create scene contains one array:

```json
{
  "elements": []
}
```

Element and label IDs must be unique, 1–128 characters, and contain only letters, numbers, `_`, or `-`. Coordinates are absolute scene coordinates. Colors are `transparent`, `#RRGGBB`, or `#RRGGBBAA`.

## Common fields

Every element requires:

```json
{
  "id": "semantic_id",
  "type": "rectangle",
  "x": 100,
  "y": 100,
  "width": 220,
  "height": 100,
  "strokeColor": "#1971c2",
  "backgroundColor": "#e7f5ff"
}
```

Optional common fields:

- `groupIds`: unique semantic group IDs, default `[]`;
- `frameId`: containing frame ID or `null`, default `null`.

## Shapes and labels

`rectangle`, `ellipse`, and `diamond` share the common fields and may include one label:

```json
{
  "id": "validate",
  "type": "diamond",
  "x": 420,
  "y": 100,
  "width": 180,
  "height": 120,
  "strokeColor": "#f08c00",
  "backgroundColor": "#ffec99",
  "label": {
    "id": "validate_label",
    "text": "Valid?",
    "fontSize": 22,
    "color": "#1e1e1e"
  }
}
```

Labels are created and bound by the adapter. Do not create a second standalone text element for the same label.

## Standalone text

Text requires both common dimensions/colors and text-specific fields:

```json
{
  "id": "diagram_title",
  "type": "text",
  "x": 100,
  "y": 20,
  "width": 520,
  "height": 50,
  "strokeColor": "transparent",
  "backgroundColor": "transparent",
  "text": "Publishing workflow",
  "fontSize": 34,
  "color": "#1e1e1e"
}
```

Use realistic width and height estimates. If the canvas shows wrapping or clipping, increase dimensions or shorten the text.

## Arrows

Arrow points are relative to the arrow's `x` and `y`. Width and height describe the relative point bounds and may be zero for a straight horizontal or vertical arrow.

```json
{
  "id": "validate_to_publish",
  "type": "arrow",
  "x": 600,
  "y": 160,
  "width": 180,
  "height": 0,
  "strokeColor": "#2b8a3e",
  "backgroundColor": "transparent",
  "points": [[0, 0], [180, 0]],
  "startBinding": { "elementId": "validate" },
  "endBinding": { "elementId": "publish" },
  "label": {
    "id": "validate_to_publish_label",
    "text": "yes",
    "fontSize": 16,
    "color": "#1e1e1e"
  }
}
```

Use `null` for an unbound start or end. Use three or more points to route around another region.

## Lines

Lines use common fields plus relative points. They do not have bindings:

```json
{
  "id": "timeline_spine",
  "type": "line",
  "x": 140,
  "y": 160,
  "width": 0,
  "height": 420,
  "strokeColor": "#1e1e1e",
  "backgroundColor": "transparent",
  "points": [[0, 0], [0, 420]]
}
```

A line may include a label using the same label format as a shape.

## Frames

A frame represents a meaningful boundary:

```json
{
  "id": "backend_boundary",
  "type": "frame",
  "x": 80,
  "y": 80,
  "width": 900,
  "height": 520,
  "strokeColor": "#1971c2",
  "backgroundColor": "transparent",
  "name": "Backend"
}
```

Set child elements' `frameId` to the frame ID. A `frameId` must refer to an existing frame in the resulting scene.

## Create example

```json
{
  "elements": [
    {
      "id": "request",
      "type": "ellipse",
      "x": 100,
      "y": 120,
      "width": 180,
      "height": 90,
      "strokeColor": "#e67700",
      "backgroundColor": "#fff3bf",
      "label": {
        "id": "request_label",
        "text": "Request",
        "fontSize": 20,
        "color": "#1e1e1e"
      }
    },
    {
      "id": "process",
      "type": "rectangle",
      "x": 460,
      "y": 115,
      "width": 220,
      "height": 100,
      "strokeColor": "#1971c2",
      "backgroundColor": "#e7f5ff",
      "label": {
        "id": "process_label",
        "text": "Process",
        "fontSize": 20,
        "color": "#1e1e1e"
      }
    },
    {
      "id": "request_to_process",
      "type": "arrow",
      "x": 280,
      "y": 165,
      "width": 180,
      "height": 0,
      "strokeColor": "#1971c2",
      "backgroundColor": "transparent",
      "points": [[0, 0], [180, 0]],
      "startBinding": { "elementId": "request" },
      "endBinding": { "elementId": "process" }
    }
  ]
}
```

## Apply operations

Apply accepts an array. Each semantic ID may be targeted only once per batch.

Create an element:

```json
{
  "type": "create",
  "element": {
    "id": "result",
    "type": "ellipse",
    "x": 860,
    "y": 120,
    "width": 180,
    "height": 90,
    "strokeColor": "#2b8a3e",
    "backgroundColor": "#d3f9d8"
  }
}
```

Update an element by declaring its current type:

```json
{
  "type": "update",
  "id": "process",
  "elementType": "rectangle",
  "changes": {
    "x": 500,
    "width": 240
  }
}
```

Delete an element:

```json
{
  "type": "delete",
  "id": "obsolete_step"
}
```

Updates may change common fields plus fields supported by that element type. Replacing a label requires the complete label object; set `label` to `null` to remove it.

## Limits

- at most 10,000 expanded elements per scene;
- at most 500 operations per apply;
- text at most 20,000 Unicode code points;
- scene at most 20 MiB;
- coordinates and dimensions are bounded by the server.
