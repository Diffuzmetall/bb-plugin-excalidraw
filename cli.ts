import { randomUUID } from "node:crypto";
import type {
	BbPluginApi,
	PluginCliContext,
	PluginCliResult,
} from "@bb/plugin-sdk";
import { z } from "zod";

import {
	type createSceneHandlers,
	sceneAgentApplyRequestSchema,
	sceneAgentCreateRequestSchema,
	sceneAgentReadRequestSchema,
} from "./scene-service.js";

const HELP = `Usage:
  bb excalidraw read <path> [--thread <thread-id>] [--json]
  bb excalidraw create <path> --scene <semantic-scene-json> [--thread <thread-id>] [--json]
  bb excalidraw apply <path> --expected-sha256 <sha256> --operations <semantic-operations-json> [--thread <thread-id>] [--json]`;

type SceneHandlers = ReturnType<typeof createSceneHandlers>;

function parse(argv: string[]) {
	const positionals: string[] = [];
	const options = new Map<string, string>();
	for (let index = 0; index < argv.length; index += 1) {
		const value = argv[index]!;
		if (!value.startsWith("--")) {
			positionals.push(value);
			continue;
		}
		const name = value.slice(2);
		if (name === "json" || name === "help") {
			options.set(name, "true");
			continue;
		}
		const next = argv[++index];
		if (next === undefined || next.startsWith("--")) {
			throw new Error(`missing value for --${name}`);
		}
		options.set(name, next);
	}
	return { positionals, options };
}

function requireThread(
	options: Map<string, string>,
	ctx: PluginCliContext,
): string {
	const threadId = options.get("thread") ?? ctx.threadId;
	if (!threadId)
		throw new Error("missing --thread and no thread context is available");
	return threadId;
}

function validateScenePath(path: string): void {
	if (
		path.startsWith("/") ||
		path.startsWith("\\") ||
		/^[A-Za-z]:[\\/]/u.test(path) ||
		path.split(/[\\/]/u).includes("..")
	) {
		throw new Error("path must be a workspace-relative .excalidraw path");
	}
}

function jsonOption(options: Map<string, string>, name: string): unknown {
	const value = options.get(name);
	if (!value) throw new Error(`missing --${name}`);
	try {
		return JSON.parse(value);
	} catch {
		throw new Error(`--${name} must be JSON`);
	}
}

function result(result: unknown, json: boolean): PluginCliResult {
	return {
		exitCode: 0,
		stdout: json ? JSON.stringify(result) : JSON.stringify(result, null, 2),
	};
}

function failure(error: unknown): PluginCliResult {
	return {
		exitCode: 1,
		stderr:
			error instanceof z.ZodError
				? (error.issues[0]?.message ?? "invalid input")
				: error instanceof Error
					? error.message
					: String(error),
	};
}

export function registerExcalidrawCli(
	bb: BbPluginApi,
	handlers: SceneHandlers,
): void {
	bb.cli.register({
		name: "excalidraw",
		summary: "Read and safely mutate semantic Excalidraw workspace scenes",
		commands: [
			{
				name: "read",
				summary: "Read a bounded semantic scene summary",
				usage: HELP,
			},
			{
				name: "create",
				summary: "Create a semantic scene at a new path",
				usage: HELP,
			},
			{
				name: "apply",
				summary: "Apply CAS-guarded semantic operations",
				usage: HELP,
			},
		],
		async run(argv, ctx): Promise<PluginCliResult> {
			try {
				const [command, ...rest] = argv;
				if (!command || command === "help" || command === "--help")
					return { exitCode: 0, stdout: HELP };
				const { positionals, options } = parse(rest);
				if (options.has("help")) return { exitCode: 0, stdout: HELP };
				const allowed = new Set(
					command === "create"
						? ["scene", "thread", "json"]
						: command === "apply"
							? ["expected-sha256", "operations", "thread", "json"]
							: ["thread", "json"],
				);
				for (const name of options.keys()) {
					if (!allowed.has(name))
						throw new Error(`unsupported option --${name}`);
				}
				if (positionals.length !== 1) throw new Error(HELP);
				const path = positionals[0]!;
				validateScenePath(path);
				const threadId = requireThread(options, ctx);
				const json = options.has("json");
				const signal = new AbortController().signal;
				if (command === "read") {
					const input = sceneAgentReadRequestSchema.parse({ path });
					return result(
						await handlers.readSemanticScene({ ...input, threadId, signal }),
						json,
					);
				}
				if (command === "create") {
					const input = sceneAgentCreateRequestSchema.parse({
						path,
						expectedSha256: null,
						scene: jsonOption(options, "scene"),
					});
					return result(
						await handlers.createSemanticScene({
							...input,
							threadId,
							signal,
							writerNonce: randomUUID(),
						}),
						json,
					);
				}
				if (command === "apply") {
					const input = sceneAgentApplyRequestSchema.parse({
						path,
						expectedSha256: options.get("expected-sha256"),
						operations: jsonOption(options, "operations"),
					});
					return result(
						await handlers.applySemanticScene({
							...input,
							threadId,
							signal,
							writerNonce: randomUUID(),
						}),
						json,
					);
				}
				throw new Error(
					`unknown command: ${command}; run bb excalidraw --help`,
				);
			} catch (error) {
				return failure(error);
			}
		},
	});
}
