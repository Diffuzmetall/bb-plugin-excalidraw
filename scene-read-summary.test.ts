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
});
