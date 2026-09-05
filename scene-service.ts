import path from "node:path";
import { createHash } from "node:crypto";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

import {
	MAX_SCENE_READ_OUTPUT_BYTES,
	summarizeSceneRead,
	type SceneReadSummary,
} from "./scene-read-summary.js";
import {
	semanticApplyRequestSchema,
	semanticCreateRequestSchema,
} from "./semantic-schema.js";
import {
	applySemanticOperationBatch,
	createExcalidrawScene,
} from "./scene-adapter.js";
import {
	EXCALIDRAW_INVALIDATION_CHANNEL,
	excalidrawInvalidationPayloadSchema,
	workspaceSourceKey,
} from "./realtime-invalidation.js";
import {
	decodeObsidianExcalidrawMarkdown,
	encodeObsidianExcalidrawMarkdown,
} from "./obsidian-scene.js";

export const sceneSourceSchema = z
	.object({
		kind: z.enum(["workspace", "host", "thread-storage"]),
		threadId: z.string().nullable(),
		environmentId: z.string().nullable(),
		projectId: z.string().nullable(),
	})
	.strict();

export const sceneRequestSchema = z
	.object({
		path: z.string().min(1),
		source: sceneSourceSchema,
	})
	.strict();

export const sceneAgentReadRequestSchema = z
	.object({
		path: z.string().min(1),
	})
	.strict();

export const sceneListRequestSchema = z
	.object({
		threadId: z.string().min(1),
	})
	.strict();

export const sceneListResultSchema = z.discriminatedUnion("status", [
	z
		.object({
			status: z.literal("ready"),
			paths: z.array(z.string()),
			truncated: z.boolean(),
		})
		.strict(),
	z
		.object({
			status: z.literal("error"),
			message: z.string(),
		})
		.strict(),
]);

export const projectSceneListRequestSchema = z.object({}).strict();

export const projectSceneEntrySchema = z
	.object({
		projectId: z.string(),
		projectName: z.string(),
		path: z.string(),
		format: z.enum(["native", "obsidian-markdown"]),
	})
	.strict();

export const projectSceneListResultSchema = z
	.object({
		status: z.literal("ready"),
		entries: z.array(projectSceneEntrySchema),
		truncatedProjects: z.array(z.string()),
		unavailableProjects: z.array(z.string()),
	})
	.strict();

export const sceneAgentCreateRequestSchema = sceneAgentReadRequestSchema
	.extend(semanticCreateRequestSchema.shape)
	.strict();

export const sceneAgentApplyRequestSchema = sceneAgentReadRequestSchema
	.extend(semanticApplyRequestSchema.shape)
	.strict();

export const saveSceneRequestSchema = sceneRequestSchema
	.extend({
		content: z.string(),
		expectedSha256: z.string().nullable(),
		writerNonce: z.string().min(1),
	})
	.strict();

const sceneReadySchema = z
	.object({
		status: z.literal("ready"),
		path: z.string(),
		content: z.string(),
		contentEncoding: z.literal("utf8"),
		sizeBytes: z.number().int().nonnegative(),
		sha256: z.string(),
		sourceKey: z.string().nullable(),
		writable: z.boolean(),
	})
	.strict();

const sceneErrorSchema = z
	.object({
		status: z.literal("error"),
		code: z.enum([
			"invalid_path",
			"invalid_scene",
			"too_large",
			"unsupported_encoding",
			"unsupported_source",
			"missing_workspace",
			"authority_unproven",
		]),
		message: z.string(),
	})
	.strict();

export const sceneReadResultSchema = z.discriminatedUnion("status", [
	sceneReadySchema,
	sceneErrorSchema,
]);

export const sceneWriteResultSchema = z.discriminatedUnion("status", [
	z
		.object({
			status: z.literal("written"),
			sha256: z.string(),
			sizeBytes: z.number().int().nonnegative(),
		})
		.strict(),
	z
		.object({
			status: z.literal("conflict"),
			currentSha256: z.string().nullable(),
		})
		.strict(),
	sceneErrorSchema,
]);

