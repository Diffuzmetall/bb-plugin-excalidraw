import { loadFromBlob, serializeAsJSON } from "@excalidraw/excalidraw";
import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";

export const MAX_SCENE_BYTES = 20 * 1024 * 1024;

type SceneAppState = Partial<AppState>;

export interface SceneData {
	elements: readonly object[];
	appState: object;
	files: object;
}

export type SceneRestoreResult =
	| { status: "ready"; scene: SceneData }
	| { status: "error"; message: string };

export interface ExcalidrawInitialScene {
	elements: readonly ExcalidrawElement[];
	appState: Partial<AppState>;
	files: BinaryFiles;
}

const nonDurableAppStateKeys = new Set([
	"scrollX",
	"scrollY",
	"zoom",
	"theme",
]);

function durableAppState(appState: object): SceneAppState {
	return Object.fromEntries(
		Object.entries(appState).filter(
			([key]) => !nonDurableAppStateKeys.has(key),
		),
	) as SceneAppState;
}

export async function restoreScene(
	content: string,
): Promise<SceneRestoreResult> {
	if (new TextEncoder().encode(content).byteLength > MAX_SCENE_BYTES) {
		return { status: "error", message: "Scene exceeds the 20 MiB limit" };
	}
	try {
		const restored = await loadFromBlob(
			new Blob([content], { type: "application/json" }),
			null,
			null,
		);
		return {
			status: "ready",
			scene: {
				elements: restored.elements,
				appState: restored.appState,
				files: restored.files,
			},
		};
	} catch (cause) {
		return {
			status: "error",
			message: cause instanceof Error ? cause.message : "Could not load scene",
		};
	}
}

export function toExcalidrawInitialScene(
	scene: SceneData,
): ExcalidrawInitialScene {
	return {
		elements: scene.elements as readonly ExcalidrawElement[],
		appState: scene.appState as Partial<AppState>,
		files: scene.files as BinaryFiles,
	};
}

export function serializeScene(scene: SceneData): string {
	return serializeAsJSON(
		scene.elements as readonly ExcalidrawElement[],
		durableAppState(scene.appState) as Partial<AppState>,
		scene.files as BinaryFiles,
		"database",
	);
}

export function hasDurableChanges(
	previousSerialized: string,
	next: SceneData,
): boolean {
	return previousSerialized !== serializeScene(next);
}

export function isSaveShortcut(
	event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey">,
): boolean {
	return (
		event.key.toLowerCase() === "s" &&
		(event.metaKey || event.ctrlKey) &&
		!event.altKey
	);
}
