import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SceneData } from "./scene-state";

const loadFromBlob = vi.fn();
const serializeAsJSON = vi.fn();

vi.mock("@excalidraw/excalidraw", () => ({
	loadFromBlob,
	serializeAsJSON,
}));

const { hasDurableChanges, isSaveShortcut, restoreScene, serializeScene } =
	await import("./scene-state");

const elements = [
	{
		id: "rect-1",
		type: "rectangle" as const,
		x: 10,
		y: 20,
		width: 100,
		height: 80,
		angle: 0,
		strokeColor: "#000000",
		backgroundColor: "transparent",
		fillStyle: "solid" as const,
		strokeWidth: 1,
		strokeStyle: "solid" as const,
		roughness: 1,
		roundness: null,
		seed: 1,
		version: 1,
		versionNonce: 1,
		isDeleted: false,
		boundElements: null,
		updated: 1,
		link: null,
		locked: false,
		opacity: 100,
		index: "a0",
		groupIds: [],
		frameId: null,
	},
] satisfies SceneData["elements"];
const files = {
	"file-1": {
		id: "file-1",
		mimeType: "image/png",
		dataURL: "data:image/png;base64,AA==",
		created: 1,
		lastRetrieved: 1,
	},
};
const appState = {
	viewBackgroundColor: "#ffffff",
	scrollX: 0,
	scrollY: 0,
	zoom: { value: 1 },
};
const scene = { elements, appState, files } satisfies SceneData;

beforeEach(() => {
	loadFromBlob.mockReset();
	serializeAsJSON.mockReset();
	serializeAsJSON.mockImplementation((nextElements, nextAppState, nextFiles) =>
		JSON.stringify({
			elements: nextElements,
			appState: nextAppState,
			files: nextFiles,
		}),
	);
});

describe("scene state", () => {
	it("restores valid scenes through loadFromBlob and preserves files", async () => {
		loadFromBlob.mockResolvedValue(scene);

		const result = await restoreScene(JSON.stringify({ type: "excalidraw" }));

		expect(result).toEqual({ status: "ready", scene });
		expect(loadFromBlob).toHaveBeenCalledOnce();
		expect(loadFromBlob.mock.calls[0]?.[0]).toBeInstanceOf(Blob);
	});

	it("returns a non-editable error for invalid and oversized scenes", async () => {
		loadFromBlob.mockRejectedValueOnce(new Error("invalid"));
		expect(await restoreScene("not-json")).toMatchObject({ status: "error" });

		expect(await restoreScene("x".repeat(20 * 1024 * 1024 + 1))).toMatchObject({
			status: "error",
		});
	});

	it("serializes elements, appState, and image files while ignoring viewport-only changes", () => {
		const first = serializeScene(scene);
		const viewportOnly = {
			...scene,
			appState: {
				...scene.appState,
				scrollX: 400,
				scrollY: -200,
				zoom: { value: 2 },
			},
		} satisfies SceneData;
		const second = serializeScene(viewportOnly);

		expect(first).toContain('"files":');
		expect(serializeAsJSON.mock.calls[0]?.[2]).toEqual(files);
		expect(second).toBe(first);
		expect(hasDurableChanges(first, viewportOnly)).toBe(false);
		expect(serializeAsJSON).toHaveBeenCalledWith(
			elements,
			expect.not.objectContaining({ scrollX: 400, scrollY: -200 }),
			files,
			"database",
		);
	});

	it("recognizes Mod+S and Ctrl+S but not plain S", () => {
		expect(
			isSaveShortcut({
				key: "s",
				metaKey: true,
				ctrlKey: false,
				altKey: false,
			}),
		).toBe(true);
		expect(
			isSaveShortcut({
				key: "S",
				metaKey: false,
				ctrlKey: true,
				altKey: false,
			}),
		).toBe(true);
		expect(
			isSaveShortcut({
				key: "s",
				metaKey: false,
				ctrlKey: false,
				altKey: false,
			}),
		).toBe(false);
	});
});
