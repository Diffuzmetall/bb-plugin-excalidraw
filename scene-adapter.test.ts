// @vitest-environment node

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	applySemanticOperationBatch,
	createExcalidrawScene,
	parseExcalidrawScene,
} from "./scene-adapter";
import type {
	SemanticElement,
	SemanticOperationBatch,
	SemanticScene,
} from "./semantic-schema";

const base = {
	x: 10,
	y: 20,
	width: 160,
	height: 80,
	strokeColor: "#1e1e1e",
	backgroundColor: "transparent",
	groupIds: [] as string[],
	frameId: null,
};

function rectangle(
	id: string,
): Extract<SemanticElement, { type: "rectangle" }> {
	return {
		...base,
		id,
		type: "rectangle",
		label: {
			id: `${id}-label`,
			text: `Label ${id}`,
			fontSize: 18,
			color: "#1e1e1e",
		},
	};
}

function arrow(
	id: string,
	startElementId: string | null,
	endElementId: string | null,
): Extract<SemanticElement, { type: "arrow" }> {
	return {
		...base,
		id,
		type: "arrow",
		width: 220,
		height: 40,
		points: [
			[0, 0],
			[220, 40],
		],
		startBinding:
			startElementId === null ? null : { elementId: startElementId },
		endBinding: endElementId === null ? null : { elementId: endElementId },
	};
}

const everyPrimitiveScene: SemanticScene = {
	elements: [
		rectangle("rect-1"),
		{ ...rectangle("ellipse-1"), type: "ellipse", label: undefined },
		{ ...rectangle("diamond-1"), type: "diamond", label: undefined },
		{
			...base,
			id: "text-1",
			type: "text",
			text: "Standalone text",
			fontSize: 20,
			color: "#000000",
		},
		arrow("arrow-1", "rect-1", "ellipse-1"),
		{
			...base,
			id: "line-1",
			type: "line",
			width: 0,
			height: 80,
			points: [
				[0, 0],
				[0, 80],
			],
		},
		{ ...base, id: "frame-1", type: "frame", name: "Main frame" },
	],
};

type NativeElement = ReturnType<
	typeof parseExcalidrawScene
>["elements"][number];

function elementById(elements: NativeElement[], id: string): NativeElement {
	const element = elements.find((candidate) => candidate.id === id);
	if (element === undefined) throw new Error(`missing native element: ${id}`);
	return element;
}

function boundIds(element: NativeElement): string[] {
	const value = element.boundElements;
	if (!Array.isArray(value)) return [];
	return value.flatMap((entry) => {
		if (
			typeof entry === "object" &&
			entry !== null &&
			"id" in entry &&
			typeof entry.id === "string"
		) {
			return [entry.id];
		}
		return [];
	});
}

