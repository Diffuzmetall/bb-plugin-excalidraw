import { randomUUID } from "node:crypto";
import { defineRpcContract, type BbPluginApi } from "@bb/plugin-sdk";
import { z } from "zod";

import { registerExcalidrawCli } from "./cli.js";
import {
	createSceneHandlers,
	saveSceneRequestSchema,
	sceneAgentApplyRequestSchema,
	sceneAgentCreateRequestSchema,
	sceneAgentReadRequestSchema,
	sceneReadResultSchema,
	sceneListRequestSchema,
	sceneListResultSchema,
	sceneRequestSchema,
	sceneWriteResultSchema,
} from "./scene-service.js";

export const excalidrawRpcContract = defineRpcContract({
	readScene: {
		input: sceneRequestSchema,
		output: sceneReadResultSchema,
	},
	saveScene: {
		input: saveSceneRequestSchema,
		output: sceneWriteResultSchema,
	},
	listScenes: {
		input: sceneListRequestSchema,
		output: sceneListResultSchema,
	},
	ping: {
		input: z.null(),
		output: z.object({ ok: z.literal(true) }).strict(),
	},
});

export type ExcalidrawRpcContract = typeof excalidrawRpcContract;

export default async function plugin(bb: BbPluginApi) {
	const handlers = createSceneHandlers(bb);
	const {
		readScene,
		listScenes,
		readSemanticScene,
		createSemanticScene,
		applySemanticScene,
		saveScene,
	} = handlers;
	registerExcalidrawCli(bb, handlers);
	bb.rpc.register(excalidrawRpcContract, {
		readScene,
		saveScene,
		listScenes,
		ping() {
			return { ok: true as const };
		},
	});
	bb.agents.registerTool({
		name: "excalidraw_scene_read",
		description:
			"Read a bounded semantic summary of an Excalidraw workspace scene.",
		parameters: sceneAgentReadRequestSchema,
		async execute(input, ctx) {
			const result = await readSemanticScene({
				...input,
				threadId: ctx.threadId,
				signal: ctx.signal,
			});
			return {
				content: [{ type: "text", text: JSON.stringify(result) }],
				...(result.status === "error" ? { isError: true } : {}),
			};
		},
	});
	bb.agents.registerTool({
		name: "excalidraw_scene_create",
		description:
			"Create a new Excalidraw workspace scene with create-only safety.",
		parameters: sceneAgentCreateRequestSchema,
		async execute(input, ctx) {
			const result = await createSemanticScene({
				...input,
				threadId: ctx.threadId,
				signal: ctx.signal,
				writerNonce: randomUUID(),
			});
			return {
				content: [{ type: "text", text: JSON.stringify(result) }],
				...(result.status === "error" || result.status === "conflict"
					? { isError: true }
					: {}),
			};
		},
	});
	bb.agents.registerTool({
		name: "excalidraw_scene_apply",
		description:
			"Apply a CAS-guarded semantic operation batch to an Excalidraw workspace scene.",
		parameters: sceneAgentApplyRequestSchema,
		async execute(input, ctx) {
			const result = await applySemanticScene({
				...input,
				threadId: ctx.threadId,
				signal: ctx.signal,
				writerNonce: randomUUID(),
			});
			return {
				content: [{ type: "text", text: JSON.stringify(result) }],
				...(result.status === "error" || result.status === "conflict"
					? { isError: true }
					: {}),
			};
		},
	});
	bb.agents.configure((context) => {
		if (context.environment.path === null) {
			return { tools: [], skills: [] };
		}
		return {
			tools: [
				"excalidraw_scene_read",
				"excalidraw_scene_create",
				"excalidraw_scene_apply",
			],
			skills: ["excalidraw"],
			instructions:
				"For .excalidraw work, use the Excalidraw semantic tools or bb excalidraw CLI. Read before applying changes, use the returned revision, and never edit native scene JSON directly.",
		};
	});
	bb.log.info("Excalidraw scene RPC and semantic read tool loaded");
}
