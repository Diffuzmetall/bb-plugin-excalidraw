import { describe, expect, it } from "vitest";

import {
	decodeObsidianExcalidrawMarkdown,
	encodeObsidianExcalidrawMarkdown,
} from "./obsidian-scene";

const scene = {
	type: "excalidraw",
	version: 2,
	source: "test",
	elements: [],
	appState: { gridSize: null, viewBackgroundColor: "#ffffff" },
	files: {},
};

const updatedScene = { ...scene, source: "updated" };
const compressed =
	"N4IgLgngDgpiBcIYA8DGBDANgSwCYCd0B3EAGhADcZ8BnbAewDsEAmcm+gV31TkTBg0wZJJhgBbGIzA0EAbQC65dFCgBlMOgEJQAc3x412AF59GnTJnIVsMIgCF0qANb6ujXAGF6mevgQgAMQAZqFhIAC+5MHYYrLwwBERQA";

describe("Obsidian Excalidraw codec", () => {
	it("extracts a compressed-json drawing block from an Obsidian note", () => {
		const markdown = [
			"---",
			"excalidraw-plugin: parsed",
			"tags: [excalidraw]",
			"---",
			"# Text Elements",
			"",
			"## Drawing",
			"```compressed-json",
			compressed,
			"```",
		].join("\n");

		expect(JSON.parse(decodeObsidianExcalidrawMarkdown(markdown))).toEqual(scene);
	});

	it("extracts and replaces a plain JSON drawing without changing the note envelope", () => {
		const markdown = [
			"---",
			"excalidraw-plugin: parsed",
			"---",
			"# Text Elements",
			"Keep this text",
			"# Drawing",
			"```json",
			JSON.stringify(scene),
			"```",
		].join("\n");
		const updated = encodeObsidianExcalidrawMarkdown(
			markdown,
			JSON.stringify(updatedScene),
		);

		expect(JSON.parse(decodeObsidianExcalidrawMarkdown(updated))).toEqual(
			updatedScene,
		);
		expect(updated).toContain("# Text Elements\nKeep this text");
		expect(updated).toContain("excalidraw-plugin: parsed");
	});

	it("recompresses a compressed drawing while preserving surrounding Markdown", () => {
		const markdown = `before\n## Drawing\n\`\`\`compressed-json\n${compressed}\n\`\`\`\nafter`;
		const updated = encodeObsidianExcalidrawMarkdown(
			markdown,
			JSON.stringify(updatedScene),
		);

		expect(JSON.parse(decodeObsidianExcalidrawMarkdown(updated))).toEqual(
			updatedScene,
		);
		expect(updated).toMatch(/^before/);
		expect(updated).toMatch(/after$/);
	});

	it("rejects notes without a drawing block", () => {
		expect(() => decodeObsidianExcalidrawMarkdown("# ordinary note")).toThrow(
			"Drawing block",
		);
	});
});
