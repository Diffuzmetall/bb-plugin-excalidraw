import {
	CaptureUpdateAction,
	Excalidraw,
	MainMenu,
} from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import {
	definePluginApp,
	useRealtime,
	useRealtimeConnectionState,
	useRpc,
	type PluginFileOpenerProps,
	type PluginThreadPanelProps,
} from "@bb/plugin-sdk/app";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ExcalidrawRpcContract } from "./server";
import {
	isSaveShortcut,
	restoreScene,
	serializeScene,
	toExcalidrawInitialScene,
	type SceneData,
} from "./scene-state";
import {
	acquireSaveCoordinator,
	createSaveCoordinator,
	type SaveCoordinator,
	type SaveCoordinatorLease,
	type SaveCoordinatorState,
} from "./save-coordinator";
import {
	decideExcalidrawInvalidation,
	EXCALIDRAW_INVALIDATION_CHANNEL,
	excalidrawInvalidationPayloadSchema,
	shouldReconcileAfterReconnect,
} from "./realtime-invalidation";
import "./excalidraw.css";
import "./styles.css";

type CanvasTheme = "light" | "dark";
type CanvasThemePreference = CanvasTheme | "system";
type LoadState = "loading" | "ready" | "error";

const CANVAS_THEME_PREFERENCE_KEY = "bb.excalidraw.theme";
const CANVAS_THEME_PREFERENCE_EVENT = "bb:excalidraw-theme-preference";
const EXCALIDRAW_UI_OPTIONS = {
	canvasActions: {
		export: false as const,
		loadScene: false,
		saveToActiveFile: false,
		saveAsImage: false,
		toggleTheme: true,
	},
};

export function isAllowedExternalLink(href: string): boolean {
	try {
		const url = new URL(href);
		return url.protocol === "http:" || url.protocol === "https:";
	} catch {
		return false;
	}
}

export function handleLinkOpen(
	element: { link?: string | null },
	event: { preventDefault: () => void },
): void {
	event.preventDefault();
	if (element.link && isAllowedExternalLink(element.link)) {
		window.open(element.link, "_blank", "noopener,noreferrer");
	}
}

function readHostTheme(): CanvasTheme {
	return typeof document !== "undefined" &&
		document.documentElement.classList.contains("dark")
		? "dark"
		: "light";
}

function readCanvasThemePreference(): CanvasThemePreference {
	if (typeof window === "undefined") return "system";
	try {
		const stored = window.localStorage.getItem(CANVAS_THEME_PREFERENCE_KEY);
		return stored === "light" || stored === "dark" || stored === "system"
			? stored
			: "system";
	} catch {
		return "system";
	}
}

function persistCanvasThemePreference(
	preference: CanvasThemePreference,
): void {
	try {
		window.localStorage.setItem(CANVAS_THEME_PREFERENCE_KEY, preference);
		window.dispatchEvent(new Event(CANVAS_THEME_PREFERENCE_EVENT));
	} catch {
		// The preference remains active for this mounted editor when storage is unavailable.
	}
}