export type SceneSource = z.infer<typeof sceneSourceSchema>;
export type SceneRequest = z.infer<typeof sceneRequestSchema>;
export type SaveSceneRequest = z.infer<typeof saveSceneRequestSchema>;
export type SceneAgentReadRequest = z.infer<typeof sceneAgentReadRequestSchema>;
export type SceneListRequest = z.infer<typeof sceneListRequestSchema>;
export type SceneListResult = z.infer<typeof sceneListResultSchema>;
export type ProjectSceneEntry = z.infer<typeof projectSceneEntrySchema>;
export type ProjectSceneListResult = z.infer<typeof projectSceneListResultSchema>;
export type SceneAgentCreateRequest = z.infer<
	typeof sceneAgentCreateRequestSchema
>;
export type SceneAgentApplyRequest = z.infer<
	typeof sceneAgentApplyRequestSchema
>;
export type SceneAgentReadResult =
	| { status: "ready"; summary: SceneReadSummary }
	| z.infer<typeof sceneErrorSchema>;
export type SceneReadResult = z.infer<typeof sceneReadResultSchema>;
export type SceneWriteResult = z.infer<typeof sceneWriteResultSchema>;

export const MAX_SCENE_BYTES = 20 * 1024 * 1024;
export const MAX_SCENE_ELEMENTS = 10_000;
export const MAX_SCENE_LIST_PATHS = 10_000;

interface SceneTarget {
	kind: "workspace" | "host";
	path: string;
	rootPath: string;
	hostId: string;
	environmentId: string;
	writable: boolean;
}

interface SceneProjectTarget {
	kind: "project";
	path: string;
	rootPath: string;
	hostId: string;
	projectId: string;
	sourceKey: string;
	writable: true;
}

function error(
	code: z.infer<typeof sceneErrorSchema>["code"],
	message: string,
): z.infer<typeof sceneErrorSchema> {
	return { status: "error", code, message };
}

function normalizeRelativePath(value: string): string | null {
	if (
		value.includes("\0") ||
		path.posix.isAbsolute(value) ||
		path.win32.isAbsolute(value)
	) {
		return null;
	}
	const normalized = path.posix.normalize(value.replaceAll("\\", "/"));
	if (
		normalized === "." ||
		normalized === ".." ||
		normalized.startsWith("../") ||
		normalized.includes(":")
	) {
		return null;
	}
	return normalized;
}

function isNativeScenePath(value: string): boolean {
	return value.toLowerCase().endsWith(".excalidraw");
}

function isObsidianScenePath(value: string): boolean {
	return value.toLowerCase().endsWith(".excalidraw.md");
}

function isReadableScenePath(value: string): boolean {
	return isNativeScenePath(value) || isObsidianScenePath(value);
}

function validateScenePath(
	value: string,
	allowObsidian = false,
):
	| { ok: true; path: string }
	| { ok: false; result: z.infer<typeof sceneErrorSchema> } {
	const normalized = normalizeRelativePath(value);
	if (
		!normalized ||
		!(allowObsidian ? isReadableScenePath(normalized) : isNativeScenePath(normalized))
	) {
		return {
			ok: false,
			result: error(
				"invalid_path",
				allowObsidian
					? "Scene paths must be confined relative .excalidraw or .excalidraw.md paths"
					: "Scene paths must be confined relative .excalidraw paths",
			),
		};
	}
	return { ok: true, path: normalized };
}

