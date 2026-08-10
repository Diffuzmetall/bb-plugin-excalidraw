import { Excalidraw } from "@excalidraw/excalidraw";
import {
	definePluginApp,
	useRealtime,
	useRealtimeConnectionState,
	useRpc,
	type PluginFileOpenerProps,
} from "@bb/plugin-sdk/app";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ExcalidrawRpcContract } from "./server";
import {
	isSaveShortcut,
	restoreScene,
	serializeScene,
	toExcalidrawInitialScene,
	type SceneData,
} from "./scene-state";
import {
	createSaveCoordinator,
	getSaveCoordinator,
	type SaveCoordinator,
	type SaveCoordinatorState,
} from "./save-coordinator";
import {
	decideExcalidrawInvalidation,
	EXCALIDRAW_INVALIDATION_CHANNEL,
	excalidrawInvalidationPayloadSchema,
	shouldReconcileAfterReconnect,
} from "./realtime-invalidation";
import "@excalidraw/excalidraw/index.css";
import "./styles.css";

type CanvasTheme = "light" | "dark";
type LoadState = "loading" | "ready" | "error";

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

export function ExcalidrawFileOpener({ path, source }: PluginFileOpenerProps) {
	const mountRef = useRef<HTMLDivElement>(null);
	const rpc = useRpc<ExcalidrawRpcContract>();
	const [theme, setTheme] = useState<CanvasTheme>(readHostTheme);
	const [api, setApi] = useState<{ refresh: () => void } | null>(null);
	const [scene, setScene] = useState<SceneData | null>(null);
	const [coordinator, setCoordinator] = useState<SaveCoordinator | null>(null);
	const [coordinatorState, setCoordinatorState] =
		useState<SaveCoordinatorState | null>(null);
	const [loadState, setLoadState] = useState<LoadState>("loading");
	const [message, setMessage] = useState("Loading scene…");

	const clientSourceKey = `${source.kind}:${source.threadId ?? ""}:${source.environmentId ?? ""}:${source.projectId ?? ""}`;
	const loadKey = `${clientSourceKey}:${path}`;
	const activeCoordinatorRef = useRef<SaveCoordinator | null>(null);
	const activeIdentityRef = useRef<{
		coordinator: SaveCoordinator;
		sourceKey: string | null;
		path: string;
	} | null>(null);
	const unsubscribeRef = useRef<(() => void) | null>(null);
	const connectionState = useRealtimeConnectionState();
	const previousConnectionStateRef = useRef(connectionState);

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
				const current = getSaveCoordinator(coordinatorKey, () =>
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
				activeCoordinatorRef.current = current;
				activeIdentityRef.current = {
					coordinator: current,
					sourceKey: result.sourceKey,
					path: result.path,
				};
				unsubscribeRef.current?.();
				unsubscribeRef.current = current.subscribe((next) => {
					if (cancelled) return;
					setCoordinatorState(next);
					setScene(next.scene);

					if (next.message) setMessage(next.message);
				});
				setCoordinator(current);
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
			void active?.dispose();
		};
	}, [clientSourceKey, loadKey, path]);

	useEffect(() => {
		const mount = mountRef.current;
		if (!mount) return;
		const flushPointerUp = () => {
			void activeCoordinatorRef.current?.flush("pointerup");
		};
		const flushBlur = () => {
			void activeCoordinatorRef.current?.flush("blur");
		};
		mount.addEventListener("pointerup", flushPointerUp, true);
		mount.addEventListener("blur", flushBlur, true);
		return () => {
			mount.removeEventListener("pointerup", flushPointerUp, true);
			mount.removeEventListener("blur", flushBlur, true);
		};
	}, []);

	useEffect(() => {
		const root = document.documentElement;
		const observer = new MutationObserver(() => setTheme(readHostTheme()));
		observer.observe(root, { attributes: true, attributeFilter: ["class"] });
		return () => observer.disconnect();
	}, []);

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
			setMessage("File changed elsewhere; reload or overwrite");
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
	const restoreFocus = () => {
		requestAnimationFrame(() => mountRef.current?.focus());
	};
	const reload = async () => {
		await coordinator?.reload();
		restoreFocus();
	};
	const overwrite = async () => {
		await coordinator?.overwrite();
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
							<>
								<button type="button" onClick={() => void reload()}>
									Reload
								</button>
								<button type="button" onClick={() => void overwrite()}>
									Overwrite
								</button>
							</>
						)}
					</>
				)}
			</div>
			{scene && loadState === "ready" && (
				<Excalidraw
					autoFocus
					theme={theme}
					excalidrawAPI={setApi}
					onChange={handleChange}
					handleKeyboardGlobally={false}
					validateEmbeddable={false}
					onLinkOpen={handleLinkOpen}
					initialData={toExcalidrawInitialScene(scene)}
					UIOptions={{
						canvasActions: {
							export: false,
							loadScene: false,
							saveToActiveFile: false,
							saveAsImage: false,
						},
					}}
				/>
			)}
		</div>
	);
}

export default definePluginApp((app) => {
	app.slots.fileOpener({
		id: "excalidraw",
		title: "Excalidraw",
		extensions: ["excalidraw"],
		component: ExcalidrawFileOpener,
	});
});
