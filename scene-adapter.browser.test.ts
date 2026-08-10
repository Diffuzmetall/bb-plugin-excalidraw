import { loadFromBlob, serializeAsJSON } from "@excalidraw/excalidraw";
import { describe, expect, it } from "vitest";
import {
	applySemanticOperationBatch,
	createExcalidrawScene,
	parseExcalidrawScene,
} from "./scene-adapter";
import type { SemanticScene } from "./semantic-schema";

const GOLDEN_URL = new URL(
	"./fixtures/scene-adapter-golden.excalidraw",
	import.meta.url,
);

async function readGoldenFixture(): Promise<string> {
	const response = await fetch(GOLDEN_URL);
	if (!response.ok) {
		throw new Error(`failed to fetch golden fixture: ${response.status}`);
	}
	return response.text();
}

async function loadScene(source: string) {
	return loadFromBlob(
		new Blob([source], { type: "application/json" }),
		null,
		null,
	);
}

function elementById<T extends { id: string }>(
	elements: readonly T[],
	id: string,
): T {
	const element = elements.find((candidate) => candidate.id === id);
	if (element === undefined) throw new Error(`missing restored element: ${id}`);
	return element;
}

function jsonElementById(
	elements: ReturnType<typeof parseExcalidrawScene>["elements"],
	id: string,
) {
	const element = elements.find((candidate) => candidate.id === id);
	if (element === undefined) throw new Error(`missing JSON element: ${id}`);
	return element;
}

function adapterGeneratedSemanticScene(): SemanticScene {
	const common = {
		x: 10,
		y: 20,
		width: 160,
		height: 80,
		strokeColor: "#1e1e1e",
		backgroundColor: "transparent",
		groupIds: [],
		frameId: null,
	};
	return {
		elements: [
			{
				...common,
				id: "generated-rectangle",
				type: "rectangle",
				label: {
					id: "generated-rectangle-label",
					text: "Generated",
					fontSize: 18,
					color: "#1e1e1e",
				},
			},
			{ ...common, id: "generated-ellipse", type: "ellipse" },
			{ ...common, id: "generated-diamond", type: "diamond" },
			{
				...common,
				id: "generated-text",
				type: "text",
				text: "Pinned browser parser",
				fontSize: 20,
				color: "#0055ff",
			},
			{
				...common,
				id: "generated-arrow",
				type: "arrow",
				width: 220,
				height: 20,
				points: [
					[0, 0],
					[220, 20],
				],
				startBinding: { elementId: "generated-rectangle" },
				endBinding: { elementId: "generated-ellipse" },
				label: {
					id: "generated-arrow-label",
					text: "browser",
					fontSize: 14,
					color: "#1e1e1e",
				},
			},
			{
				...common,
				id: "generated-line",
				type: "line",
				width: 0,
				height: 100,
				points: [
					[0, 0],
					[0, 100],
				],
			},
			{
				...common,
				id: "generated-frame",
				type: "frame",
				name: "Generated frame",
			},
		],
	};
}

