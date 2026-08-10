import axe from "axe-core";
import { act, createElement, useCallback } from "react";
import { createRoot } from "react-dom/client";
import type {
	ExcalidrawImperativeAPI,
	ExcalidrawProps,
} from "@excalidraw/excalidraw/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

const sourceKey = "workspace:browser-env";
const initialSha = "a".repeat(64);
const externalSha = "b".repeat(64);
const conflictSha = "c".repeat(64);

function createBrowserSceneContent(id: string | null, x = 100): string {
	return JSON.stringify({
		type: "excalidraw",
		version: 2,
		source: "browser-test",
		elements:
			id === null
				? []
				: [
						{
							id,
							type: "rectangle",
							x,
							y: 100,
							width: 180,
							height: 90,
							strokeColor: "#1971c2",
							backgroundColor: "#e7f5ff",
						},
					],
		appState: { viewBackgroundColor: "#fff" },
		files: {},
	});
}

function readyScene(content: string, sha256: string) {
	return {
		status: "ready" as const,
		path: "browser.excalidraw",
		content,
		contentEncoding: "utf8" as const,
		sizeBytes: content.length,
		sha256,
		sourceKey,
		writable: true,
	};
}

const browserSceneContent = createBrowserSceneContent(null);
let browserReadSceneResult = readyScene(browserSceneContent, initialSha);
let readScenePromise: Promise<void>;
let resolveReadScene: (() => void) | undefined;
let realtimeHandler: ((payload: object) => void) | null = null;
let browserApi: ExcalidrawImperativeAPI | null = null;
const saveSceneCalls: object[] = [];

vi.mock("@excalidraw/excalidraw", async (importOriginal) => {
	const actual = await importOriginal<
		typeof import("@excalidraw/excalidraw")
	>();
	return {
		...actual,
		Excalidraw: (props: ExcalidrawProps) => {
			const captureApi = useCallback(
				(api: ExcalidrawImperativeAPI) => {
					browserApi = api;
					props.excalidrawAPI?.(api);
				},
				[props.excalidrawAPI],
			);
			return createElement(actual.Excalidraw, {
				...props,
				excalidrawAPI: captureApi,
			});
		},
	};
});

vi.mock("@bb/plugin-sdk/app", () => {
	const app = {
		fileOpeners: [] as Array<Record<string, unknown>>,
		threadPanelActions: [] as Array<Record<string, unknown>>,
		slots: {
			fileOpener(config: Record<string, unknown>) {
				app.fileOpeners.push(config);
			},
			threadPanelAction(config: Record<string, unknown>) {
				app.threadPanelActions.push(config);
			},
		},
	};
	return {
		definePluginApp(register: (value: typeof app) => void) {
			register(app);
			return app;
		},
		useRealtime(_channel: string, handler: (payload: object) => void) {
			realtimeHandler = handler;
		},
		useRealtimeConnectionState() {
			return "connected" as const;
		},
		useRpc() {
			return {
				call: async (method: string, input: object) => {
					if (method === "readScene") {
						await readScenePromise;
						return browserReadSceneResult;
					}
					if (method === "saveScene") {
						saveSceneCalls.push(input);
						return {
							status: "written" as const,
							sha256: "d".repeat(64),
							sizeBytes: browserSceneContent.length,
						};
					}
					return {
						status: "ready" as const,
						paths: ["browser.excalidraw"],
						truncated: false,
					};
				},
			};
		},
	};
});

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const { ExcalidrawFileOpener, handleLinkOpen, isAllowedExternalLink } =
	await import("./app");
const { CaptureUpdateAction } = await import("@excalidraw/excalidraw");

const source = {
	kind: "workspace" as const,
	threadId: "browser-thread",
	environmentId: "browser-env",
	projectId: null,
};

beforeEach(() => {
	browserReadSceneResult = readyScene(browserSceneContent, initialSha);
	readScenePromise = Promise.resolve();
	resolveReadScene = undefined;
	realtimeHandler = null;
	browserApi = null;
	saveSceneCalls.length = 0;
});

