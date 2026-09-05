import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";

import { decodeObsidianExcalidrawMarkdown } from "./obsidian-scene";
import { createSceneHandlers } from "./scene-service";

const workspaceSource = {
	kind: "workspace" as const,
	threadId: "thread-1",
	environmentId: "env-1",
	projectId: null,
};

const validScene = JSON.stringify({
	type: "excalidraw",
	elements: [],
	appState: {},
	files: {},
});
const writtenSha = "b".repeat(64);

describe("Excalidraw scene service", () => {
	it("reads and writes authoritative workspace files with root confinement", async () => {
		const host = createFakePluginHost({
			pluginId: "excalidraw",
			sdk: {
				threads: {
					get: () => ({ environmentId: "env-1" }),
				},
				environments: {
					get: () => ({ path: "/workspace", hostId: "host-1" }),
				},
				files: {
					read: () => ({
						content: validScene,
						contentEncoding: "utf8",
						sizeBytes: Buffer.byteLength(validScene),
						sha256: "read-sha",
					}),
					write: () => ({ outcome: "written", sha256: writtenSha }),
				},
			},
		});
		const handlers = createSceneHandlers(host.bb);

		await expect(
			handlers.readScene({
				path: "drawings/demo.excalidraw",
				source: workspaceSource,
			}),
		).resolves.toMatchObject({
			status: "ready",
			writable: true,
			sha256: "read-sha",
			sourceKey: "workspace:env-1",
		});
		await expect(
			handlers.saveScene({
				path: "drawings/demo.excalidraw",
				source: workspaceSource,
				content: validScene,
				expectedSha256: "read-sha",
				writerNonce: "human-writer",
			}),
		).resolves.toEqual({
			status: "written",
			sha256: writtenSha,
			sizeBytes: Buffer.byteLength(validScene),
		});

		expect(host.harness.sdk.callsTo("files.read")[0]?.[0]).toEqual({
			hostId: "host-1",
			path: "/workspace/drawings/demo.excalidraw",
			rootPath: "/workspace",
		});
		expect(host.harness.sdk.callsTo("files.write")).toHaveLength(1);
		expect(host.harness.sdk.callsTo("files.write")[0]?.[0]).toEqual({
			hostId: "host-1",
			path: "/workspace/drawings/demo.excalidraw",
			rootPath: "/workspace",
			content: validScene,
			contentEncoding: "utf8",
			expectedSha256: "read-sha",
		});
		expect(host.harness.inspection.realtimeSignals).toEqual([
			{
				channel: "excalidraw-scene-invalidated",
				payload: {
					sourceKey: "workspace:env-1",
					path: "drawings/demo.excalidraw",
					sha256: writtenSha,
					writerNonce: "human-writer",
				},
			},
		]);
	});

	it("derives different canonical source keys for the same path in two environments", async () => {
		const host = createFakePluginHost({
			pluginId: "excalidraw",
			sdk: {
				environments: {
					get: ({ environmentId }) => ({
						path: `/remote/${environmentId}`,
						hostId: `host-${environmentId}`,
					}),
				},
				files: {
					read: () => ({
						content: validScene,
						contentEncoding: "utf8",
						sizeBytes: Buffer.byteLength(validScene),
						sha256: "read-sha",
					}),
				},
			},
		});
		const handlers = createSceneHandlers(host.bb);
		const source = (environmentId: string) => ({
			kind: "workspace" as const,
			threadId: null,
			environmentId,
			projectId: null,
		});

		await expect(
			handlers.readScene({
				path: "drawings/shared.excalidraw",
				source: source("env-a"),
			}),
		).resolves.toMatchObject({ sourceKey: "workspace:env-a" });
		await expect(
			handlers.readScene({
				path: "drawings/shared.excalidraw",
				source: source("env-b"),
			}),
		).resolves.toMatchObject({ sourceKey: "workspace:env-b" });
	});

	it("does not publish a human invalidation when the write conflicts", async () => {
		const host = createFakePluginHost({
			pluginId: "excalidraw",
			sdk: {
				threads: { get: () => ({ environmentId: "env-1" }) },
				environments: {
					get: () => ({ path: "/workspace", hostId: "host-1" }),
				},
				files: {
					write: () => ({
						outcome: "conflict",
						currentSha256: "current-sha",
					}),
				},
			},
		});
		const handlers = createSceneHandlers(host.bb);

		await expect(
			handlers.saveScene({
				path: "drawings/demo.excalidraw",
				source: workspaceSource,
				content: validScene,
				expectedSha256: "stale-sha",
				writerNonce: "human-writer",
			}),
		).resolves.toEqual({
			status: "conflict",
			currentSha256: "current-sha",
		});
		expect(host.harness.sdk.callsTo("files.write")).toHaveLength(1);
		expect(host.harness.inspection.realtimeSignals).toHaveLength(0);
	});

	it("returns a bounded semantic read summary without image bodies", async () => {
		const imageBody = "a".repeat(8_192);
		const scene = JSON.stringify({
			type: "excalidraw",
			elements: [
				{
					id: "rect-1",
					type: "rectangle",
					x: 10,
					y: 20,
					width: 100,
					height: 50,
					groupIds: [],
					frameId: null,
					boundElements: [{ type: "text", id: "label-1" }],
				},
				{
					id: "label-1",
					type: "text",
					x: 20,
					y: 30,
					width: 40,
					height: 20,
					groupIds: [],
					frameId: null,
					containerId: "rect-1",
					text: "Deploy",
				},
				{
					id: "arrow-1",
					type: "arrow",
					x: 0,
					y: 0,
					width: 100,
					height: 50,
					groupIds: [],
					frameId: null,
					startBinding: { elementId: "rect-1" },
					endBinding: null,
				},
			],
			appState: {},
			files: {
				"image-1": {
					mimeType: "image/png",
					dataURL: `data:image/png;base64,${imageBody}`,
					width: 2,
					height: 1,
				},
			},
		});
		const host = createFakePluginHost({
			pluginId: "excalidraw",
			sdk: {
				threads: { get: () => ({ environmentId: "env-1" }) },
				environments: { get: () => ({ path: "/workspace", hostId: "host-1" }) },
				files: {
					read: () => ({
						content: scene,
						contentEncoding: "utf8",
						sizeBytes: Buffer.byteLength(scene),
						sha256: "a".repeat(64),
					}),
				},
			},
		});
		const handlers = createSceneHandlers(host.bb);

		const result = await handlers.readSemanticScene({
			path: "drawings/demo.excalidraw",
			threadId: "thread-1",
			signal: new AbortController().signal,
		});

		expect(result).toMatchObject({
			status: "ready",
			summary: {
				revision: "a".repeat(64),
				bounds: { x: 0, y: 0, width: 110, height: 70 },
				elementCount: 3,
				elementTypeCounts: { rectangle: 1, text: 1, arrow: 1 },
			},
		});
		if (result.status !== "ready") throw new Error("expected ready summary");
		expect(result.summary.elements).toContainEqual({
			id: "rect-1",
			type: "rectangle",
			groupIds: [],
			frameId: null,
			label: { id: "label-1", text: "Deploy" },
		});
		expect(result.summary.connections).toEqual([
			{ id: "arrow-1", startElementId: "rect-1", endElementId: null },
		]);
		expect(result.summary.images).toEqual([
			{
				id: "image-1",
				mimeType: "image/png",
				width: 2,
				height: 1,
				byteEstimate: 6144,
			},
		]);
		expect(JSON.stringify(result)).not.toContain("data:image");
		expect(host.harness.sdk.callsTo("files.read")[0]?.[0]).toEqual({
			hostId: "host-1",
			path: "/workspace/drawings/demo.excalidraw",
			rootPath: "/workspace",
		});
	});

	it("propagates cancellation before resolving any workspace authority", async () => {
		const host = createFakePluginHost({ pluginId: "excalidraw" });
		const controller = new AbortController();
		controller.abort();

		await expect(
			createSceneHandlers(host.bb).readSemanticScene({
				path: "drawings/demo.excalidraw",
				threadId: "thread-1",
				signal: controller.signal,
			}),
		).rejects.toThrow();
		expect(host.harness.sdk.calls).toHaveLength(0);
	});

	it("propagates cancellation that occurs during the confined file read", async () => {
		const controller = new AbortController();
		const host = createFakePluginHost({
			pluginId: "excalidraw",
			sdk: {
				threads: { get: () => ({ environmentId: "env-1" }) },
				environments: { get: () => ({ path: "/workspace", hostId: "host-1" }) },
				files: {
					read: () => {
						controller.abort();
						return {
							content: validScene,
							contentEncoding: "utf8",
							sizeBytes: Buffer.byteLength(validScene),
							sha256: "read-sha",
						};
					},
				},
			},
		});

		await expect(
			createSceneHandlers(host.bb).readSemanticScene({
				path: "drawings/demo.excalidraw",
				threadId: "thread-1",
				signal: controller.signal,
			}),
		).rejects.toThrow();
		expect(host.harness.sdk.callsTo("files.read")).toHaveLength(1);
	});

	it("creates and applies semantic scenes through per-call thread authority", async () => {
		const host = createFakePluginHost({
			pluginId: "excalidraw",
			sdk: {
				threads: {
					get: ({ threadId }) => ({ environmentId: `env-${threadId}` }),
				},
				environments: {
					get: ({ environmentId }) => ({
						path: `/remote/${environmentId}`,
						hostId: `host-${environmentId}`,
					}),
				},
				files: {
					read: () => ({
						content: validScene,
						contentEncoding: "utf8",
						sizeBytes: Buffer.byteLength(validScene),
						sha256: "a".repeat(64),
					}),
					write: () => ({ outcome: "written", sha256: "b".repeat(64) }),
				},
			},
		});
		const handlers = createSceneHandlers(host.bb);
		const scene = { elements: [] };

		await expect(
			handlers.createSemanticScene({
				path: "drawings/new.excalidraw",
				threadId: "call-1",
				signal: new AbortController().signal,
				writerNonce: "writer-create",
				expectedSha256: null,
				scene,
			}),
		).resolves.toMatchObject({ status: "written", sha256: "b".repeat(64) });
		expect(host.harness.sdk.callsTo("files.write")[0]?.[0]).toMatchObject({
			hostId: "host-env-call-1",
			path: "/remote/env-call-1/drawings/new.excalidraw",
			rootPath: "/remote/env-call-1",
			expectedSha256: null,
		});

		await expect(
			handlers.applySemanticScene({
				path: "drawings/new.excalidraw",
				threadId: "call-2",
				signal: new AbortController().signal,
				writerNonce: "writer-apply",
				expectedSha256: "a".repeat(64),
				operations: [],
			}),
		).resolves.toMatchObject({ status: "written", sha256: "b".repeat(64) });
		expect(host.harness.sdk.callsTo("files.write")[1]?.[0]).toMatchObject({
			hostId: "host-env-call-2",
			path: "/remote/env-call-2/drawings/new.excalidraw",
			rootPath: "/remote/env-call-2",
			expectedSha256: "a".repeat(64),
		});
		expect(host.harness.inspection.realtimeSignals).toEqual([
			{
				channel: "excalidraw-scene-invalidated",
				payload: {
					sourceKey: "workspace:env-call-1",
					path: "drawings/new.excalidraw",
					sha256: "b".repeat(64),
					writerNonce: "writer-create",
				},
			},
			{
				channel: "excalidraw-scene-invalidated",
				payload: {
					sourceKey: "workspace:env-call-2",
					path: "drawings/new.excalidraw",
					sha256: "b".repeat(64),
					writerNonce: "writer-apply",
				},
			},
		]);
	});

	it("rejects traversal and malformed scenes before any file call", async () => {
		const host = createFakePluginHost({ pluginId: "excalidraw" });
		const handlers = createSceneHandlers(host.bb);

		await expect(
			handlers.saveScene({
				path: "../escape.excalidraw",
				source: workspaceSource,
				content: validScene,
				expectedSha256: null,
				writerNonce: "writer-test",
			}),
		).resolves.toMatchObject({ status: "error", code: "invalid_path" });
		await expect(
			handlers.saveScene({
				path: "safe.excalidraw",
				source: workspaceSource,
				content: "not-json",
				expectedSha256: null,
				writerNonce: "writer-test",
			}),
		).resolves.toMatchObject({ status: "error", code: "invalid_scene" });
		expect(host.harness.sdk.calls).toHaveLength(0);
	});

	it("rejects missing host authority before any file call", async () => {
		const host = createFakePluginHost({
			pluginId: "excalidraw",
			sdk: {
				threads: { get: () => ({ environmentId: "env-1" }) },
				environments: { get: () => ({ path: "/workspace", hostId: null }) },
			},
		});
		const handlers = createSceneHandlers(host.bb);

		await expect(
			handlers.readScene({ path: "demo.excalidraw", source: workspaceSource }),
		).resolves.toMatchObject({ status: "error", code: "authority_unproven" });
		await expect(
			handlers.saveScene({
				path: "demo.excalidraw",
				source: workspaceSource,
				content: validScene,
				expectedSha256: null,
				writerNonce: "writer-test",
			}),
		).resolves.toMatchObject({ status: "error", code: "authority_unproven" });
		expect(host.harness.sdk.callsTo("files.read")).toHaveLength(0);
		expect(host.harness.sdk.callsTo("files.write")).toHaveLength(0);
	});

	it("rejects ambiguous thread and source environments before any file call", async () => {
		const host = createFakePluginHost({
			pluginId: "excalidraw",
			sdk: { threads: { get: () => ({ environmentId: "env-2" }) } },
		});
		const handlers = createSceneHandlers(host.bb);

		await expect(
			handlers.readScene({ path: "demo.excalidraw", source: workspaceSource }),
		).resolves.toMatchObject({ status: "error", code: "authority_unproven" });
		expect(host.harness.sdk.callsTo("files.read")).toHaveLength(0);
		expect(host.harness.sdk.callsTo("files.write")).toHaveLength(0);
	});

	it("lists native and Obsidian drawings across registered project workspaces", async () => {
		const host = createFakePluginHost({
			pluginId: "excalidraw",
			sdk: {
				projects: {
					list: (args) =>
						args?.includePersonal
							? [
									{
										id: "project-brain",
										kind: "personal",
										name: "brain",
										gitRemoteUrl: null,
										createdAt: 1,
										updatedAt: 1,
										sources: [
											{
												id: "source-brain",
												projectId: "project-brain",
												isDefault: true,
												createdAt: 1,
												updatedAt: 1,
												type: "local_path",
												hostId: "host-1",
												path: "/home/ubuntu/brain",
											},
										],
									},
								]
							: [],
					paths: () => ({
						paths: [
							{
								kind: "file",
								path: "concept.excalidraw",
								name: "concept.excalidraw",
								score: 0,
								positions: [],
							},
							{
								kind: "file",
								path: "vault.excalidraw.md",
								name: "vault.excalidraw.md",
								score: 0,
								positions: [],
							},
							{
								kind: "file",
								path: "README.md",
								name: "README.md",
								score: 0,
								positions: [],
							},
						],
						truncated: false,
					}),
				},
			},
		});
		const handlers = createSceneHandlers(host.bb);

		await expect(handlers.listProjectScenes()).resolves.toEqual({
			status: "ready",
			entries: [
				{
					projectId: "project-brain",
					projectName: "brain",
					path: "concept.excalidraw",
					format: "native",
				},
				{
					projectId: "project-brain",
					projectName: "brain",
					path: "vault.excalidraw.md",
					format: "obsidian-markdown",
				},
			],
			truncatedProjects: [],
			unavailableProjects: [],
		});
	});

	it("keeps explicit project authority when an unrelated thread is also present", async () => {
		const projectSource = {
			kind: "workspace" as const,
			threadId: "thread-1",
			environmentId: null,
			projectId: "project-1",
		};
		const obsidianMarkdown = `---\nexcalidraw-plugin: parsed\n---\n# Text Elements\nKeep this text\n# Drawing\n\`\`\`json\n${validScene}\n\`\`\``;
		const editedScene = JSON.stringify({
			...JSON.parse(validScene),
			source: "saved-from-bb",
		});
		const rawMarkdownSha = createHash("sha256")
			.update(obsidianMarkdown, "utf8")
			.digest("hex");
		const host = createFakePluginHost({
			pluginId: "excalidraw",
			sdk: {
				threads: { get: () => ({ environmentId: "env-unrelated" }) },
				environments: {
					get: () => ({ path: "/unrelated", hostId: "host-unrelated" }),
				},
				files: {
					read: () => ({
						content: obsidianMarkdown,
						contentEncoding: "utf8",
						sizeBytes: Buffer.byteLength(obsidianMarkdown),
					}),
					write: () => ({ outcome: "written", sha256: writtenSha }),
				},
				projects: {
					paths: () => ({
						paths: [
							{
								kind: "file",
								path: "Excalidraw/demo.excalidraw.md",
								name: "demo.excalidraw.md",
								score: 0,
								positions: [],
							},
						],
						truncated: false,
					}),
					get: () => ({
						id: "project-1",
						kind: "standard",
						name: "Obsidian Vault",
						gitRemoteUrl: null,
						createdAt: 1,
						updatedAt: 1,
						sources: [
							{
								id: "source-1",
								projectId: "project-1",
								isDefault: true,
								createdAt: 1,
								updatedAt: 1,
								type: "local_path",
								hostId: "host-1",
								path: "/vault",
							},
						],
					}),
				},
			},
		});
		const handlers = createSceneHandlers(host.bb);

		const result = await handlers.readScene({
			path: "demo.excalidraw.md",
			source: projectSource,
		});

		expect(result).toMatchObject({
			status: "ready",
			writable: true,
			sha256: rawMarkdownSha,
			sourceKey: "project:project-1:source-1",
		});
		if (result.status !== "ready") throw new Error("expected ready scene");
		await expect(
			handlers.saveScene({
				path: "demo.excalidraw.md",
				source: projectSource,
				content: editedScene,
				expectedSha256: result.sha256,
				writerNonce: "writer-test",
			}),
		).resolves.toEqual({
			status: "written",
			sha256: writtenSha,
			sizeBytes: Buffer.byteLength(editedScene),
		});

		expect(host.harness.sdk.callsTo("threads.get")).toHaveLength(0);
		expect(host.harness.sdk.callsTo("environments.get")).toHaveLength(0);
		expect(host.harness.sdk.callsTo("files.read")[0]?.[0]).toEqual({
			hostId: "host-1",
			path: "/vault/Excalidraw/demo.excalidraw.md",
			rootPath: "/vault",
		});
		const write = host.harness.sdk.callsTo("files.write")[0]?.[0] as
			| {
					content?: string;
					expectedSha256?: string | null;
					hostId?: string;
					path?: string;
					rootPath?: string;
			  }
			| undefined;
		expect(write).toMatchObject({
			hostId: "host-1",
			path: "/vault/Excalidraw/demo.excalidraw.md",
			rootPath: "/vault",
			expectedSha256: rawMarkdownSha,
		});
		expect(write?.content).toContain("# Text Elements\nKeep this text");
		expect(JSON.parse(decodeObsidianExcalidrawMarkdown(write?.content ?? ""))).toMatchObject({
			source: "saved-from-bb",
		});
	});

	it("uses thread environment authority for ambient workspace and keeps host sources read-only", async () => {
		const ambientWorkspaceSource = {
			...workspaceSource,
			projectId: null,
		};
		const hostSource = {
			kind: "host" as const,
			threadId: "thread-1",
			environmentId: null,
			projectId: null,
		};
		const host = createFakePluginHost({
			pluginId: "excalidraw",
			sdk: {
				threads: { get: () => ({ environmentId: "env-1" }) },
				environments: { get: () => ({ path: "/workspace", hostId: "host-2" }) },
				files: {
					read: () => ({
						content: validScene,
						contentEncoding: "utf8",
						sizeBytes: Buffer.byteLength(validScene),
						sha256: "host-read-sha",
					}),
				},
			},
		});
		const handlers = createSceneHandlers(host.bb);

		await expect(
			handlers.readScene({
				path: "demo.excalidraw",
				source: ambientWorkspaceSource,
			}),
		).resolves.toMatchObject({
			status: "ready",
			writable: true,
			sourceKey: "workspace:env-1",
		});
		await expect(
			handlers.readScene({
				path: "/workspace/host/demo.excalidraw",
				source: hostSource,
			}),
		).resolves.toMatchObject({
			status: "ready",
			writable: false,
			sha256: "host-read-sha",
		});
		await expect(
			handlers.saveScene({
				path: "/tmp/demo.excalidraw",
				source: hostSource,
				content: validScene,
				expectedSha256: null,
				writerNonce: "writer-test",
			}),
		).resolves.toMatchObject({ status: "error", code: "authority_unproven" });
		expect(host.harness.sdk.callsTo("files.write")).toHaveLength(0);
	});
});