describe("deterministic Excalidraw scene adapter", () => {
	it("creates every MVP primitive deterministically with stable native fields", () => {
		const first = createExcalidrawScene(everyPrimitiveScene);
		const second = createExcalidrawScene(everyPrimitiveScene);
		expect(first).toBe(second);

		const scene = parseExcalidrawScene(first);
		expect(scene.type).toBe("excalidraw");
		expect(scene.version).toBe(2);
		expect(scene.elements).toHaveLength(8);
		expect(scene.appState).toEqual({
			gridSize: null,
			viewBackgroundColor: "#ffffff",
		});
		expect(scene.files).toEqual({});

		const indexes = scene.elements.map((element) => element.index);
		expect(new Set(indexes).size).toBe(indexes.length);
		for (const element of scene.elements) {
			expect(element.seed).toEqual(expect.any(Number));
			expect(element.version).toBe(1);
			expect(element.versionNonce).toEqual(expect.any(Number));
			expect(element.updated).toBe(1);
			expect(element.isDeleted).toBe(false);
		}
	});

	it("creates bound labels and reciprocal arrow bindings", () => {
		const scene = parseExcalidrawScene(
			createExcalidrawScene({
				elements: [
					rectangle("start"),
					{ ...rectangle("end"), label: undefined },
					{
						...arrow("connector", "start", "end"),
						label: {
							id: "connector-label",
							text: "flows to",
							fontSize: 14,
							color: "#1e1e1e",
						},
					},
				],
			}),
		);

		const start = elementById(scene.elements, "start");
		const end = elementById(scene.elements, "end");
		const connector = elementById(scene.elements, "connector");
		const shapeLabel = elementById(scene.elements, "start-label");
		const arrowLabel = elementById(scene.elements, "connector-label");

		expect(boundIds(start)).toEqual(["start-label", "connector"]);
		expect(boundIds(end)).toEqual(["connector"]);
		expect(boundIds(connector)).toEqual(["connector-label"]);
		expect(shapeLabel.containerId).toBe("start");
		expect(arrowLabel.containerId).toBe("connector");
		expect(connector.startBinding).toEqual({
			elementId: "start",
			fixedPoint: null,
			focus: 0,
			gap: 4,
		});
		expect(connector.endBinding).toEqual({
			elementId: "end",
			fixedPoint: null,
			focus: 0,
			gap: 4,
		});
	});

	it("serializes non-ASCII unknown keys in locale-independent code-unit order", () => {
		const source = createExcalidrawScene({
			elements: [{ ...rectangle("ordered"), label: undefined }],
		});
		const parsed = parseExcalidrawScene(source);
		parsed.localeKeys = { å: 3, z: 1, ä: 2 };
		const serialized = applySemanticOperationBatch(JSON.stringify(parsed), {
			operations: [
				{
					type: "update",
					id: "ordered",
					elementType: "rectangle",
					changes: { x: 11 },
				},
			],
		});
		const start = serialized.indexOf('"localeKeys"');
		const end = serialized.indexOf("\n  },", start) + "\n  }".length;
		expect(serialized.slice(start, end)).toBe(
			'"localeKeys": {\n    "z": 1,\n    "ä": 2,\n    "å": 3\n  }',
		);
	});

	it("returns the original bytes for an empty apply, including image data", () => {
		const source = ` {\n  "type": "excalidraw",\n  "version": 2,\n  "elements": [],\n  "appState": {"viewBackgroundColor":"#fff", "future": true},\n  "files": {"image-1":{"mimeType":"image/png","dataURL":"data:image/png;base64,AA==","future":"kept"}},\n  "futureTopLevel": {"kept": true}\n}\n`;
		expect(applySemanticOperationBatch(source, { operations: [] })).toBe(
			source,
		);
	});

	it("preserves unknown scene, appState, file, and element fields on update", () => {
		const source = JSON.stringify({
			type: "excalidraw",
			version: 2,
			source: "browser",
			futureTopLevel: { keep: true },
			elements: [
				{
					...elementById(
						parseExcalidrawScene(
							createExcalidrawScene({ elements: [rectangle("rect")] }),
						).elements,
						"rect",
					),
					futureElement: { keep: true },
					version: 7,
					updated: 50,
				},
			],
			appState: { futureAppState: { keep: true } },
			files: { image: { futureFile: { keep: true } } },
		});
		const batch: SemanticOperationBatch = {
			operations: [
				{
					type: "update",
					id: "rect",
					elementType: "rectangle",
					changes: { x: 99, strokeColor: "#ff0000" },
				},
			],
		};

		const result = parseExcalidrawScene(
			applySemanticOperationBatch(source, batch),
		);
		const updated = elementById(result.elements, "rect");
		expect(updated.x).toBe(99);
		expect(updated.strokeColor).toBe("#ff0000");
		expect(updated.version).toBe(8);
		expect(updated.updated).toBe(51);
		expect(updated.futureElement).toEqual({ keep: true });
		expect(result.futureTopLevel).toEqual({ keep: true });
		expect(result.appState).toEqual({ futureAppState: { keep: true } });
		expect(result.files).toEqual({ image: { futureFile: { keep: true } } });
	});

	it("bumps a container exactly once when adding a reciprocal bound label", () => {
		const source = createExcalidrawScene({
			elements: [{ ...rectangle("add-label"), label: undefined }],
		});
		const result = parseExcalidrawScene(
			applySemanticOperationBatch(source, {
				operations: [
					{
						type: "update",
						id: "add-label",
						elementType: "rectangle",
						changes: {
							label: {
								id: "new-label",
								text: "Added",
								fontSize: 18,
								color: "#1e1e1e",
							},
						},
					},
				],
			}),
		);
		const container = elementById(result.elements, "add-label");
		expect(boundIds(container)).toEqual(["new-label"]);
		expect(container.version).toBe(2);
		expect(container.updated).toBe(2);
		expect(elementById(result.elements, "new-label").containerId).toBe(
			"add-label",
		);
	});

	it("bumps a container exactly once when removing a reciprocal bound label", () => {
		const source = createExcalidrawScene({
			elements: [rectangle("remove-label")],
		});
		const result = parseExcalidrawScene(
			applySemanticOperationBatch(source, {
				operations: [
					{
						type: "update",
						id: "remove-label",
						elementType: "rectangle",
						changes: { label: null },
					},
				],
			}),
		);
		const container = elementById(result.elements, "remove-label");
		const label = elementById(result.elements, "remove-label-label");
		expect(boundIds(container)).toEqual([]);
		expect(container.version).toBe(2);
		expect(container.updated).toBe(2);
		expect(label.isDeleted).toBe(true);
		expect(label.version).toBe(2);
		expect(label.updated).toBe(2);
	});

	it("updates labels and bindings while cleaning reciprocal references", () => {
		const source = createExcalidrawScene({
			elements: [
				rectangle("a"),
				{ ...rectangle("b"), label: undefined },
				{ ...rectangle("c"), label: undefined },
				arrow("arrow", "a", "b"),
			],
		});
		const result = parseExcalidrawScene(
			applySemanticOperationBatch(source, {
				operations: [
					{
						type: "update",
						id: "a",
						elementType: "rectangle",
						changes: {
							label: {
								id: "a-label",
								text: "Changed",
								fontSize: 20,
								color: "#0055ff",
							},
						},
					},
					{
						type: "update",
						id: "arrow",
						elementType: "arrow",
						changes: { endBinding: { elementId: "c" } },
					},
				],
			}),
		);

		expect(elementById(result.elements, "a-label").text).toBe("Changed");
		expect(elementById(result.elements, "a-label").strokeColor).toBe("#0055ff");
		expect(boundIds(elementById(result.elements, "b"))).toEqual([]);
		expect(boundIds(elementById(result.elements, "c"))).toEqual(["arrow"]);
	});

	it("marks deletes and dependent label/binding changes without dropping records", () => {
		const source = createExcalidrawScene({
			elements: [
				rectangle("target"),
				{ ...rectangle("other"), label: undefined },
				arrow("arrow", "target", "other"),
			],
		});
		const result = parseExcalidrawScene(
			applySemanticOperationBatch(source, {
				operations: [{ type: "delete", id: "target" }],
			}),
		);

		expect(elementById(result.elements, "target").isDeleted).toBe(true);
		expect(elementById(result.elements, "target-label").isDeleted).toBe(true);
		expect(elementById(result.elements, "arrow").startBinding).toBe(null);
		expect(boundIds(elementById(result.elements, "other"))).toEqual(["arrow"]);
	});

	it("rejects collisions, type mismatches, missing targets, and malformed scenes", () => {
		const source = createExcalidrawScene({ elements: [rectangle("rect")] });
		expect(() =>
			applySemanticOperationBatch(source, {
				operations: [{ type: "create", element: rectangle("rect") }],
			}),
		).toThrow(/already exists/i);
		expect(() =>
			applySemanticOperationBatch(source, {
				operations: [
					{
						type: "update",
						id: "rect",
						elementType: "ellipse",
						changes: { x: 1 },
					},
				],
			}),
		).toThrow(/type/i);
		expect(() =>
			applySemanticOperationBatch(source, {
				operations: [{ type: "delete", id: "missing" }],
			}),
		).toThrow(/not found/i);
		expect(() => parseExcalidrawScene("[]")).toThrow(/scene/i);
		expect(() =>
			parseExcalidrawScene('{"elements":{},"appState":{},"files":{}}'),
		).toThrow(/elements/i);
	});

	it("has no runtime dependency on the browser Excalidraw package or globals", () => {
		const sourcePath = fileURLToPath(
			new URL("./scene-adapter.ts", import.meta.url),
		);
		const source = readFileSync(sourcePath, "utf8");
		expect(source).not.toContain("@excalidraw/excalidraw");
		expect(source).not.toMatch(/\b(window|document|navigator)\b/);
	});
});