describe("Excalidraw opener Chromium gates", () => {
	it("renders live canvas, denies embeds, enforces link policy, focus, and scoped axe", async () => {
		const consoleErrors: unknown[][] = [];
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation((...args) => {
				consoleErrors.push(args);
			});
		readScenePromise = new Promise<void>((resolve) => {
			resolveReadScene = resolve;
		});
		const container = document.createElement("div");
		const hostBefore = document.createElement("button");
		hostBefore.textContent = "Host before";
		document.body.append(hostBefore, container);
		const root = createRoot(container);
		await act(async () => {
			root.render(
				createElement(ExcalidrawFileOpener, {
					path: "browser.excalidraw",
					source,
				}),
			);
			await new Promise((resolve) => setTimeout(resolve, 500));
		});
		if (!resolveReadScene) throw new Error("missing readScene resolver");
		await act(async () => {
			resolveReadScene?.();
			await readScenePromise;
			for (let index = 0; index < 10; index += 1) {
				await Promise.resolve();
			}
			await new Promise((resolve) => setTimeout(resolve, 500));
		});
		await vi.waitFor(async () => {
			await act(async () => {
				await new Promise((resolve) => setTimeout(resolve, 50));
			});
			expect(container.querySelector("canvas")).not.toBeNull();
		});
		await act(async () => {
			for (let index = 0; index < 10; index += 1) {
				await new Promise((resolve) => setTimeout(resolve, 50));
			}
		});
		const mount = container.querySelector<HTMLElement>(
			'[data-testid="excalidraw-plugin-mount"]',
		);
		if (!mount) throw new Error("missing plugin mount");
		expect(mount.getAttribute("data-embeddables")).toBe("disabled");
		expect(mount.querySelector('[role="status"]')).toBeNull();
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
		const blocked = { preventDefault: vi.fn() };
		handleLinkOpen({ link: "javascript:alert(1)" }, blocked);
		expect(blocked.preventDefault).toHaveBeenCalledOnce();
		const open = vi.spyOn(window, "open").mockReturnValue(null);
		const allowed = { preventDefault: vi.fn() };
		handleLinkOpen({ link: "https://example.com/a" }, allowed);
		expect(allowed.preventDefault).toHaveBeenCalledOnce();
		expect(open).toHaveBeenCalledWith(
			"https://example.com/a",
			"_blank",
			"noopener,noreferrer",
		);
		open.mockRestore();
		const savedButton = mount.querySelector<HTMLButtonElement>(
			"button[aria-label]:not([disabled])",
		);
		if (!savedButton) throw new Error("missing named Save control");
		expect(
			savedButton.getAttribute("aria-label") ?? savedButton.textContent,
		).toBeTruthy();
		await act(async () => {
			savedButton.focus();
		});
		expect(mount.contains(document.activeElement)).toBe(true);
		await act(async () => {
			hostBefore.focus();
			await userEvent.tab();
		});
		expect(mount.contains(document.activeElement)).toBe(true);
		let exited = false;
		for (let index = 0; index < 24; index += 1) {
			await act(async () => {
				await userEvent.tab({ shift: true });
			});
			if (!mount.contains(document.activeElement)) {
				exited = true;
				break;
			}
		}
		expect(exited).toBe(true);
		await act(async () => {
			mount.focus();
		});
		expect(document.activeElement).toBe(mount);
		const axeResult = await axe.run(mount);
		expect(
			axeResult.violations.filter((violation) =>
				["serious", "critical"].includes(violation.impact ?? ""),
			),
		).toEqual([]);
		const knownUpstreamComponents = new Set([
			"InitializeApp",
			"Sidebar",
			"_App",
			"In",
			"MainMenu",
			"DefaultSidebarTrigger",
			"null",
			"OverwriteConfirmDialog",
			"ActiveConfirmDialog",
			"Out",
			"DefaultSidebar",
			"LayerUI",
		]);
		const isKnownUpstreamActWarning = (args: unknown[]) => {
			const argsText = args.map((value) => String(value)).join("\n");
			return (
				typeof args[0] === "string" &&
				args[0].startsWith(
					"An update to %s inside a test was not wrapped in act(...)",
				) &&
				typeof args[1] === "string" &&
				knownUpstreamComponents.has(args[1]) &&
				!argsText.includes("ExcalidrawFileOpener") &&
				!argsText.includes("app.tsx")
			);
		};
		console.error(
			"An update to ExcalidrawFileOpener inside a test was not wrapped in act(...).",
			"at ExcalidrawFileOpener (app.tsx:1:1)",
		);
		const injectedAppOwnedWarning = consoleErrors.pop() ?? [];
		expect(isKnownUpstreamActWarning(injectedAppOwnedWarning)).toBe(false);
		const unclassifiedConsoleErrors = consoleErrors.filter(
			(args) => !isKnownUpstreamActWarning(args),
		);
		expect(unclassifiedConsoleErrors).toEqual([]);
		await act(async () => root.unmount());
		container.remove();
		hostBefore.remove();
		consoleError.mockRestore();
	});

	it("applies external scenes to the live canvas without writing stale content", async () => {
		const sceneAContent = createBrowserSceneContent("scene-a", 100);
		const sceneBContent = createBrowserSceneContent("scene-b", 420);
		const sceneCContent = createBrowserSceneContent("scene-c", 760);
		browserReadSceneResult = readyScene(sceneAContent, initialSha);
		const container = document.createElement("div");
		document.body.append(container);
		const root = createRoot(container);
		await act(async () => {
			root.render(
				createElement(ExcalidrawFileOpener, {
					path: "browser.excalidraw",
					source,
				}),
			);
		});
		await vi.waitFor(() => {
			expect(
				browserApi?.getSceneElementsIncludingDeleted()[0]?.id,
			).toBe("scene-a");
		});
		const mount = container.querySelector<HTMLElement>(
			'[data-testid="excalidraw-plugin-mount"]',
		);
		if (!mount || !realtimeHandler) throw new Error("missing mounted editor");

		browserReadSceneResult = readyScene(sceneBContent, externalSha);
		await act(async () => {
			realtimeHandler?.({
				sourceKey,
				path: "browser.excalidraw",
				sha256: externalSha,
				writerNonce: "external-writer",
			});
		});
		await vi.waitFor(() => {
			expect(
				browserApi?.getSceneElementsIncludingDeleted()[0]?.id,
			).toBe("scene-b");
		});
		mount.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
		mount.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
		await new Promise((resolve) => setTimeout(resolve, 850));
		expect(saveSceneCalls).toEqual([]);

		const currentApi = browserApi;
		if (!currentApi) throw new Error("missing Excalidraw API");
		const currentElement = currentApi.getSceneElementsIncludingDeleted()[0];
		if (!currentElement) throw new Error("missing external element");
		await act(async () => {
			currentApi.updateScene({
				elements: [
					{
						...currentElement,
						id: "local-draft",
						x: 560,
						version: currentElement.version + 1,
					},
				],
				captureUpdate: CaptureUpdateAction.IMMEDIATELY,
			});
		});
		await vi.waitFor(() => {
			expect(container.textContent).toContain("Save");
		});

		browserReadSceneResult = readyScene(sceneCContent, conflictSha);
		await act(async () => {
			realtimeHandler?.({
				sourceKey,
				path: "browser.excalidraw",
				sha256: conflictSha,
				writerNonce: "second-external-writer",
			});
		});
		await vi.waitFor(() => {
			expect(container.textContent).toContain("Reload");
		});
		expect(currentApi.getSceneElementsIncludingDeleted()[0]?.id).toBe(
			"local-draft",
		);
		await new Promise((resolve) => setTimeout(resolve, 850));
		expect(saveSceneCalls).toEqual([]);

		const reload = Array.from(container.querySelectorAll("button")).find(
			(button) => button.textContent === "Reload",
		);
		if (!reload) throw new Error("missing Reload button");
		await act(async () => reload.click());
		await vi.waitFor(() => {
			expect(
				browserApi?.getSceneElementsIncludingDeleted()[0]?.id,
			).toBe("scene-c");
		});
		mount.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
		mount.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
		await new Promise((resolve) => setTimeout(resolve, 850));
		expect(saveSceneCalls).toEqual([]);

		await act(async () => root.unmount());
		container.remove();
		browserApi = null;
		const reopenedContainer = document.createElement("div");
		document.body.append(reopenedContainer);
		const reopenedRoot = createRoot(reopenedContainer);
		await act(async () => {
			reopenedRoot.render(
				createElement(ExcalidrawFileOpener, {
					path: "browser.excalidraw",
					source,
				}),
			);
		});
		await vi.waitFor(() => {
			expect(
				browserApi?.getSceneElementsIncludingDeleted()[0]?.id,
			).toBe("scene-c");
		});
		expect(saveSceneCalls).toEqual([]);
		await act(async () => reopenedRoot.unmount());
		reopenedContainer.remove();
	});
});
