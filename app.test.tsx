// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@bb/plugin-sdk/testing/app";
import { act, createElement, useEffect, type ReactNode } from "react";
import { clearSaveCoordinator } from "./save-coordinator";
import { EXCALIDRAW_INVALIDATION_CHANNEL } from "./realtime-invalidation";

type MockExcalidrawApi = {
	updateScene: ReturnType<typeof vi.fn>;
	addFiles: ReturnType<typeof vi.fn>;
	getSceneElementsIncludingDeleted: () => readonly object[];
	getAppState: () => object;
	getFiles: () => object;
	history: { clear: ReturnType<typeof vi.fn> };
	refresh: ReturnType<typeof vi.fn>;
};

const mocks = vi.hoisted(() => ({
	loadFromBlob: vi.fn(),
	serializeAsJSON: vi.fn(),
	onChange: null as
		| ((elements: readonly object[], appState: object, files: object) => void)
		| null,
	validateEmbeddable: null as boolean | null,
	initialData: null as {
		elements?: readonly object[];
		appState?: object;
		files?: object;
	} | null,
	onLinkOpen: null as
		| ((
				element: { link?: string | null },
				event: { preventDefault: () => void },
		  ) => void)
		| null,
	canvasElements: [] as readonly object[],
	canvasAppState: {} as object,
	canvasFiles: {} as Record<string, object>,
	theme: null as "light" | "dark" | null,
	themePreference: null as "light" | "dark" | "system" | null,
	onThemeSelect: null as
		| ((theme: "light" | "dark" | "system") => void)
		| null,
	api: null as MockExcalidrawApi | null,
}));

mocks.api = {
	updateScene: vi.fn(
		(data: { elements?: readonly object[]; appState?: object | null }) => {
			if (data.elements) mocks.canvasElements = data.elements;
			if (data.appState) mocks.canvasAppState = data.appState;
			mocks.onChange?.(
				mocks.canvasElements,
				mocks.canvasAppState,
				mocks.canvasFiles,
			);
		},
	),
	addFiles: vi.fn((nextFiles: Array<{ id: string }>) => {
		mocks.canvasFiles = {
			...mocks.canvasFiles,
			...Object.fromEntries(nextFiles.map((file) => [file.id, file])),
		};
		mocks.onChange?.(
			mocks.canvasElements,
			mocks.canvasAppState,
			mocks.canvasFiles,
		);
	}),
	getSceneElementsIncludingDeleted: () => mocks.canvasElements,
	getAppState: () => mocks.canvasAppState,
	getFiles: () => mocks.canvasFiles,
	history: { clear: vi.fn() },
	refresh: vi.fn(),
};

vi.mock("@excalidraw/excalidraw", () => {
	const MockMainMenu = ({ children }: { children?: ReactNode }) =>
		createElement("div", { "data-testid": "mock-main-menu" }, children);
	MockMainMenu.DefaultItems = {
		SearchMenu: () => null,
		Help: () => null,
		ClearCanvas: () => null,
		Socials: () => null,
		ToggleTheme: (props: {
			theme: "light" | "dark" | "system";
			onSelect: (theme: "light" | "dark" | "system") => void;
		}) => {
			mocks.themePreference = props.theme;
			mocks.onThemeSelect = props.onSelect;
			return createElement("div", { "data-testid": "mock-theme-setting" });
		},
		ChangeCanvasBackground: () => null,
	};
	MockMainMenu.Separator = () => createElement("hr");
	MockMainMenu.Group = ({ children }: { children?: ReactNode }) =>
		createElement("div", null, children);

	return {
		CaptureUpdateAction: { NEVER: "never" },
		MainMenu: MockMainMenu,
		Excalidraw: (props: {
			onChange?: typeof mocks.onChange;
			validateEmbeddable?: boolean;
			onLinkOpen?: typeof mocks.onLinkOpen;
			excalidrawAPI?: (api: MockExcalidrawApi | null) => void;
			theme?: "light" | "dark";
			children?: ReactNode;
			initialData?: {
				elements?: readonly object[];
				appState?: object;
				files?: object;
			};
		}) => {
			mocks.onChange = props.onChange ?? null;
			mocks.validateEmbeddable = props.validateEmbeddable ?? null;
			mocks.initialData = props.initialData ?? null;
			mocks.onLinkOpen = props.onLinkOpen ?? null;
			mocks.theme = props.theme ?? null;
			useEffect(() => {
				mocks.canvasElements = props.initialData?.elements ?? [];
				mocks.canvasAppState = props.initialData?.appState ?? {};
				mocks.canvasFiles =
					(props.initialData?.files as Record<string, object> | undefined) ?? {};
				props.excalidrawAPI?.(mocks.api);
				return () => props.excalidrawAPI?.(null);
			}, []);
			return createElement(
				"div",
				null,
				createElement(
					"button",
					{
						type: "button",
						"data-testid": "mock-edit",
						onClick: () => {
							mocks.canvasElements = [
								{ id: "element-edit", type: "rectangle", x: 20 },
							];
							mocks.onChange?.(
								mocks.canvasElements,
								{ viewBackgroundColor: "#fff" },
								mocks.canvasFiles,
							);
						},
					},
					"Edit",
				),
				props.children,
			);
		},
		loadFromBlob: mocks.loadFromBlob,
		serializeAsJSON: mocks.serializeAsJSON,
	};
});