export function ExcalidrawFileOpener({ path, source }: PluginFileOpenerProps) {
	const mountRef = useRef<HTMLDivElement>(null);
	const rpc = useRpc<ExcalidrawRpcContract>();
	const [hostTheme, setHostTheme] = useState<CanvasTheme>(readHostTheme);
	const [themePreference, setThemePreference] =
		useState<CanvasThemePreference>(readCanvasThemePreference);
	const theme = themePreference === "system" ? hostTheme : themePreference;
	const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
	const [scene, setScene] = useState<SceneData | null>(null);
	const [coordinator, setCoordinator] = useState<SaveCoordinator | null>(null);
	const [coordinatorState, setCoordinatorState] =
		useState<SaveCoordinatorState | null>(null);
	const [loadState, setLoadState] = useState<LoadState>("loading");
	const [message, setMessage] = useState("Loading scene…");

	const clientSourceKey = `${source.kind}:${source.threadId ?? ""}:${source.environmentId ?? ""}:${source.projectId ?? ""}`;
	const loadKey = `${clientSourceKey}:${path}`;
	const activeCoordinatorRef = useRef<SaveCoordinator | null>(null);
	const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
	const themeRef = useRef<CanvasTheme>(theme);
	themeRef.current = theme;
	const renderedSceneRef = useRef<SceneData | null>(null);
	const canvasSerializedRef = useRef<string | null>(null);
	const programmaticCanvasUpdateRef = useRef<{
		targetSerialized: string;
	} | null>(null);
	const userInteractedSinceProgrammaticUpdateRef = useRef(false);
	const activeIdentityRef = useRef<{
		coordinator: SaveCoordinator;
		sourceKey: string | null;
		path: string;
	} | null>(null);
	const unsubscribeRef = useRef<(() => void) | null>(null);
	const connectionState = useRealtimeConnectionState();
	const previousConnectionStateRef = useRef(connectionState);

	const syncSceneToCanvas = useCallback((nextScene: SceneData) => {
		const currentApi = apiRef.current;
		if (!currentApi) return;
		const targetSerialized = serializeScene(nextScene);
		const currentCanvasScene = {
			elements: currentApi.getSceneElementsIncludingDeleted(),
			appState: currentApi.getAppState(),
			files: currentApi.getFiles(),
		} satisfies SceneData;
		if (serializeScene(currentCanvasScene) === targetSerialized) {
			canvasSerializedRef.current = targetSerialized;
			programmaticCanvasUpdateRef.current = null;
			return;
		}

		programmaticCanvasUpdateRef.current = { targetSerialized };
		userInteractedSinceProgrammaticUpdateRef.current = false;
		const initialScene = toExcalidrawInitialScene(nextScene);
		currentApi.addFiles(Object.values(initialScene.files));
		currentApi.updateScene({
			elements: initialScene.elements,
			appState: {
				...currentApi.getAppState(),
				...initialScene.appState,
				theme: themeRef.current,
			},
			captureUpdate: CaptureUpdateAction.NEVER,
		});
		currentApi.history.clear();
		canvasSerializedRef.current = targetSerialized;
	}, []);

	const handleApi = useCallback(
		(nextApi: ExcalidrawImperativeAPI | null) => {
			apiRef.current = nextApi;
			setApi(nextApi);
			if (!nextApi) {
				canvasSerializedRef.current = null;
				programmaticCanvasUpdateRef.current = null;
				return;
			}
			const desiredScene = renderedSceneRef.current;
			canvasSerializedRef.current = desiredScene
				? serializeScene(desiredScene)
				: null;
		},
		[],
	);

	useRealtime(EXCALIDRAW_INVALIDATION_CHANNEL, (payload) => {
		const parsed = excalidrawInvalidationPayloadSchema.safeParse(payload);
		if (!parsed.success) return;
		const active = activeIdentityRef.current;
		if (!active?.sourceKey) return;
		const state = active.coordinator.getState();
		const decision = decideExcalidrawInvalidation(
			{
				sourceKey: active.sourceKey,
				path: active.path,
				writerNonce: active.coordinator.getWriterNonce(),
				sha256: state.sha256,
				isDirty: state.status !== "clean",
			},
			parsed.data,
		);
		if (decision.action === "ignore") return;
		void active.coordinator
			.handleExternalInvalidation(parsed.data.sha256)
			.catch((cause) => {
				if (activeIdentityRef.current?.coordinator !== active.coordinator)
					return;
				setMessage(
					cause instanceof Error
						? cause.message
						: "Could not reconcile external scene change",
				);
			});
	});

	useEffect(() => {
		const previous = previousConnectionStateRef.current;
		previousConnectionStateRef.current = connectionState;
		if (!shouldReconcileAfterReconnect(previous, connectionState)) return;
		const active = activeIdentityRef.current;
		if (!active) return;
		void active.coordinator.reconcileExternalChange().catch((cause) => {
			if (activeIdentityRef.current?.coordinator !== active.coordinator) return;
			setMessage(
				cause instanceof Error
					? cause.message
					: "Could not reconcile scene after reconnect",
			);
		});
	}, [connectionState]);

	useEffect(() => {
		let cancelled = false;
		let lease: SaveCoordinatorLease | null = null;
		setLoadState("loading");
		setMessage("Loading scene…");
		setScene(null);
		void (async () => {
			try {
				const result = await rpc.call("readScene", { path, source });
				if (cancelled) return;
				if (result.status === "error") {
					setLoadState("error");
					setMessage(result.message);
					return;
				}
				const restored = await restoreScene(result.content);
				if (cancelled) return;
				if (restored.status === "error") {
					setLoadState("error");
					setMessage(restored.message);
					return;
				}
				const coordinatorKey = `${result.sourceKey ?? clientSourceKey}:${result.path}`;
				lease = acquireSaveCoordinator(coordinatorKey, () =>
					createSaveCoordinator({
						key: coordinatorKey,
						initialScene: restored.scene,
						initialSha256: result.sha256,
						serialize: serializeScene,
						write: async (request) => {
							const saved = await rpc.call("saveScene", {
								path,
								source,
								content: request.content,
								expectedSha256: request.expectedSha256,
								writerNonce: request.writerNonce,
							});
							if (saved.status === "written") return saved;
							if (saved.status === "conflict") return saved;
							return { status: "error", message: saved.message };
						},
						read: async () => {
							const latest = await rpc.call("readScene", { path, source });
							if (latest.status === "error") throw new Error(latest.message);
							const latestScene = await restoreScene(latest.content);
							if (latestScene.status === "error")
								throw new Error(latestScene.message);
							return { scene: latestScene.scene, sha256: latest.sha256 };
						},
					}),
				);
				const current = lease.coordinator;
				activeCoordinatorRef.current = current;
				activeIdentityRef.current = {
					coordinator: current,
					sourceKey: result.sourceKey,
					path: result.path,
				};
				unsubscribeRef.current?.();
				unsubscribeRef.current = current.subscribe((next) => {
					if (cancelled) return;
					renderedSceneRef.current = next.scene;
					setCoordinatorState(next);
					setScene(next.scene);
					syncSceneToCanvas(next.scene);
					setMessage(
						next.message ??
							(next.status === "pending"
								? "Unsaved changes"
								: next.status === "saving"
									? "Saving…"
									: "Ready"),
					);
				});
				setCoordinator(current);
				renderedSceneRef.current = current.getState().scene;
				setScene(current.getState().scene);
				setLoadState("ready");
				setMessage(current.getState().message ?? "Ready");
			} catch (cause) {
				if (cancelled) return;
				setLoadState("error");
				setMessage(
					cause instanceof Error ? cause.message : "Could not load scene",
				);
			}
		})();
		return () => {
			cancelled = true;
			unsubscribeRef.current?.();
			unsubscribeRef.current = null;
			const active = activeCoordinatorRef.current;
			activeCoordinatorRef.current = null;
			if (activeIdentityRef.current?.coordinator === active) {
				activeIdentityRef.current = null;
			}
			renderedSceneRef.current = null;
			programmaticCanvasUpdateRef.current = null;
			void lease?.release();
		};
	}, [clientSourceKey, loadKey, path, syncSceneToCanvas]);

	useEffect(() => {
		const mount = mountRef.current;
		if (!mount) return;
		const noteUserInteraction = () => {
			userInteractedSinceProgrammaticUpdateRef.current = true;
		};
		const flushPointerUp = () => {
			void activeCoordinatorRef.current?.flush("pointerup");
		};
		const flushBlur = () => {
			void activeCoordinatorRef.current?.flush("blur");
		};
		mount.addEventListener("pointerdown", noteUserInteraction, true);
		mount.addEventListener("keydown", noteUserInteraction, true);
		mount.addEventListener("pointerup", flushPointerUp, true);
		mount.addEventListener("blur", flushBlur, true);
		return () => {
			mount.removeEventListener("pointerdown", noteUserInteraction, true);
			mount.removeEventListener("keydown", noteUserInteraction, true);
			mount.removeEventListener("pointerup", flushPointerUp, true);
			mount.removeEventListener("blur", flushBlur, true);
		};
	}, []);

	useEffect(() => {
		const root = document.documentElement;
		const observer = new MutationObserver(() => setHostTheme(readHostTheme()));
		observer.observe(root, { attributes: true, attributeFilter: ["class"] });
		return () => observer.disconnect();
	}, []);

	useEffect(() => {
		const syncPreference = () =>
			setThemePreference(readCanvasThemePreference());
		const syncStoragePreference = (event: StorageEvent) => {
			if (event.key === CANVAS_THEME_PREFERENCE_KEY) syncPreference();
		};
		window.addEventListener(CANVAS_THEME_PREFERENCE_EVENT, syncPreference);
		window.addEventListener("storage", syncStoragePreference);
		return () => {
			window.removeEventListener(CANVAS_THEME_PREFERENCE_EVENT, syncPreference);
			window.removeEventListener("storage", syncStoragePreference);
		};
	}, []);

	const selectThemePreference = useCallback(
		(preference: CanvasThemePreference) => {
			setThemePreference(preference);
			persistCanvasThemePreference(preference);
		},
		[],
	);
	const mainMenu = useMemo(
		() => (
			<MainMenu>
				<MainMenu.DefaultItems.SearchMenu />
				<MainMenu.DefaultItems.Help />
				<MainMenu.DefaultItems.ClearCanvas />
				<MainMenu.Separator />
				<MainMenu.Group title="Excalidraw links">
					<MainMenu.DefaultItems.Socials />
				</MainMenu.Group>
				<MainMenu.Separator />
				<MainMenu.DefaultItems.ToggleTheme
					allowSystemTheme
					theme={themePreference}
					onSelect={selectThemePreference}
				/>
				<MainMenu.DefaultItems.ChangeCanvasBackground />
			</MainMenu>
		),
		[selectThemePreference, themePreference],
	);

	useEffect(() => {
		const mount = mountRef.current;
		if (!mount) return;
		const labelInternalControls = () => {
			const mainMenu =
				mount.querySelector<HTMLButtonElement>(".main-menu-trigger");
			if (mainMenu && !mainMenu.getAttribute("aria-label")) {
				mainMenu.setAttribute("aria-label", "Open main menu");
			}
		};
		labelInternalControls();
		const observer = new MutationObserver(labelInternalControls);
		observer.observe(mount, {
			attributes: true,
			attributeFilter: ["aria-label"],
			childList: true,
			subtree: true,
		});
		return () => observer.disconnect();
	}, []);

	useEffect(() => {
		const mount = mountRef.current;
		if (!mount || typeof ResizeObserver === "undefined") return;
		const resizeObserver = new ResizeObserver(() => {
			requestAnimationFrame(() => api?.refresh());
		});
		resizeObserver.observe(mount);
		return () => resizeObserver.disconnect();
	}, [api]);

	const save = useCallback(async () => {
		const currentCoordinator = activeCoordinatorRef.current;
		if (!currentCoordinator) return;
		const result = await currentCoordinator.flush("shortcut");
		if (result?.status === "conflict")
			setMessage("File changed elsewhere; reload to discard local changes");
	}, []);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (!isSaveShortcut(event)) return;
			event.preventDefault();
			void save();
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [save]);

	const handleChange = useCallback(
		(
			nextElements: readonly object[],
			nextAppState: object,
			nextFiles: object,
		) => {
			const nextScene = {
				elements: nextElements,
				appState: nextAppState,
				files: nextFiles,
			} satisfies SceneData;
			const nextSerialized = serializeScene(nextScene);
			canvasSerializedRef.current = nextSerialized;
			const programmaticUpdate = programmaticCanvasUpdateRef.current;
			if (programmaticUpdate) {
				if (nextSerialized === programmaticUpdate.targetSerialized) {
					programmaticCanvasUpdateRef.current = null;
					userInteractedSinceProgrammaticUpdateRef.current = false;
					return;
				}
				if (!userInteractedSinceProgrammaticUpdateRef.current) return;
				programmaticCanvasUpdateRef.current = null;
			}
			renderedSceneRef.current = nextScene;
			setScene(nextScene);
			const currentCoordinator = activeCoordinatorRef.current ?? coordinator;
			if (currentCoordinator) currentCoordinator.update(nextScene);
		},
		[coordinator],
	);

	const isDirty =
		coordinatorState?.status === "pending" ||
		coordinatorState?.status === "saving" ||
		coordinatorState?.status === "conflict";
	const isSaving = coordinatorState?.status === "saving";
	const showStatus =
		loadState !== "ready" || coordinatorState?.status !== "clean";
	const restoreFocus = () => {
		requestAnimationFrame(() => mountRef.current?.focus());
	};
	const reload = async () => {
		await coordinator?.reload();
		restoreFocus();
	};

	return (
		<div
			ref={mountRef}
			className="excalidraw-plugin"
			data-testid="excalidraw-plugin-mount"
			data-embeddables="disabled"
			tabIndex={-1}
		>
			{showStatus ? (
				<div
					className="excalidraw-file-status"
					data-testid="excalidraw-file-status"
					role="status"
					aria-live="polite"
					aria-atomic="true"
				>
					<span>{message}</span>
					{loadState === "ready" && (
						<>
							<button
								type="button"
								onClick={() => void save()}
								disabled={!isDirty || isSaving}
							>
								{isSaving ? "Saving…" : isDirty ? "Save" : "Saved"}
							</button>
							{coordinatorState?.status === "conflict" && (
								<button type="button" onClick={() => void reload()}>
									Reload
								</button>
							)}
						</>
					)}
				</div>
			) : null}
			{scene && loadState === "ready" && (
				<Excalidraw
					autoFocus
					theme={theme}
					excalidrawAPI={handleApi}
					onChange={handleChange}
					handleKeyboardGlobally={false}
					validateEmbeddable={false}
					onLinkOpen={handleLinkOpen}
					initialData={toExcalidrawInitialScene(scene)}
					UIOptions={EXCALIDRAW_UI_OPTIONS}
				>
					{mainMenu}
				</Excalidraw>
			)}
		</div>
	);
}

