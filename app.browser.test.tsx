import axe from "axe-core";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

const browserSceneContent = JSON.stringify({
	type: "excalidraw",
	version: 2,
	source: "browser-test",
	elements: [],
	appState: { viewBackgroundColor: "#fff" },
	files: {},
});
const browserReadSceneResult = {
	status: "ready" as const,
	path: "browser.excalidraw",
	content: browserSceneContent,
	contentEncoding: "utf8" as const,
	sizeBytes: browserSceneContent.length,
	sha256: "browser-sha",
	writable: true,
};
let readScenePromise: Promise<void>;
let resolveReadScene: (() => void) | undefined;

vi.mock("@bb/plugin-sdk/app", () => {
	const app = {
		fileOpeners: [] as Array<Record<string, unknown>>,
		slots: {
			fileOpener(config: Record<string, unknown>) {
				app.fileOpeners.push(config);
			},
		},
	};
	return {
		definePluginApp(register: (value: typeof app) => void) {
			register(app);
			return app;
		},
		useRealtime() {},
		useRealtimeConnectionState() {
			return "connected" as const;
		},
		useRpc() {
			return {
				call: async (method: string) => {
					if (method === "readScene") {
						await readScenePromise;
						return browserReadSceneResult;
					}
					return {
						status: "written" as const,
						sha256: "browser-saved-sha",
						sizeBytes: browserSceneContent.length,
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

const source = {
	kind: "workspace" as const,
	threadId: "browser-thread",
	environmentId: "browser-env",
	projectId: null,
};

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
		expect(
			mount.querySelector('[role="status"]')?.getAttribute("aria-live"),
		).toBe("polite");
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
});
