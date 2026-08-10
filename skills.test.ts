import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
	semanticOperationSchema,
	semanticSceneSchema,
} from "./semantic-schema";

describe("Excalidraw skill manifest", () => {
	it("packages a trigger-oriented skill contribution", async () => {
		const root = resolve(import.meta.dirname);
		const manifest = JSON.parse(
			await readFile(resolve(root, "package.json"), "utf8"),
		) as { files: string[]; bb: { skills: string[] } };
		const skill = await readFile(
			resolve(root, "skills/excalidraw/SKILL.md"),
			"utf8",
		);
		expect(manifest.files).toContain("skills");
		expect(manifest.bb.skills).toContain("skills");
		expect(skill).toMatch(/^---\nname: excalidraw\ndescription: .+\n---/u);
		expect(skill).toContain("references/design-guide.md");
		expect(skill).toContain("references/semantic-format.md");
		expect(skill).toContain("Never edit native `.excalidraw` JSON directly");
	});

	it("keeps documented semantic examples valid", async () => {
		const root = resolve(import.meta.dirname);
		const reference = await readFile(
			resolve(root, "skills/excalidraw/references/semantic-format.md"),
			"utf8",
		);
		const createExample = reference.match(
			/## Create example\s+```json\n([\s\S]*?)\n```/u,
		)?.[1];
		expect(createExample).toBeDefined();
		expect(() =>
			semanticSceneSchema.parse(JSON.parse(createExample!)),
		).not.toThrow();

		for (const heading of [
			"Create an element",
			"Update an element by declaring its current type",
			"Delete an element",
		]) {
			const escaped = heading.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
			const example = reference.match(
				new RegExp(
					`${escaped}:?\\s+` + "```json\\n([\\s\\S]*?)\\n```",
					"u",
				),
			)?.[1];
			expect(example, heading).toBeDefined();
			expect(() =>
				semanticOperationSchema.parse(JSON.parse(example!)),
			).not.toThrow();
		}
	});
});