export function ExcalidrawPanel({ threadId }: PluginThreadPanelProps) {
	const rpc = useRpc<ExcalidrawRpcContract>();
	const [paths, setPaths] = useState<string[]>([]);
	const [selectedPath, setSelectedPath] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [listError, setListError] = useState<string | null>(null);
	const [truncated, setTruncated] = useState(false);

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		setListError(null);
		void rpc
			.call("listScenes", { threadId })
			.then((result) => {
				if (cancelled) return;
				if (result.status === "error") {
					setPaths([]);
					setSelectedPath(null);
					setListError(result.message);
					return;
				}
				setPaths(result.paths);
				setTruncated(result.truncated);
				setSelectedPath((current) =>
					current && result.paths.includes(current)
						? current
						: (result.paths[0] ?? null),
				);
			})
			.catch((cause) => {
				if (cancelled) return;
				setListError(
					cause instanceof Error ? cause.message : "Could not list scenes",
				);
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [rpc, threadId]);

	if (loading) {
		return (
			<div className="excalidraw-panel-state" role="status">
				Loading Excalidraw files…
			</div>
		);
	}
	if (listError) {
		return (
			<div className="excalidraw-panel-state" role="alert">
				{listError}
			</div>
		);
	}
	if (!selectedPath) {
		return (
			<div className="excalidraw-panel-state" role="status">
				No .excalidraw files found in this workspace.
			</div>
		);
	}

	const source = {
		kind: "workspace" as const,
		threadId,
		environmentId: null,
		projectId: null,
	};
	return (
		<div className="excalidraw-action-panel">
			{paths.length > 1 || truncated ? (
				<div className="excalidraw-scene-picker">
					<label htmlFor="excalidraw-scene-path">Drawing</label>
					<select
						id="excalidraw-scene-path"
						value={selectedPath}
						onChange={(event) => setSelectedPath(event.currentTarget.value)}
					>
						{paths.map((scenePath) => (
							<option key={scenePath} value={scenePath}>
								{scenePath}
							</option>
						))}
					</select>
					{truncated ? <span>Results truncated</span> : null}
				</div>
			) : null}
			<div className="excalidraw-action-canvas">
				<ExcalidrawFileOpener
					key={selectedPath}
					path={selectedPath}
					source={source}
				/>
			</div>
		</div>
	);
}

export default definePluginApp((app) => {
	app.slots.threadPanelAction({
		id: "excalidraw",
		title: "Excalidraw",
		icon: "Edit",
		layout: "flush",
		component: ExcalidrawPanel,
	});
	app.slots.fileOpener({
		id: "excalidraw",
		title: "Excalidraw",
		extensions: ["excalidraw"],
		component: ExcalidrawFileOpener,
	});
});