function validateSceneContent(
	content: string,
):
	| { ok: true; sizeBytes: number; sha256: string }
	| { ok: false; result: z.infer<typeof sceneErrorSchema> } {
	const sizeBytes = Buffer.byteLength(content, "utf8");
	if (sizeBytes > MAX_SCENE_BYTES) {
		return {
			ok: false,
			result: error("too_large", "Excalidraw scenes are limited to 20 MiB"),
		};
	}
	let scene: unknown;
	try {
		scene = JSON.parse(content);
	} catch {
		return {
			ok: false,
			result: error("invalid_scene", "Scene content must be valid JSON"),
		};
	}
	if (
		typeof scene !== "object" ||
		scene === null ||
		(scene as { type?: unknown }).type !== "excalidraw" ||
		!Array.isArray((scene as { elements?: unknown }).elements)
	) {
		return {
			ok: false,
			result: error(
				"invalid_scene",
				'Scene JSON must have type "excalidraw" and an elements array',
			),
		};
	}
	if ((scene as { elements: unknown[] }).elements.length > MAX_SCENE_ELEMENTS) {
		return {
			ok: false,
			result: error(
				"too_large",
				"Excalidraw scenes are limited to 10,000 elements",
			),
		};
	}
	return {
		ok: true,
		sizeBytes,
		sha256: createHash("sha256").update(content, "utf8").digest("hex"),
	};
}

function sourceError(source: SceneSource): z.infer<typeof sceneErrorSchema> {
	if (source.kind === "thread-storage") {
		return error(
			"unsupported_source",
			"Thread-storage scenes are not editable by this plugin",
		);
	}
	return error(
		"authority_unproven",
		"The scene host authority could not be proven from server context",
	);
}

export function resolveScenePath(
	value: string,
):
	| { ok: true; path: string }
	| { ok: false; result: z.infer<typeof sceneErrorSchema> } {
	return validateScenePath(value);
}

function validateSourcePath(
	source: SceneSource,
	value: string,
	allowObsidian = false,
) {
	if (source.kind === "host") {
		if (
			(!path.posix.isAbsolute(value) && !path.win32.isAbsolute(value)) ||
			!(allowObsidian ? isReadableScenePath(value) : isNativeScenePath(value))
		) {
			return {
				ok: false as const,
				result: error(
					"invalid_path",
					allowObsidian
						? "Host scene paths must be absolute .excalidraw or .excalidraw.md paths"
						: "Host scene paths must be absolute .excalidraw paths",
				),
			};
		}
		return { ok: true as const, path: value };
	}
	return validateScenePath(value, allowObsidian);
}

function decodeStoredScene(
	filePath: string,
	content: string,
):
	| { ok: true; content: string; sizeBytes: number; sha256: string }
	| { ok: false; result: z.infer<typeof sceneErrorSchema> } {
	let decoded = content;
	if (isObsidianScenePath(filePath)) {
		try {
			decoded = decodeObsidianExcalidrawMarkdown(content);
		} catch (caught) {
			return {
				ok: false,
				result: error(
					"invalid_scene",
					caught instanceof Error
						? caught.message
						: "Obsidian drawing could not be decoded",
				),
			};
		}
	}
	const validation = validateSceneContent(decoded);
	if (!validation.ok) return validation;
	return { ...validation, content: decoded };
}

export function validateScene(value: string) {
	return validateSceneContent(value);
}