const app = await loadPluginApp(() => import("./app"));
const { isAllowedExternalLink } = await import("./app");

function resetMockOnChange(): void {
	mocks.onChange = null;
}

const source = {
	kind: "workspace" as const,
	threadId: "thread-1",
	environmentId: "env-1",
	projectId: null,
};
const elements = [{ id: "element-1", type: "rectangle" }];
const files = {
	"file-1": { id: "file-1", dataURL: "data:image/png;base64,AA==" },
};
const scene = { elements, appState: { viewBackgroundColor: "#fff" }, files };
const serializedScene = JSON.stringify(scene);
const sourceKey = "workspace:env-1";
const baseSha = "a".repeat(64);
const savedSha = "b".repeat(64);
const coordinatorKey = `${sourceKey}:drawing.excalidraw`;
const actionCoordinatorKey = `${sourceKey}:AI+MAN.excalidraw`;
let unmountRendered: (() => void) | null = null;

afterEach(() => {
	unmountRendered?.();
	unmountRendered = null;
	clearSaveCoordinator(coordinatorKey);
	clearSaveCoordinator(actionCoordinatorKey);
	mocks.api?.updateScene.mockClear();
	mocks.api?.addFiles.mockClear();
	mocks.api?.history.clear.mockClear();
	mocks.canvasElements = [];
	mocks.canvasAppState = {};
	mocks.canvasFiles = {};
	mocks.theme = null;
	mocks.themePreference = null;
	mocks.onThemeSelect = null;
	window.localStorage.removeItem("bb.excalidraw.theme");
	document.documentElement.classList.remove("dark");
});

type SaveHandler = (input: unknown) => Promise<{
	status: "written";
	sha256: string;
	sizeBytes: number;
}>;

type ReadHandler = () => Promise<{
	status: "ready";
	path: string;
	content: string;
	contentEncoding: "utf8";
	sizeBytes: number;
	sha256: string;
	sourceKey: string | null;
	writable: boolean;
}>;

type ListHandler = () => Promise<{
	status: "ready";
	paths: string[];
	truncated: boolean;
}>;

const defaultReadScene: ReadHandler = async () => ({
	status: "ready",
	path: "drawing.excalidraw",
	content: serializedScene,
	contentEncoding: "utf8",
	sizeBytes: serializedScene.length,
	sha256: baseSha,
	sourceKey,
	writable: true,
});

function rpcHandlers(
	saveScene: SaveHandler,
	readScene: ReadHandler = defaultReadScene,
	listScenes: ListHandler = async () => ({
		status: "ready",
		paths: ["AI+MAN.excalidraw"],
		truncated: false,
	}),
) {
	return {
		readScene,
		saveScene: async (input: unknown) => saveScene(input),
		listScenes,
		ping: async () => ({ ok: true as const }),
	};
}

