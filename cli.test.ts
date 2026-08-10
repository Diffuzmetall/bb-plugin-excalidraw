import { describe, expect, it, vi } from "vitest";

import { registerExcalidrawCli } from "./cli.js";

type Run = (
	argv: string[],
	ctx: { threadId?: string },
) => Promise<{ exitCode: number; stdout?: string; stderr?: string }>;

function setup() {
	let run: Run | undefined;
	const handlers = {
		readSemanticScene: vi
			.fn()
			.mockResolvedValue({ status: "ready", summary: {} }),
		createSemanticScene: vi
			.fn()
			.mockResolvedValue({ status: "conflict", currentSha256: "a".repeat(64) }),
		applySemanticScene: vi
			.fn()
			.mockResolvedValue({ status: "conflict", currentSha256: "b".repeat(64) }),
	};
	registerExcalidrawCli(
		{
			cli: {
				register: (definition: { run: Run }) => {
					run = definition.run;
				},
			},
		} as never,
		handlers as never,
	);
	if (!run) throw new Error("CLI was not registered");
	return { run, handlers };
}

const sha = "a".repeat(64);
const create = [
	"create",
	"new.excalidraw",
	"--scene",
	'{"elements":[]}',
	"--json",
];
const apply = [
	"apply",
	"scene.excalidraw",
	"--expected-sha256",
	sha,
	"--operations",
	"[]",
	"--json",
];

describe("Excalidraw CLI", () => {
	it("routes all commands with context or explicit thread and serializes structured outcomes", async () => {
		const { run, handlers } = setup();
		await expect(
			run(["read", "scene.excalidraw", "--json"], { threadId: "context" }),
		).resolves.toMatchObject({
			exitCode: 0,
			stdout: expect.stringContaining('"ready"'),
		});
		await expect(
			run([...create, "--thread", "override"], {}),
		).resolves.toMatchObject({
			exitCode: 0,
			stdout: expect.stringContaining('"conflict"'),
		});
		await expect(run(apply, { threadId: "context" })).resolves.toMatchObject({
			exitCode: 0,
			stdout: expect.stringContaining('"conflict"'),
		});
		expect(handlers.readSemanticScene).toHaveBeenCalledWith(
			expect.objectContaining({ threadId: "context" }),
		);
		expect(handlers.createSemanticScene).toHaveBeenCalledWith(
			expect.objectContaining({
				threadId: "override",
				expectedSha256: null,
				writerNonce: expect.any(String),
			}),
		);
		expect(handlers.applySemanticScene).toHaveBeenCalledWith(
			expect.objectContaining({
				threadId: "context",
				writerNonce: expect.any(String),
			}),
		);
		expect(handlers.createSemanticScene.mock.calls[0]![0].writerNonce).not.toBe(
			handlers.applySemanticScene.mock.calls[0]![0].writerNonce,
		);
	});

	it("rejects every missing-thread command without invoking a handler", async () => {
		const { run, handlers } = setup();
		for (const argv of [["read", "scene.excalidraw"], create, apply]) {
			await expect(run(argv, {})).resolves.toMatchObject({
				exitCode: 1,
				stderr: expect.stringContaining("missing --thread"),
			});
		}
		expect(handlers.readSemanticScene).not.toHaveBeenCalled();
		expect(handlers.createSemanticScene).not.toHaveBeenCalled();
		expect(handlers.applySemanticScene).not.toHaveBeenCalled();
	});

	it("rejects forbidden authority/raw options, unsafe paths, and 501 operations at the CLI boundary", async () => {
		const { run, handlers } = setup();
		for (const forbidden of [
			"host",
			"root",
			"raw",
			"force",
			"data-url",
			"base64",
			"writer-nonce",
		]) {
			await expect(
				run(["read", "scene.excalidraw", `--${forbidden}`, "x"], {
					threadId: "thread",
				}),
			).resolves.toMatchObject({ exitCode: 1 });
		}
		for (const path of [
			"../scene.excalidraw",
			"/scene.excalidraw",
			"C:\\scene.excalidraw",
		]) {
			await expect(
				run(["read", path], { threadId: "thread" }),
			).resolves.toMatchObject({ exitCode: 1 });
		}
		await expect(
			run(
				[
					"apply",
					"scene.excalidraw",
					"--expected-sha256",
					sha,
					"--operations",
					JSON.stringify(
						Array.from({ length: 501 }, (_, index) => ({
							type: "delete",
							id: `x${index}`,
						})),
					),
				],
				{ threadId: "thread" },
			),
		).resolves.toMatchObject({ exitCode: 1 });
		expect(handlers.readSemanticScene).not.toHaveBeenCalled();
		expect(handlers.applySemanticScene).not.toHaveBeenCalled();
	});
});
