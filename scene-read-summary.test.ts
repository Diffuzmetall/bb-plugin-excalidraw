import { describe, expect, it } from "vitest";

import {
	MAX_SCENE_READ_OUTPUT_BYTES,
	summarizeSceneRead,
} from "./scene-read-summary";

describe("scene read summary", () => {
	it("enforces the exact serialized output cap while omitting image bodies", () => {
		const elements = Array.from({ length: 10_000 }, (_, index) => ({
			id: `rect-${index}`,
			type: "rectangle",
			x: index,
			y: 0,
			width: 1,
			height: 1,
			groupIds: [],
			frameId: null,
		}));
		const imageBody = "a".repeat(200_000);
		const summary = summarizeSceneRead(
			JSON.stringify({
				type: "excalidraw",
				elements,
				appState: {},
				files: {
					image: {
						mimeType: "image/png",
						dataURL: `data:image/png;base64,${imageBody}`,
					},
				},
			}),
			"a".repeat(64),
		);

		const serialized = JSON.stringify({ status: "ready", summary });
		expect(Buffer.byteLength(serialized, "utf8")).toBeLessThanOrEqual(
			MAX_SCENE_READ_OUTPUT_BYTES,
		);
		expect(serialized).not.toContain("data:image");
		expect(summary.truncated).toBe(true);
		expect(summary.omittedElementCount).toBeGreaterThan(0);
	});

	it("omits deleted elements and their text from model-facing summaries", () => {
		const summary = summarizeSceneRead(
			JSON.stringify({
				type: "excalidraw",
				elements: [
					{
						id: "deleted-shape",
						type: "rectangle",
						isDeleted: true,
						boundElements: [{ id: "deleted-label", type: "text" }],
					},
					{
						id: "deleted-label",
						type: "text",
						isDeleted: true,
						containerId: "deleted-shape",
						text: "private deleted text",
					},
					{
						id: "active-shape",
						type: "rectangle",
						boundElements: [{ id: "active-label", type: "text" }],
					},
					{
						id: "active-label",
						type: "text",
						containerId: "active-shape",
						text: "visible text",
					},
				],
				appState: {},
				files: {},
			}),
			"a".repeat(64),
		);

		const serialized = JSON.stringify(summary);
		expect(serialized).not.toContain("deleted-shape");
		expect(serialized).not.toContain("deleted-label");
		expect(serialized).not.toContain("private deleted text");
		expect(serialized).toContain("visible text");
		expect(summary.elementCount).toBe(2);
		expect(summary.elementTypeCounts).toMatchObject({ rectangle: 1, text: 1 });
	});
});
