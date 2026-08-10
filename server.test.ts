import { readFileSync } from "node:fs";
import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import plugin from "./server";

describe("Excalidraw server", () => {
	it("loads in Node without importing Excalidraw", () => {
		expect(plugin).toBeTypeOf("function");
		expect(readFileSync("server.ts", "utf8")).not.toMatch(
			/@excalidraw\/excalidraw/,
		);
	});

	it("registers the live-workspace semantic read tool without authority parameters", async () => {
		const scene = JSON.stringify({
			type: "excalidraw",
			elements: [],
			appState: {},
			files: {},
		});
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
					listPaths: () => ({
						paths: [
							{
								kind: "file" as const,
								path: "AI+MAN.excalidraw",
								name: "AI+MAN.excalidraw",
								score: 0,
								positions: [],
							},
							{
								kind: "file" as const,
								path: "README.md",
								name: "README.md",
								score: 0,
								positions: [],
							},
						],
						truncated: false,
					}),
					read: () => ({
						content: scene,
						contentEncoding: "utf8",
						sizeBytes: Buffer.byteLength(scene),
						sha256: "b".repeat(64),
					}),
					write: () => ({ outcome: "written", sha256: "c".repeat(64) }),
				},
			},
		});
		await plugin(host.bb);
		await expect(
			host.harness.behavior.callRpc("listScenes", {
				threadId: "call-42",
			}),
		).resolves.toEqual({
			status: "ready",
			paths: ["AI+MAN.excalidraw"],
			truncated: false,
		});
		expect(host.harness.sdk.callsTo("files.listPaths")[0]?.[0]).toEqual({
			hostId: "host-env-call-42",
			path: "/remote/env-call-42",
			includeFiles: true,
			includeDirectories: false,
			limit: 10_000,
		});
		expect(host.harness.registrations.cli).toMatchObject({
			name: "excalidraw",
			commands: expect.arrayContaining([
				expect.objectContaining({ name: "read" }),
				expect.objectContaining({ name: "create" }),
				expect.objectContaining({ name: "apply" }),
			]),
		});

		const tool = host.harness.inspection.registrations.agentTools.find(
			({ name }) => name === "excalidraw_scene_read",
		);
		expect(tool?.inputSchema).toMatchObject({
			type: "object",
			properties: { path: { type: "string" } },
		});
		for (const registration of host.harness.inspection.registrations
			.agentTools) {
			expect(JSON.stringify(registration.inputSchema)).not.toMatch(
				/host|root|thread|force|raw|content|dataURL|base64/i,
			);
		}
		expect(
			host.harness.inspection.registrations.agentTools.map(({ name }) => name),
		).not.toContain("excalidraw_scene_force");
		await expect(
			host.harness.callAgentTool(
				"excalidraw_scene_read",
				{ path: "plans/remote.excalidraw" },
				{ threadId: "call-42" },
			),
		).resolves.toMatchObject({ content: [{ type: "text" }] });
		expect(host.harness.sdk.callsTo("files.read")[0]?.[0]).toEqual({
			hostId: "host-env-call-42",
			path: "/remote/env-call-42/plans/remote.excalidraw",
			rootPath: "/remote/env-call-42",
		});
		await expect(
			host.harness.callAgentTool(
				"excalidraw_scene_create",
				{
					path: "plans/new.excalidraw",
					expectedSha256: null,
					scene: { elements: [] },
				},
				{ threadId: "call-43" },
			),
		).resolves.toMatchObject({ content: [{ type: "text" }] });
		expect(host.harness.sdk.callsTo("files.write")[0]?.[0]).toMatchObject({
			hostId: "host-env-call-43",
			expectedSha256: null,
		});
		await expect(
			host.harness.callAgentTool(
				"excalidraw_scene_apply",
				{
					path: "plans/new.excalidraw",
					expectedSha256: "b".repeat(64),
					operations: [],
				},
				{ threadId: "call-44" },
			),
		).resolves.toMatchObject({ content: [{ type: "text" }] });
		expect(host.harness.sdk.callsTo("files.write")[1]?.[0]).toMatchObject({
			hostId: "host-env-call-44",
			expectedSha256: "b".repeat(64),
		});
		await expect(
			host.harness.callAgentTool(
				"excalidraw_scene_apply",
				{
					path: "plans/new.excalidraw",
					expectedSha256: "a".repeat(64),
					operations: [],
				},
				{ threadId: "call-44" },
			),
		).resolves.toMatchObject({ isError: true });
		expect(host.harness.sdk.callsTo("files.write")).toHaveLength(2);
		expect(host.harness.inspection.realtimeSignals).toHaveLength(2);
		const aborted = new AbortController();
		aborted.abort();
		await expect(
			host.harness.callAgentTool(
				"excalidraw_scene_create",
				{
					path: "plans/nope.excalidraw",
					expectedSha256: null,
					scene: { elements: [] },
				},
				{ threadId: "call-45", signal: aborted.signal },
			),
		).rejects.toThrow();
		expect(host.harness.sdk.callsTo("files.write")).toHaveLength(2);
		expect(host.harness.inspection.realtimeSignals).toHaveLength(2);
		await expect(
			host.harness.callAgentTool("excalidraw_scene_apply", {
				path: "../escape.excalidraw",
				expectedSha256: "b".repeat(64),
				operations: Array.from({ length: 501 }, () => ({
					type: "delete",
					id: "x",
				})),
			}),
		).rejects.toThrow();
		expect(host.harness.sdk.callsTo("files.write")).toHaveLength(2);
		expect(host.harness.inspection.realtimeSignals).toHaveLength(2);
	});

	it("returns a structured create collision without retrying or publishing", async () => {
		const scene = JSON.stringify({
			type: "excalidraw",
			elements: [],
			appState: {},
			files: {},
		});
		const host = createFakePluginHost({
			pluginId: "excalidraw",
			sdk: {
				threads: { get: () => ({ environmentId: "env-collision" }) },
				environments: {
					get: () => ({ path: "/remote/collision", hostId: "host-collision" }),
				},
				files: {
					read: () => ({
						content: scene,
						contentEncoding: "utf8",
						sizeBytes: Buffer.byteLength(scene),
						sha256: "a".repeat(64),
					}),
					write: () => ({ outcome: "conflict", currentSha256: "d".repeat(64) }),
				},
			},
		});
		await plugin(host.bb);

		const result = await host.harness.callAgentTool(
			"excalidraw_scene_create",
			{
				path: "plans/new.excalidraw",
				expectedSha256: null,
				scene: { elements: [] },
			},
			{ threadId: "thread-collision" },
		);
		expect(result).toMatchObject({
			isError: true,
			content: [
				{ type: "text", text: expect.stringContaining("currentSha256") },
			],
		});
		expect(host.harness.sdk.callsTo("files.write")).toHaveLength(1);
		expect(host.harness.sdk.callsTo("files.write")[0]?.[0]).toMatchObject({
			expectedSha256: null,
		});
		expect(host.harness.inspection.realtimeSignals).toEqual([]);
	});

	it("selects the tool only for a live workspace environment", async () => {
		const host = createFakePluginHost({ pluginId: "excalidraw" });
		await plugin(host.bb);
		const context = {
			thread: {
				id: "thread-1",
				title: null,
				parentThreadId: null,
				sourceThreadId: null,
			},
			project: {
				id: "project-1",
				kind: "standard" as const,
				name: "Test",
				gitRemoteUrl: null,
			},
			environment: {
				id: "environment-1",
				name: null,
				path: "/workspace",
				workspaceProvisionType: "unmanaged" as const,
				branchName: null,
			},
			host: { id: "host-1", name: "Host" },
			provider: { id: "codex", model: "test" },
			origin: { kind: null, pluginId: null },
		};

		const liveConfiguration =
			await host.harness.resolveAgentConfiguration(context);
		expect(liveConfiguration.tools.map((tool) => tool.name)).toEqual([
			"excalidraw_scene_read",
			"excalidraw_scene_create",
			"excalidraw_scene_apply",
		]);
		await expect(
			host.harness.resolveAgentConfiguration({
				...context,
				environment: { ...context.environment, path: null },
			}),
		).resolves.toMatchObject({ tools: [] });
	});

	it("registers scene RPC methods with schema validation", async () => {
		const host = createFakePluginHost({ pluginId: "excalidraw" });
		await plugin(host.bb);

		expect(host.harness.inspection.registrations.rpcMethods).toEqual([
			"readScene",
			"saveScene",
			"listScenes",
			"ping",
		]);
		await expect(host.harness.behavior.callRpc("ping", null)).resolves.toEqual({
			ok: true,
		});
	});
});