export function createSceneHandlers(bb: BbPluginApi) {
	async function resolveTarget(
		source: SceneSource,
		relativePath: string,
	): Promise<
		| SceneTarget
		| SceneProjectTarget
		| { error: z.infer<typeof sceneErrorSchema> }
	> {
		if (source.kind === "thread-storage") return { error: sourceError(source) };
		// A project-backed file keeps its project authority even when BB also
		// supplies the ambient thread. Otherwise the path is resolved against the
		// thread's unrelated worktree and valid cross-project files return 404.
		if (source.projectId) {
			const project = await bb.sdk.projects.get({
				projectId: source.projectId,
			});
			const projectSource =
				project.sources.find((entry) => entry.isDefault) ?? project.sources[0];
			if (!projectSource) {
				return {
					error: error(
						"missing_workspace",
						"This project has no authoritative workspace source",
					),
				};
			}
			const pathApi =
				path.win32.isAbsolute(projectSource.path) &&
				!path.posix.isAbsolute(projectSource.path)
					? path.win32
					: path.posix;
			let projectRelativePath = relativePath;
			if (!relativePath.includes("/")) {
				const result = await bb.sdk.projects.paths({
					projectId: project.id,
					query: "excalidraw",
					includeFiles: "true",
					includeDirectories: "false",
					limit: String(MAX_SCENE_LIST_PATHS),
				});
				const matches = result.paths.filter((entry) => {
					if (entry.kind !== "file" || !isReadableScenePath(entry.path)) return false;
					return path.posix.basename(entry.path.replaceAll("\\", "/")) === relativePath;
				});
				if (matches.length === 1) {
					projectRelativePath = matches[0].path.replaceAll("\\", "/");
				}
			}
			return {
				kind: "project",
				path: pathApi.join(
					projectSource.path,
					projectRelativePath.replaceAll("/", pathApi.sep),
				),
				rootPath: projectSource.path,
				hostId: projectSource.hostId,
				projectId: project.id,
				sourceKey: `project:${project.id}:${projectSource.id}`,
				writable: true,
			};
		}
		const threadEnvironmentId = source.threadId
			? (await bb.sdk.threads.get({ threadId: source.threadId })).environmentId
			: null;
		if (
			source.environmentId &&
			threadEnvironmentId &&
			source.environmentId !== threadEnvironmentId
		) {
			return {
				error: error(
					"authority_unproven",
					"Source environment conflicts with thread environment",
				),
			};
		}
		const environmentId = source.environmentId ?? threadEnvironmentId;
		if (!environmentId) {
			return {
				error: error(
					"authority_unproven",
					"No environment or registered project authority is available for this scene",
				),
			};
		}
		const environment = await bb.sdk.environments.get({ environmentId });
		if (!environment.hostId) {
			return {
				error: error(
					"authority_unproven",
					"Environment has no authoritative host",
				),
			};
		}
		if (!environment.path) {
			return {
				error: error(
					"missing_workspace",
					"This environment has no workspace path",
				),
			};
		}
		if (source.kind === "host") {
			if (
				!path.posix.isAbsolute(relativePath) &&
				!path.win32.isAbsolute(relativePath)
			) {
				return {
					error: error("invalid_path", "Host scene paths must be absolute"),
				};
			}
			const isWindowsPath =
				path.win32.isAbsolute(relativePath) &&
				!path.posix.isAbsolute(relativePath);
			const normalized = isWindowsPath
				? path.win32.normalize(relativePath)
				: path.posix.normalize(relativePath);
			const pathApi = isWindowsPath ? path.win32 : path.posix;
			const rootPath = pathApi.normalize(environment.path);
			const relativeToRoot = pathApi.relative(rootPath, normalized);
			if (
				relativeToRoot === ".." ||
				relativeToRoot.startsWith(`..${pathApi.sep}`) ||
				pathApi.isAbsolute(relativeToRoot)
			) {
				return {
					error: error(
						"authority_unproven",
						"Host path is outside the authoritative environment root",
					),
				};
			}
			return {
				kind: "host",
				path: normalized,
				rootPath,
				hostId: environment.hostId,
				environmentId,
				writable: false,
			};
		}
		return {
			kind: "workspace",
			path: path.posix.join(environment.path, relativePath),
			rootPath: environment.path,
			hostId: environment.hostId,
			environmentId,
			writable: true,
		};
	}

	async function readScene(input: SceneRequest): Promise<SceneReadResult> {
		const pathResult = validateSourcePath(input.source, input.path, true);
		if (!pathResult.ok) return pathResult.result;
		const target = await resolveTarget(input.source, pathResult.path);
		if ("error" in target) return target.error;
		const file = await bb.sdk.files.read({
			hostId: target.hostId,
			path: target.path,
			rootPath: target.rootPath,
		});
		if (file.contentEncoding !== "utf8") {
			return error("unsupported_encoding", "Scene content must be UTF-8 text");
		}
		if (file.sizeBytes > MAX_SCENE_BYTES) {
			return error("too_large", "Excalidraw scenes are limited to 20 MiB");
		}
		const decoded = decodeStoredScene(pathResult.path, file.content);
		if (!decoded.ok) return decoded.result;
		return {
			status: "ready",
			path: input.source.kind === "host" ? target.path : pathResult.path,
			content: decoded.content,
			contentEncoding: "utf8",
			sizeBytes: decoded.sizeBytes,
			sha256: file.sha256 ?? createHash("sha256").update(file.content, "utf8").digest("hex"),
			sourceKey:
				target.kind === "workspace"
					? workspaceSourceKey(target.environmentId)
					: target.kind === "project"
						? target.sourceKey
						: null,
			writable: target.writable,
		};
	}

	async function listProjectScenes(): Promise<ProjectSceneListResult> {
		const projects = await bb.sdk.projects.list({ includePersonal: true });
		const entries: ProjectSceneEntry[] = [];
		const truncatedProjects: string[] = [];
		const unavailableProjects: string[] = [];

		for (const project of projects) {
			if (project.sources.length === 0) continue;
			try {
				const result = await bb.sdk.projects.paths({
					projectId: project.id,
					query: "excalidraw",
					includeFiles: "true",
					includeDirectories: "false",
					limit: String(MAX_SCENE_LIST_PATHS),
				});
				for (const entry of result.paths) {
					if (entry.kind !== "file" || !isReadableScenePath(entry.path)) continue;
					entries.push({
						projectId: project.id,
						projectName: project.name,
						path: entry.path.replaceAll("\\", "/"),
						format: isObsidianScenePath(entry.path)
							? "obsidian-markdown"
							: "native",
					});
				}
				if (result.truncated) truncatedProjects.push(project.name);
			} catch {
				unavailableProjects.push(project.name);
			}
		}

		entries.sort(
			(left, right) =>
				left.projectName.localeCompare(right.projectName) ||
				left.path.localeCompare(right.path),
		);
		return {
			status: "ready",
			entries,
			truncatedProjects,
			unavailableProjects,
		};
	}

	async function listScenes(input: SceneListRequest): Promise<SceneListResult> {
		const thread = await bb.sdk.threads.get({ threadId: input.threadId });
		if (!thread.environmentId) {
			return { status: "error", message: "This thread has no workspace" };
		}
		const environment = await bb.sdk.environments.get({
			environmentId: thread.environmentId,
		});
		if (!environment.hostId || !environment.path) {
			return {
				status: "error",
				message: "This thread has no authoritative workspace",
			};
		}
		const result = await bb.sdk.files.listPaths({
			hostId: environment.hostId,
			path: environment.path,
			includeFiles: true,
			includeDirectories: false,
			limit: MAX_SCENE_LIST_PATHS,
		});
		return {
			status: "ready",
			paths: result.paths
				.filter(
					(entry) =>
						entry.kind === "file" && isReadableScenePath(entry.path),
				)
				.map((entry) => entry.path.replaceAll("\\", "/"))
				.sort((left, right) => left.localeCompare(right)),
			truncated: result.truncated,
		};
	}

	function workspaceSource(threadId: string): SceneSource {
		return {
			kind: "workspace",
			threadId,
			environmentId: null,
			projectId: null,
		};
	}

	async function readSemanticScene({
		path,
		threadId,
		signal,
	}: SceneAgentReadRequest & {
		threadId: string;
		signal: AbortSignal;
	}): Promise<SceneAgentReadResult> {
		signal.throwIfAborted();
		const result = await readScene({ path, source: workspaceSource(threadId) });
		signal.throwIfAborted();
		if (result.status === "error") return result;
		return {
			status: "ready",
			summary: summarizeSceneRead(
				result.content,
				result.sha256,
				MAX_SCENE_READ_OUTPUT_BYTES - 1024,
			),
		};
	}

	async function createSemanticScene({
		path,
		threadId,
		signal,
		scene,
		writerNonce: _writerNonce,
	}: SceneAgentCreateRequest & {
		threadId: string;
		signal: AbortSignal;
		writerNonce: string;
	}): Promise<SceneWriteResult> {
		signal.throwIfAborted();
		const content = createExcalidrawScene(scene);
		signal.throwIfAborted();
		return saveScene({
			path,
			source: workspaceSource(threadId),
			content,
			expectedSha256: null,
			writerNonce: _writerNonce,
		});
	}

	async function applySemanticScene({
		path,
		threadId,
		signal,
		expectedSha256,
		operations,
		writerNonce: _writerNonce,
	}: SceneAgentApplyRequest & {
		threadId: string;
		signal: AbortSignal;
		writerNonce: string;
	}): Promise<SceneWriteResult> {
		signal.throwIfAborted();
		const source = workspaceSource(threadId);
		const current = await readScene({ path, source });
		signal.throwIfAborted();
		if (current.status === "error") return current;
		if (!current.writable) {
			return error(
				"unsupported_source",
				"Only authoritative workspace scenes can be edited",
			);
		}
		if (current.sha256 !== expectedSha256) {
			return { status: "conflict", currentSha256: current.sha256 };
		}
		const content = applySemanticOperationBatch(current.content, {
			operations,
		});
		signal.throwIfAborted();
		return saveScene({
			path,
			source,
			content,
			expectedSha256,
			writerNonce: _writerNonce,
		});
	}

	async function saveScene(input: SaveSceneRequest): Promise<SceneWriteResult> {
		const pathResult = validateSourcePath(input.source, input.path, true);
		if (!pathResult.ok) return pathResult.result;
		const validation = validateSceneContent(input.content);
		if (!validation.ok) return validation.result;
		const target = await resolveTarget(input.source, pathResult.path);
		if ("error" in target) return target.error;
		if (!target.writable || target.kind === "host") {
			return error(
				"unsupported_source",
				"Only authoritative workspace or registered-project scenes can be edited",
			);
		}

		let storedContent = input.content;
		if (isObsidianScenePath(pathResult.path)) {
			const current = await bb.sdk.files.read({
				hostId: target.hostId,
				path: target.path,
				rootPath: target.rootPath,
			});
			if (current.contentEncoding !== "utf8") {
				return error(
					"unsupported_encoding",
					"Scene content must be UTF-8 text",
				);
			}
			const currentSha256 =
				current.sha256 ??
				createHash("sha256").update(current.content, "utf8").digest("hex");
			if (
				input.expectedSha256 !== null &&
				currentSha256 !== input.expectedSha256
			) {
				return {
					status: "conflict",
					currentSha256,
				};
			}
			try {
				storedContent = encodeObsidianExcalidrawMarkdown(
					current.content,
					input.content,
				);
			} catch (caught) {
				return error(
					"invalid_scene",
					caught instanceof Error
						? caught.message
						: "Obsidian drawing could not be encoded",
				);
			}
			if (Buffer.byteLength(storedContent, "utf8") > MAX_SCENE_BYTES) {
				return error("too_large", "Excalidraw scenes are limited to 20 MiB");
			}
		}

		const result = await bb.sdk.files.write({
			hostId: target.hostId,
			path: target.path,
			rootPath: target.rootPath,
			content: storedContent,
			contentEncoding: "utf8",
			expectedSha256: input.expectedSha256,
		});
		if (result.outcome === "conflict") {
			return { status: "conflict", currentSha256: result.currentSha256 };
		}
		if (input.writerNonce !== undefined) {
			const sourceKey =
				target.kind === "workspace"
					? workspaceSourceKey(target.environmentId)
					: target.kind === "project"
						? target.sourceKey
						: null;
			if (!sourceKey) {
				return error(
					"authority_unproven",
					"Scene source cannot publish authoritative invalidations",
				);
			}
			bb.realtime.publish(
				EXCALIDRAW_INVALIDATION_CHANNEL,
				excalidrawInvalidationPayloadSchema.parse({
					sourceKey,
					path: pathResult.path,
					sha256: result.sha256,
					writerNonce: input.writerNonce,
				}),
			);
		}
		return {
			status: "written",
			sha256: result.sha256,
			sizeBytes: validation.sizeBytes,
		};
	}

	return {
		readScene,
		listProjectScenes,
		listScenes,
		readSemanticScene,
		createSemanticScene,
		applySemanticScene,
		saveScene,
	};
}
