import {
	CaptureUpdateAction,
	Excalidraw,
	MainMenu,
} from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import {
	definePluginApp,
	useBbNavigate,
	useRealtime,
	useRealtimeConnectionState,
	useRpc,
	type PluginFileOpenerProps,
	type PluginNavPanelProps,
	type PluginThreadPanelProps,
} from "@bb/plugin-sdk/app";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
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

type ExcalidrawOpenProps = Pick<PluginFileOpenerProps, "path" | "source"> & {
	onSwitchSafetyChange?: (blocked: boolean) => void;
};

function isExcalidrawFile(path: string): boolean {
	const normalized = path.toLowerCase();
	return (
		normalized.endsWith(".excalidraw") ||
		normalized.endsWith(".excalidraw.md")
	);
}

export function ExcalidrawFileOpener({
	path,
	source,
	onSwitchSafetyChange,
}: ExcalidrawOpenProps) {
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
	const [writable, setWritable] = useState(false);

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
		if (decision.action === "ignore") return; // ubs:ignore — public discriminated-union action, not a secret comparison
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
		setWritable(false);
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
				setWritable(result.writable);
				if (!result.writable) {
					renderedSceneRef.current = restored.scene;
					setScene(restored.scene);
					setCoordinator(null);
					setCoordinatorState(null);
					setLoadState("ready");
					setMessage(
						path.toLowerCase().endsWith(".excalidraw.md")
							? "Read-only Obsidian drawing"
							: "Read-only drawing",
					);
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
			if (!writable || !isSaveShortcut(event)) return;
			event.preventDefault();
			void save();
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [save, writable]);

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
	const switchBlocked = Boolean(
		coordinatorState && coordinatorState.status !== "clean",
	);
	useEffect(() => {
		onSwitchSafetyChange?.(switchBlocked);
	}, [onSwitchSafetyChange, switchBlocked]);
	useEffect(
		() => () => onSwitchSafetyChange?.(false),
		[onSwitchSafetyChange],
	);
	const showStatus =
		!writable || loadState !== "ready" || coordinatorState?.status !== "clean";
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
					{loadState === "ready" && writable && (
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
					viewModeEnabled={!writable}
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

function sceneFileName(path: string): string {
	return path.split("/").at(-1) ?? path;
}

function sceneLocation(entry: ProjectSceneEntry): string {
	const separator = entry.path.lastIndexOf("/");
	const folder = separator > 0 ? entry.path.slice(0, separator) : null;
	return [entry.projectName, folder].filter(Boolean).join(" · ");
}

function ExcalidrawSceneSwitcher({
	entries,
	selectedKey,
	onSelect,
	disabled = false,
}: {
	entries: ProjectSceneEntry[];
	selectedKey: string | null;
	onSelect: (entry: ProjectSceneEntry) => void;
	disabled?: boolean;
}) {
	const [query, setQuery] = useState("");
	const [open, setOpen] = useState(false);
	const switcherRef = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const searchRef = useRef<HTMLInputElement>(null);
	const switcherId = useId();
	const searchId = `excalidraw-scene-search-${switcherId}`;
	const resultsId = `excalidraw-scene-results-${switcherId}`;
	const blockedNoticeId = `excalidraw-scene-blocked-${switcherId}`;
	const selected =
		entries.find((entry) => projectSceneKey(entry) === selectedKey) ?? null;
	const normalizedQuery = query.trim().toLocaleLowerCase();
	const visibleEntries = normalizedQuery
		? entries.filter((entry) =>
				`${entry.projectName}/${entry.path}`
					.toLocaleLowerCase()
					.includes(normalizedQuery),
			)
		: entries;

	useEffect(() => {
		if (!open) return;
		const focusFrame = requestAnimationFrame(() => searchRef.current?.focus());
		const closeOutside = (event: PointerEvent) => {
			if (!switcherRef.current?.contains(event.target as Node)) {
				setOpen(false);
				setQuery("");
			}
		};
		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			setOpen(false);
			setQuery("");
			triggerRef.current?.focus();
		};
		document.addEventListener("pointerdown", closeOutside);
		document.addEventListener("keydown", closeOnEscape);
		return () => {
			cancelAnimationFrame(focusFrame);
			document.removeEventListener("pointerdown", closeOutside);
			document.removeEventListener("keydown", closeOnEscape);
		};
	}, [open]);

	return (
		<div ref={switcherRef} className="excalidraw-scene-switcher">
			<button
				ref={triggerRef}
				type="button"
				className="excalidraw-scene-trigger"
				aria-expanded={open}
				aria-controls={resultsId}
				aria-describedby={open && disabled ? blockedNoticeId : undefined}
				aria-haspopup="dialog"
				title={selected ? `${selected.projectName} — ${selected.path}` : undefined}
				onClick={() => {
					if (open) setQuery("");
					setOpen(!open);
				}}
			>
				<span>{selected ? sceneFileName(selected.path) : "Choose drawing"}</span>
				<svg viewBox="0 0 16 16" aria-hidden="true">
					<path d="m4 6 4 4 4-4" />
				</svg>
			</button>
			{open ? (
				<div className="excalidraw-scene-popover" role="dialog" aria-label="Choose drawing">
					<label className="excalidraw-visually-hidden" htmlFor={searchId}>
						Search Excalidraw files
					</label>
					<div className="excalidraw-scene-search">
						<svg viewBox="0 0 16 16" aria-hidden="true">
							<circle cx="7" cy="7" r="4.25" />
							<path d="m10.25 10.25 3 3" />
						</svg>
						<input
							ref={searchRef}
							id={searchId}
							type="search"
							value={query}
							placeholder="Search drawings"
							autoComplete="off"
							spellCheck={false}
							aria-label="Search Excalidraw files"
							aria-controls={resultsId}
							onChange={(event) => setQuery(event.currentTarget.value)}
						/>
					</div>
					{disabled ? (
						<p id={blockedNoticeId} className="excalidraw-scene-blocked" role="status">
							Save or resolve changes before switching.
						</p>
					) : null}
					<div
						id={resultsId}
						className="excalidraw-scene-results"
						aria-label="Excalidraw files"
					>
						{visibleEntries.length ? (
							visibleEntries.map((entry) => {
								const key = projectSceneKey(entry);
								return (
									<button
										key={key}
										type="button"
										aria-current={key === selectedKey ? "true" : undefined}
										disabled={disabled && key !== selectedKey}
										title={
											disabled && key !== selectedKey
												? "Save or resolve changes before switching"
												: entry.path
										}
										onClick={() => {
											setQuery("");
											setOpen(false);
											onSelect(entry);
										}}
									>
										<span>{sceneFileName(entry.path)}</span>
										<small>{sceneLocation(entry)}</small>
									</button>
								);
							})
						) : (
							<div className="excalidraw-scene-results-empty">No drawings found</div>
						)}
					</div>
				</div>
			) : null}
		</div>
	);
}

export function ExcalidrawPanel(_props: PluginThreadPanelProps) {
	const rpc = useRpc<ExcalidrawRpcContract>();
	const [entries, setEntries] = useState<ProjectSceneEntry[]>([]);
	const [selectedKey, setSelectedKey] = useState<string | null>(null);
	const [switchBlocked, setSwitchBlocked] = useState(false);
	const [loading, setLoading] = useState(true);
	const [listError, setListError] = useState<string | null>(null);
	const [listNotice, setListNotice] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		setListError(null);
		void rpc
			.call("listProjectScenes", {})
			.then((result) => {
				if (cancelled) return;
				setEntries(result.entries);
				setSelectedKey((current) =>
					current &&
					result.entries.some((entry) => projectSceneKey(entry) === current)
						? current
						: result.entries[0]
							? projectSceneKey(result.entries[0])
							: null,
				);
				const notices = [
					result.truncatedProjects.length
						? `Results truncated in: ${result.truncatedProjects.join(", ")}`
						: null,
					result.unavailableProjects.length
						? `Unavailable: ${result.unavailableProjects.join(", ")}`
						: null,
				].filter(Boolean);
				setListNotice(notices.length ? notices.join(" · ") : null);
			})
			.catch((cause) => {
				if (cancelled) return;
				setEntries([]);
				setSelectedKey(null);
				setListError(
					cause instanceof Error ? cause.message : "Could not list drawings",
				);
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [rpc]);

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
	const selected =
		entries.find((entry) => projectSceneKey(entry) === selectedKey) ?? null;
	if (!selected) {
		return (
			<div className="excalidraw-panel-state" role="status">
				No Excalidraw files found in registered projects.
			</div>
		);
	}

	return (
		<div className="excalidraw-action-panel">
			<div className="excalidraw-action-canvas">
				<ExcalidrawSceneSwitcher
					entries={entries}
					selectedKey={selectedKey}
					disabled={switchBlocked}
					onSelect={(entry) => setSelectedKey(projectSceneKey(entry))}
				/>
				{listNotice ? (
					<div className="excalidraw-scene-notice">{listNotice}</div>
				) : null}
				<ExcalidrawFileOpener
					key={projectSceneKey(selected)}
					path={selected.path}
					source={{
						kind: "workspace",
						threadId: null,
						environmentId: null,
						projectId: selected.projectId,
					}}
					onSwitchSafetyChange={setSwitchBlocked}
				/>
			</div>
		</div>
	);
}

type ProjectSceneEntry = {
	projectId: string;
	projectName: string;
	path: string;
	format: "native" | "obsidian-markdown";
};

function projectSceneKey(entry: ProjectSceneEntry): string {
	return `${entry.projectId}:${entry.path}`;
}

function projectSceneSubPath(entry: ProjectSceneEntry): string {
	return `${encodeURIComponent(entry.projectId)}/${encodeURIComponent(entry.path)}`;
}

function selectedProjectScene(
	entries: ProjectSceneEntry[],
	subPath: string,
): ProjectSceneEntry | null {
	const separator = subPath.indexOf("/");
	if (separator < 1) return null;
	try {
		const projectId = decodeURIComponent(subPath.slice(0, separator));
		const scenePath = decodeURIComponent(subPath.slice(separator + 1));
		return (
			entries.find(
				(entry) => entry.projectId === projectId && entry.path === scenePath,
			) ?? null
		);
	} catch {
		return null;
	}
}

export function ExcalidrawLibrary({ subPath }: PluginNavPanelProps) {
	const rpc = useRpc<ExcalidrawRpcContract>();
	const navigate = useBbNavigate();
	const [entries, setEntries] = useState<ProjectSceneEntry[]>([]);
	const [selectedKey, setSelectedKey] = useState<string | null>(null);
	const [switchBlocked, setSwitchBlocked] = useState(false);
	const [loading, setLoading] = useState(true);
	const [message, setMessage] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		void rpc
			.call("listProjectScenes", {})
			.then((result) => {
				if (cancelled) return;
				setEntries(result.entries);
				const notices = [
					result.truncatedProjects.length
						? `Results truncated in: ${result.truncatedProjects.join(", ")}`
						: null,
					result.unavailableProjects.length
						? `Unavailable: ${result.unavailableProjects.join(", ")}`
						: null,
				].filter(Boolean);
				setMessage(notices.length ? notices.join(" · ") : null);
			})
			.catch((cause) => {
				if (!cancelled) {
					setMessage(
						cause instanceof Error ? cause.message : "Could not list drawings",
					);
				}
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [rpc]);

	const selectedFromRoute = selectedProjectScene(entries, subPath);
	const selected =
		entries.find((entry) => projectSceneKey(entry) === selectedKey) ??
		selectedFromRoute ??
		entries[0] ??
		null;

	useEffect(() => {
		if (selectedFromRoute) setSelectedKey(projectSceneKey(selectedFromRoute));
	}, [selectedFromRoute]);

	return (
		<div className="excalidraw-library">
			<main className="excalidraw-library-canvas">
				{loading ? (
					<div className="excalidraw-panel-state" role="status">
						Loading Excalidraw files…
					</div>
				) : selected ? (
					<>
						<ExcalidrawSceneSwitcher
							entries={entries}
							selectedKey={selectedKey ?? projectSceneKey(selected)}
							disabled={switchBlocked}
							onSelect={(entry) => {
								setSelectedKey(projectSceneKey(entry));
								navigate.toPluginPanel("excalidraw", {
									subPath: projectSceneSubPath(entry),
								});
							}}
						/>
						{message ? (
							<div className="excalidraw-scene-notice">{message}</div>
						) : null}
						<ExcalidrawFileOpener
							key={`${selected.projectId}:${selected.path}`}
							path={selected.path}
							onSwitchSafetyChange={setSwitchBlocked}
							source={{
								kind: "workspace",
								threadId: null,
								environmentId: null,
								projectId: selected.projectId,
							}}
						/>
					</>
				) : (
					<div className="excalidraw-panel-state" role="status">
						{message ?? "No Excalidraw files found in registered projects."}
					</div>
				)}
			</main>
		</div>
	);
}

export function ExcalidrawFileRouter({
	path,
	source,
	Original,
}: PluginFileOpenerProps) {
	if (!isExcalidrawFile(path)) return <Original />;
	return <ExcalidrawFileOpener path={path} source={source} />;
}

export default definePluginApp((app) => {
	app.slots.navPanel({
		id: "excalidraw-library",
		title: "Excalidraw",
		icon: "Shapes",
		path: "excalidraw",
		component: ExcalidrawLibrary,
	});
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
		// BB picks a file's opener from the extension after its LAST dot, so it sees
		// `.excalidraw.md` as plain `md`. Claiming `md` therefore diverts every
		// Markdown file here, and this plugin's fallback to BB's preview then shadows
		// the Markdown opener the user chose under Settings → Files. Claiming only
		// `.excalidraw` keeps ordinary Markdown with its owner; Obsidian notes open
		// from the Excalidraw picker, which lists them alongside native scenes.
		extensions: ["excalidraw"],
		component: ExcalidrawFileRouter,
	});
});
