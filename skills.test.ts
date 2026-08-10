import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

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
	});
});