describe("Excalidraw app registration", () => {
	it("enforces the link denial matrix", () => {
		for (const href of [
			"javascript:alert(1)",
			"data:text/html,owned",
			"file:///tmp/a",
			"mailto:a@b.test",
			"custom:value",
			"not a url",
		]) {
			expect(isAllowedExternalLink(href)).toBe(false);
		}
		for (const href of ["http://example.com/a", "https://example.com/a"]) {
			expect(isAllowedExternalLink(href)).toBe(true);
		}
	});

	it("registers the Excalidraw launcher and file opener", () => {
		expect(app.threadPanelActions).toHaveLength(1);
		expect(app.threadPanelActions[0]).toMatchObject({
			id: "excalidraw",
			title: "Excalidraw",
			layout: "flush",
		});
		expect(app.fileOpeners).toHaveLength(1);
		expect(app.fileOpeners[0]).toMatchObject({
			id: "excalidraw",
			title: "Excalidraw",
			extensions: ["excalidraw"],
		});
	});

	it("opens the only workspace drawing from the panel launcher", async () => {
		mocks.loadFromBlob.mockResolvedValue(scene);
		mocks.serializeAsJSON.mockReturnValue(serializedScene);
		const saveScene = vi.fn<SaveHandler>(async () => ({
			status: "written",
			sha256: savedSha,
			sizeBytes: serializedScene.length,
		}));
		const readScene = vi.fn<ReadHandler>(async () => ({
			...(await defaultReadScene()),
			path: "AI+MAN.excalidraw",
		}));
		const listScenes = vi.fn<ListHandler>(async () => ({
			status: "ready",
			paths: ["AI+MAN.excalidraw"],
			truncated: false,
		}));
		const rendered = renderSlot(
			app.threadPanelActions[0],
			{ threadId: "thread-1", params: null },
			{ rpc: rpcHandlers(saveScene, readScene, listScenes) },
		);
		unmountRendered = rendered.unmount;

		await rendered.findByTestId("mock-edit");
		expect(listScenes).toHaveBeenCalledOnce();
		expect(rendered.inspection.rpcCalls[0]).toMatchObject({
			method: "listScenes",
			input: { threadId: "thread-1" },
		});
		expect(readScene).toHaveBeenCalledOnce();
	});

	it("loads through the RPC and ignores viewport-only changes", async () => {
		mocks.loadFromBlob.mockResolvedValue(scene);
		mocks.serializeAsJSON.mockImplementation(
			(nextElements, nextAppState, nextFiles) =>
				JSON.stringify({
					elements: nextElements,
					appState: { viewBackgroundColor: nextAppState.viewBackgroundColor },
					files: nextFiles,
				}),
		);
		const saveScene = vi.fn<SaveHandler>(async (_input) => ({
			status: "written",
			sha256: "saved-sha",
			sizeBytes: serializedScene.length,
		}));
		const rendered = renderSlot(
			app.fileOpeners[0],
			{ path: "drawing.excalidraw", source },
			{ rpc: rpcHandlers(saveScene) },
		);

		unmountRendered = rendered.unmount;
		await rendered.findByTestId("mock-edit");
		expect(rendered.inspection.rpcCalls[0]?.method).toBe("readScene");
		expect(mocks.validateEmbeddable).toBe(false);
		expect(mocks.onLinkOpen).not.toBeNull();
		expect(rendered.queryByTestId("excalidraw-file-status")).toBeNull();
		expect(mocks.onChange).not.toBeNull();
		mocks.onChange?.(
			elements,
			{ viewBackgroundColor: "#fff", scrollX: 400 },
			files,
		);
		expect(rendered.queryByTestId("excalidraw-file-status")).toBeNull();
		expect(saveScene).not.toHaveBeenCalled();
	});

	it("offers the original light, dark, and system theme setting", async () => {
		document.documentElement.classList.add("dark");
		window.localStorage.setItem("bb.excalidraw.theme", "system");
		mocks.loadFromBlob.mockResolvedValue(scene);
		mocks.serializeAsJSON.mockReturnValue(serializedScene);
		const saveScene = vi.fn<SaveHandler>(async () => ({
			status: "written",
			sha256: savedSha,
			sizeBytes: serializedScene.length,
		}));
		const rendered = renderSlot(
			app.fileOpeners[0],
			{ path: "drawing.excalidraw", source },
			{ rpc: rpcHandlers(saveScene) },
		);
		unmountRendered = rendered.unmount;

		await rendered.findByTestId("mock-theme-setting");
		expect(mocks.themePreference).toBe("system");
		expect(mocks.theme).toBe("dark");

		act(() => mocks.onThemeSelect?.("light"));
		await vi.waitFor(() => expect(mocks.theme).toBe("light"));
		expect(window.localStorage.getItem("bb.excalidraw.theme")).toBe("light");

		act(() => mocks.onThemeSelect?.("system"));
		await vi.waitFor(() => expect(mocks.theme).toBe("dark"));
		act(() => document.documentElement.classList.remove("dark"));
		await vi.waitFor(() => expect(mocks.theme).toBe("light"));
		expect(saveScene).not.toHaveBeenCalled();
	});

	it("saves a durable edit through Mod+S", async () => {
		mocks.loadFromBlob.mockResolvedValue(scene);
		mocks.serializeAsJSON.mockImplementation(
			(nextElements, nextAppState, nextFiles) =>
				JSON.stringify({
					elements: nextElements,
					appState: { viewBackgroundColor: nextAppState.viewBackgroundColor },
					files: nextFiles,
				}),
		);
		const saveScene = vi.fn<SaveHandler>(async (_input) => ({
			status: "written",
			sha256: "saved-sha",
			sizeBytes: serializedScene.length,
		}));
		resetMockOnChange();
		const rendered = renderSlot(
			app.fileOpeners[0],
			{ path: "drawing.excalidraw", source },
			{ rpc: rpcHandlers(saveScene) },
		);
		unmountRendered = rendered.unmount;
		await rendered.findByTestId("mock-edit");
		expect(mocks.onChange).not.toBeNull();
		mocks.onChange?.([{ ...elements[0], x: 20 }], scene.appState, files);
		await rendered.findByRole("button", { name: "Save" });
		expect(
			rendered.getByTestId("excalidraw-file-status").getAttribute("aria-live"),
		).toBe("polite");
		document.dispatchEvent(
			new KeyboardEvent("keydown", { key: "s", metaKey: true, bubbles: true }),
		);
		await vi.waitFor(() => expect(saveScene).toHaveBeenCalledOnce());
		expect(saveScene.mock.calls[0]?.[0]).toMatchObject({
			expectedSha256: baseSha,
			writerNonce: expect.any(String),
		});
		expect(
			(saveScene.mock.calls[0]?.[0] as { writerNonce: string }).writerNonce,
		).not.toHaveLength(0);
	});

	it("flushes pointerup and blur through the opener lifecycle", async () => {
		mocks.loadFromBlob.mockResolvedValue(scene);
		mocks.serializeAsJSON.mockImplementation(
			(nextElements, nextAppState, nextFiles) =>
				JSON.stringify({
					elements: nextElements,
					appState: { viewBackgroundColor: nextAppState.viewBackgroundColor },
					files: nextFiles,
				}),
		);
		const saveScene = vi.fn<SaveHandler>(async (_input) => ({
			status: "written",
			sha256: "saved-sha",
			sizeBytes: serializedScene.length,
		}));
		resetMockOnChange();
		const rendered = renderSlot(
			app.fileOpeners[0],
			{ path: "drawing.excalidraw", source },
			{ rpc: rpcHandlers(saveScene) },
		);
		unmountRendered = rendered.unmount;
		await rendered.findByTestId("mock-edit");
		mocks.onChange?.([{ ...elements[0], x: 30 }], scene.appState, files);
		rendered
			.getByTestId("excalidraw-plugin-mount")
			.dispatchEvent(new Event("pointerup", { bubbles: true }));
		await vi.waitFor(() => expect(saveScene).toHaveBeenCalledOnce());
		mocks.onChange?.([{ ...elements[0], x: 40 }], scene.appState, files);
		rendered
			.getByTestId("excalidraw-plugin-mount")
			.dispatchEvent(new Event("blur"));
		await vi.waitFor(() => expect(saveScene).toHaveBeenCalledTimes(2));
		const firstNonce = (saveScene.mock.calls[0]?.[0] as { writerNonce: string })
			.writerNonce;
		expect(saveScene.mock.calls[1]?.[0]).toMatchObject({
			writerNonce: firstNonce,
		});
	});

	it("flushes the exact dirty draft when the opener unmounts immediately", async () => {
		mocks.loadFromBlob.mockResolvedValue(scene);
		mocks.serializeAsJSON.mockImplementation(
			(nextElements, nextAppState, nextFiles) =>
				JSON.stringify({
					elements: nextElements,
					appState: { viewBackgroundColor: nextAppState.viewBackgroundColor },
					files: nextFiles,
				}),
		);
		const saveScene = vi.fn<SaveHandler>(async (_input) => ({
			status: "written",
			sha256: "saved-sha",
			sizeBytes: serializedScene.length,
		}));
		resetMockOnChange();
		const rendered = renderSlot(
			app.fileOpeners[0],
			{ path: "drawing.excalidraw", source },
			{ rpc: rpcHandlers(saveScene) },
		);
		await rendered.findByTestId("mock-edit");
		const draft = [{ ...elements[0], x: 99 }];
		mocks.onChange?.(draft, scene.appState, files);
		rendered.unmount();
		unmountRendered = null;
		await vi.waitFor(() => expect(saveScene).toHaveBeenCalledOnce());
		const expectedContent = JSON.stringify({
			elements: draft,
			appState: scene.appState,
			files,
		});
		expect(saveScene.mock.calls[0]?.[0]).toMatchObject({
			expectedSha256: baseSha,
			content: expectedContent,
		});
	});

	it("ignores malformed, mismatched, duplicate, and self realtime events", async () => {
		mocks.loadFromBlob.mockResolvedValue(scene);
		mocks.serializeAsJSON.mockImplementation(
			(nextElements, nextAppState, nextFiles) =>
				JSON.stringify({
					elements: nextElements,
					appState: { viewBackgroundColor: nextAppState.viewBackgroundColor },
					files: nextFiles,
				}),
		);
		const saveScene = vi.fn<SaveHandler>(async () => ({
			status: "written",
			sha256: savedSha,
			sizeBytes: serializedScene.length,
		}));
		const readScene = vi.fn<ReadHandler>(defaultReadScene);
		const rendered = renderSlot(
			app.fileOpeners[0],
			{ path: "drawing.excalidraw", source },
			{ rpc: rpcHandlers(saveScene, readScene) },
		);
		unmountRendered = rendered.unmount;
		await rendered.findByTestId("mock-edit");
		mocks.onChange?.([{ ...elements[0], x: 20 }], scene.appState, files);
		document.dispatchEvent(
			new KeyboardEvent("keydown", { key: "s", metaKey: true, bubbles: true }),
		);
		await vi.waitFor(() => expect(saveScene).toHaveBeenCalledOnce());
		const writerNonce = (
			saveScene.mock.calls[0]?.[0] as { writerNonce: string }
		).writerNonce;
		const foreignSha = "c".repeat(64);

		await rendered.behavior.emitRealtime(EXCALIDRAW_INVALIDATION_CHANNEL, {
			sourceKey,
			path: "drawing.excalidraw",
			sha256: foreignSha,
			writerNonce: "foreign",
			content: "forbidden",
		});
		await rendered.behavior.emitRealtime(EXCALIDRAW_INVALIDATION_CHANNEL, {
			sourceKey: "workspace:env-2",
			path: "drawing.excalidraw",
			sha256: foreignSha,
			writerNonce: "foreign",
		});
		await rendered.behavior.emitRealtime(EXCALIDRAW_INVALIDATION_CHANNEL, {
			sourceKey,
			path: "other.excalidraw",
			sha256: foreignSha,
			writerNonce: "foreign",
		});
		await rendered.behavior.emitRealtime(EXCALIDRAW_INVALIDATION_CHANNEL, {
			sourceKey,
			path: "drawing.excalidraw",
			sha256: foreignSha,
			writerNonce,
		});
		await rendered.behavior.emitRealtime(EXCALIDRAW_INVALIDATION_CHANNEL, {
			sourceKey,
			path: "drawing.excalidraw",
			sha256: savedSha,
			writerNonce: "foreign",
		});

		expect(readScene).toHaveBeenCalledOnce();
	});

	it("syncs clean external scenes into the canvas and reloads conflicts without stale saves", async () => {
		const externalScene = {
			...scene,
			elements: [{ id: "external", type: "rectangle", x: 50 }],
		};
		const externalContent = JSON.stringify(externalScene);
		const externalSha = "c".repeat(64);
		const externalRead = {
			status: "ready" as const,
			path: "drawing.excalidraw",
			content: externalContent,
			contentEncoding: "utf8" as const,
			sizeBytes: externalContent.length,
			sha256: externalSha,
			sourceKey,
			writable: true,
		};
		const readScene = vi
			.fn<ReadHandler>()
			.mockResolvedValueOnce(await defaultReadScene())
			.mockResolvedValue(externalRead);
		mocks.loadFromBlob
			.mockResolvedValueOnce(scene)
			.mockResolvedValue(externalScene);
		mocks.serializeAsJSON.mockImplementation(
			(nextElements, appState, nextFiles) =>
				JSON.stringify({ elements: nextElements, appState, files: nextFiles }),
		);
		const saveScene = vi.fn<SaveHandler>(async () => ({
			status: "written",
			sha256: savedSha,
			sizeBytes: serializedScene.length,
		}));
		const rendered = renderSlot(
			app.fileOpeners[0],
			{ path: "drawing.excalidraw", source },
			{ rpc: rpcHandlers(saveScene, readScene) },
		);
		unmountRendered = rendered.unmount;
		await rendered.findByTestId("mock-edit");

		await rendered.behavior.emitRealtime(EXCALIDRAW_INVALIDATION_CHANNEL, {
			sourceKey,
			path: "drawing.excalidraw",
			sha256: externalSha,
			writerNonce: "foreign",
		});
		await vi.waitFor(() => expect(readScene).toHaveBeenCalledTimes(2));
		await vi.waitFor(() =>
			expect(mocks.canvasElements).toEqual(externalScene.elements),
		);
		expect(mocks.api?.history.clear).toHaveBeenCalled();
		rendered
			.getByTestId("excalidraw-plugin-mount")
			.dispatchEvent(new Event("pointerup", { bubbles: true }));
		rendered
			.getByTestId("excalidraw-plugin-mount")
			.dispatchEvent(new Event("blur", { bubbles: true }));
		await new Promise((resolve) => setTimeout(resolve, 750));
		expect(saveScene).not.toHaveBeenCalled();

		const draft = [{ id: "local-draft", type: "rectangle", x: 99 }];
		mocks.canvasElements = draft;
		mocks.onChange?.(draft, scene.appState, files);
		await rendered.behavior.emitRealtime(EXCALIDRAW_INVALIDATION_CHANNEL, {
			sourceKey,
			path: "drawing.excalidraw",
			sha256: "d".repeat(64),
			writerNonce: "foreign-2",
		});
		await rendered.findByRole("button", { name: "Reload" });
		expect(rendered.queryByRole("button", { name: "Overwrite" })).toBeNull();
		expect(mocks.canvasElements).toEqual(draft);
		expect(readScene).toHaveBeenCalledTimes(2);
		expect(saveScene).not.toHaveBeenCalled();

		rendered.getByRole("button", { name: "Reload" }).click();
		await vi.waitFor(() => expect(readScene).toHaveBeenCalledTimes(3));
		await vi.waitFor(() =>
			expect(mocks.canvasElements).toEqual(externalScene.elements),
		);
		rendered
			.getByTestId("excalidraw-plugin-mount")
			.dispatchEvent(new Event("pointerup", { bubbles: true }));
		rendered
			.getByTestId("excalidraw-plugin-mount")
			.dispatchEvent(new Event("blur", { bubbles: true }));
		await new Promise((resolve) => setTimeout(resolve, 750));
		expect(saveScene).not.toHaveBeenCalled();
	});

	it("reopens from the current file instead of a released cached coordinator", async () => {
		const externalScene = {
			...scene,
			elements: [{ id: "external-reopen", type: "rectangle", x: 70 }],
		};
		const externalContent = JSON.stringify(externalScene);
		const externalSha = "e".repeat(64);
		const readScene = vi
			.fn<ReadHandler>()
			.mockResolvedValueOnce(await defaultReadScene())
			.mockResolvedValue({
				status: "ready",
				path: "drawing.excalidraw",
				content: externalContent,
				contentEncoding: "utf8",
				sizeBytes: externalContent.length,
				sha256: externalSha,
				sourceKey,
				writable: true,
			});
		mocks.loadFromBlob
			.mockResolvedValueOnce(scene)
			.mockResolvedValue(externalScene);
		mocks.serializeAsJSON.mockImplementation(
			(nextElements, appState, nextFiles) =>
				JSON.stringify({ elements: nextElements, appState, files: nextFiles }),
		);
		const saveScene = vi.fn<SaveHandler>(async () => ({
			status: "written",
			sha256: savedSha,
			sizeBytes: externalContent.length,
		}));
		const first = renderSlot(
			app.fileOpeners[0],
			{ path: "drawing.excalidraw", source },
			{ rpc: rpcHandlers(saveScene, readScene) },
		);
		await first.findByTestId("mock-edit");
		await first.behavior.emitRealtime(EXCALIDRAW_INVALIDATION_CHANNEL, {
			sourceKey,
			path: "drawing.excalidraw",
			sha256: externalSha,
			writerNonce: "foreign",
		});
		await vi.waitFor(() =>
			expect(mocks.canvasElements).toEqual(externalScene.elements),
		);
		first.unmount();

		const second = renderSlot(
			app.fileOpeners[0],
			{ path: "drawing.excalidraw", source },
			{ rpc: rpcHandlers(saveScene, readScene) },
		);
		unmountRendered = second.unmount;
		await second.findByTestId("mock-edit");
		await vi.waitFor(() => expect(readScene).toHaveBeenCalledTimes(3));
		expect(mocks.canvasElements).toEqual(externalScene.elements);
		expect(saveScene).not.toHaveBeenCalled();
	});

	it("reconciles once after reconnect and lets a newer response beat a late read", async () => {
		const staleScene = {
			...scene,
			elements: [{ id: "stale", type: "rectangle" }],
		};
		const newerScene = {
			...scene,
			elements: [{ id: "newer", type: "rectangle" }],
		};
		let resolveStale:
			| ((result: Awaited<ReturnType<ReadHandler>>) => void)
			| undefined;
		let call = 0;
		const readScene = vi.fn<ReadHandler>(async () => {
			call += 1;
			if (call === 1) return defaultReadScene();
			if (call === 2) {
				return new Promise((resolve) => {
					resolveStale = resolve;
				});
			}
			const content = JSON.stringify(newerScene);
			return {
				status: "ready",
				path: "drawing.excalidraw",
				content,
				contentEncoding: "utf8",
				sizeBytes: content.length,
				sha256: "d".repeat(64),
				sourceKey,
				writable: true,
			};
		});
		mocks.loadFromBlob
			.mockResolvedValueOnce(scene)
			.mockResolvedValueOnce(newerScene)
			.mockResolvedValueOnce(staleScene);
		mocks.serializeAsJSON.mockImplementation(
			(nextElements, appState, nextFiles) =>
				JSON.stringify({ elements: nextElements, appState, files: nextFiles }),
		);
		const saveScene = vi.fn<SaveHandler>(async () => ({
			status: "written",
			sha256: savedSha,
			sizeBytes: serializedScene.length,
		}));
		const rendered = renderSlot(
			app.fileOpeners[0],
			{ path: "drawing.excalidraw", source },
			{
				rpc: rpcHandlers(saveScene, readScene),
				realtimeConnectionState: "connected",
			},
		);
		unmountRendered = rendered.unmount;
		await rendered.findByTestId("mock-edit");
		await rendered.behavior.setRealtimeConnectionState("reconnecting");
		await rendered.behavior.setRealtimeConnectionState("connected");
		await vi.waitFor(() => expect(readScene).toHaveBeenCalledTimes(2));
		await rendered.behavior.emitRealtime(EXCALIDRAW_INVALIDATION_CHANNEL, {
			sourceKey,
			path: "drawing.excalidraw",
			sha256: "d".repeat(64),
			writerNonce: "foreign",
		});
		await vi.waitFor(() => expect(readScene).toHaveBeenCalledTimes(3));
		await vi.waitFor(() =>
			expect(mocks.initialData?.elements).toEqual(newerScene.elements),
		);

		const staleContent = JSON.stringify(staleScene);
		resolveStale?.({
			status: "ready",
			path: "drawing.excalidraw",
			content: staleContent,
			contentEncoding: "utf8",
			sizeBytes: staleContent.length,
			sha256: "c".repeat(64),
			sourceKey,
			writable: true,
		});
		await Promise.resolve();
		expect(mocks.initialData?.elements).toEqual(newerScene.elements);
	});
});