describe("scene adapter compatibility with pinned Excalidraw parser", () => {
	it("accepts adapter-generated output for all seven MVP primitives", async () => {
		const restored = await loadScene(
			createExcalidrawScene(adapterGeneratedSemanticScene()),
		);
		const liveElements = restored.elements.filter(
			(element) => !element.isDeleted,
		);
		const types = new Set(liveElements.map((element) => element.type));
		for (const type of [
			"rectangle",
			"ellipse",
			"diamond",
			"text",
			"arrow",
			"line",
			"frame",
		] as const) {
			expect(types.has(type)).toBe(true);
		}
		expect(elementById(liveElements, "generated-rectangle-label").type).toBe(
			"text",
		);
		const arrow = elementById(liveElements, "generated-arrow");
		if (arrow.type !== "arrow") {
			throw new Error("generated-arrow was not restored as an arrow");
		}
		expect(arrow.startBinding?.elementId).toBe("generated-rectangle");
		expect(arrow.endBinding?.elementId).toBe("generated-ellipse");
	});
	it("loads every primitive, bound labels, and reciprocal arrow bindings", async () => {
		const restored = await loadScene(await readGoldenFixture());
		const liveElements = restored.elements.filter(
			(element) => !element.isDeleted,
		);
		const types = new Set(liveElements.map((element) => element.type));
		for (const type of [
			"rectangle",
			"ellipse",
			"diamond",
			"text",
			"arrow",
			"line",
			"frame",
			"image",
		] as const) {
			expect(types.has(type)).toBe(true);
		}

		const start = elementById(liveElements, "rect-start");
		const end = elementById(liveElements, "ellipse-end");
		const arrow = elementById(liveElements, "arrow-main");
		if (arrow.type !== "arrow")
			throw new Error("arrow-main was not restored as an arrow");
		const shapeLabel = elementById(liveElements, "rect-start-label");
		const arrowLabel = elementById(liveElements, "arrow-main-label");

		expect(start.boundElements).toEqual(
			expect.arrayContaining([
				{ id: "rect-start-label", type: "text" },
				{ id: "arrow-main", type: "arrow" },
			]),
		);
		expect(end.boundElements).toEqual(
			expect.arrayContaining([{ id: "arrow-main", type: "arrow" }]),
		);
		expect(arrow.startBinding?.elementId).toBe("rect-start");
		expect(arrow.endBinding?.elementId).toBe("ellipse-end");
		expect("containerId" in shapeLabel && shapeLabel.containerId).toBe(
			"rect-start",
		);
		expect("containerId" in arrowLabel && arrowLabel.containerId).toBe(
			"arrow-main",
		);
	});

	it("preserves unknown element data, appState, and binary files through browser round trip", async () => {
		const restored = await loadScene(await readGoldenFixture());
		const rectangle = elementById(restored.elements, "rect-start");
		expect(rectangle.customData).toEqual({
			bbUnknown: { nested: true, value: "preserved" },
		});
		expect(restored.appState.viewBackgroundColor).toBe("#f8f9fa");
		expect(restored.files["image-file-1"]).toMatchObject({
			id: "image-file-1",
			mimeType: "image/png",
		});

		const serialized = serializeAsJSON(
			restored.elements,
			restored.appState,
			restored.files,
			"local",
		);
		const roundTripped = await loadScene(serialized);
		const roundTrippedRectangle = elementById(
			roundTripped.elements,
			"rect-start",
		);
		expect(roundTrippedRectangle.customData).toEqual(rectangle.customData);
		expect(roundTripped.appState.viewBackgroundColor).toBe("#f8f9fa");
		expect(roundTripped.files["image-file-1"]).toEqual(
			restored.files["image-file-1"],
		);
		expect(roundTripped.elements).toHaveLength(restored.elements.length);
	});

	it("round-trips non-empty update/create/delete while preserving unknown data and files", async () => {
		const golden = await readGoldenFixture();
		const sourceDocument = parseExcalidrawScene(golden);
		sourceDocument.appState.bbUnknownState = {
			nested: true,
			value: "survives adapter mutation",
		};
		const source = JSON.stringify(sourceDocument);
		const mutated = applySemanticOperationBatch(source, {
			operations: [
				{
					type: "update",
					id: "rect-start",
					elementType: "rectangle",
					changes: { x: 44 },
				},
				{
					type: "create",
					element: {
						id: "created-in-browser-proof",
						type: "rectangle",
						x: 500,
						y: 60,
						width: 100,
						height: 60,
						strokeColor: "#1e1e1e",
						backgroundColor: "#d0ebff",
						groupIds: [],
						frameId: null,
					},
				},
				{ type: "delete", id: "diamond-decision" },
			],
		});

		const mutatedDocument = parseExcalidrawScene(mutated);
		expect(mutatedDocument.appState.bbUnknownState).toEqual(
			sourceDocument.appState.bbUnknownState,
		);
		expect(mutatedDocument.files).toEqual(sourceDocument.files);
		expect(
			jsonElementById(mutatedDocument.elements, "rect-start").customData,
		).toEqual({ bbUnknown: { nested: true, value: "preserved" } });

		const restored = await loadScene(mutated);
		expect(elementById(restored.elements, "rect-start").x).toBe(44);
		expect(
			elementById(restored.elements, "created-in-browser-proof").type,
		).toBe("rectangle");
		expect(
			restored.elements.some((element) => element.id === "diamond-decision"),
		).toBe(false);
		expect(elementById(restored.elements, "rect-start").customData).toEqual({
			bbUnknown: { nested: true, value: "preserved" },
		});
		expect(restored.files["image-file-1"]).toEqual(
			sourceDocument.files["image-file-1"],
		);

		const roundTripped = await loadScene(
			serializeAsJSON(
				restored.elements,
				restored.appState,
				restored.files,
				"local",
			),
		);
		expect(elementById(roundTripped.elements, "rect-start").x).toBe(44);
		expect(
			elementById(roundTripped.elements, "created-in-browser-proof").type,
		).toBe("rectangle");
		expect(
			roundTripped.elements.some(
				(element) => element.id === "diamond-decision" && !element.isDeleted,
			),
		).toBe(false);
		expect(elementById(roundTripped.elements, "rect-start").customData).toEqual(
			{ bbUnknown: { nested: true, value: "preserved" } },
		);
		expect(roundTripped.files["image-file-1"]).toEqual(
			restored.files["image-file-1"],
		);
	});

	it("keeps adapter no-op bytes identical and browser-parseable", async () => {
		const golden = await readGoldenFixture();
		const noOp = applySemanticOperationBatch(golden, { operations: [] });
		expect(noOp).toBe(golden);
		const [before, after] = await Promise.all([
			loadScene(golden),
			loadScene(noOp),
		]);
		expect(after.elements).toEqual(before.elements);
		expect(after.appState.viewBackgroundColor).toBe(
			before.appState.viewBackgroundColor,
		);
		expect(after.files).toEqual(before.files);
	});
});
