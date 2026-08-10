import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	acquireSaveCoordinator,
	clearSaveCoordinator,
	createSaveCoordinator,
	type SaveResult,
} from "./save-coordinator";
import type { SceneData } from "./scene-state";

const initialScene = {
	elements: [{ id: "element-1", type: "rectangle" }],
	appState: { viewBackgroundColor: "#fff" },
	files: { "file-1": { id: "file-1", dataURL: "data:image/png;base64,AA==" } },
} satisfies SceneData;

function setup() {
	const write = vi.fn<
		(request: {
			content: string;
			expectedSha256: string;
			writerNonce: string;
		}) => Promise<SaveResult>
	>(async () => ({ status: "written", sha256: "sha-2" }));
	const read = vi.fn(async () => ({ scene: initialScene, sha256: "sha-2" }));
	const coordinator = createSaveCoordinator({
		key: "workspace:drawing.excalidraw",
		initialScene,
		initialSha256: "sha-1",
		serialize: (scene: SceneData) => JSON.stringify(scene),
		write,
		read,
		writerNonce: "writer-1",
	});
	return { coordinator, write, read };
}

describe("save coordinator", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it("debounces durable drafts for 700ms", async () => {
		const { coordinator, write } = setup();
		coordinator.update({
			...initialScene,
			elements: [{ id: "element-2", type: "rectangle" }],
		});
		await vi.advanceTimersByTimeAsync(699);
		expect(write).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		await vi.runOnlyPendingTimersAsync();
		expect(write).toHaveBeenCalledOnce();
	});

	it.each([
		"pointerup",
		"blur",
		"shortcut",
	] as const)("flushes pending drafts on %s", async (reason) => {
		const { coordinator, write } = setup();
		coordinator.update({
			...initialScene,
			elements: [{ id: "element-2", type: "rectangle" }],
		});
		await coordinator.flush(reason);
		expect(write).toHaveBeenCalledOnce();
	});

	it("reuses a coordinator only while at least one consumer is mounted", async () => {
		const first = createSaveCoordinator({
			key: "registry-key",
			initialScene,
			initialSha256: "sha-1",
			serialize: (scene) => JSON.stringify(scene),
			write: async () => ({ status: "written", sha256: "sha-2" }),
			read: async () => ({ scene: initialScene, sha256: "sha-2" }),
		});
		const firstLease = acquireSaveCoordinator("registry-key", () => first);
		const secondLease = acquireSaveCoordinator("registry-key", () =>
			createSaveCoordinator({
				key: "registry-key",
				initialScene,
				initialSha256: "wrong",
				serialize: (scene) => JSON.stringify(scene),
				write: async () => ({ status: "written", sha256: "wrong" }),
				read: async () => ({ scene: initialScene, sha256: "wrong" }),
			}),
		);
		expect(firstLease.coordinator).toBe(first);
		expect(secondLease.coordinator).toBe(first);

		await firstLease.release();
		const stillShared = acquireSaveCoordinator("registry-key", () =>
			createSaveCoordinator({
				key: "registry-key",
				initialScene,
				initialSha256: "wrong-again",
				serialize: (scene) => JSON.stringify(scene),
				write: async () => ({ status: "written", sha256: "wrong-again" }),
				read: async () => ({ scene: initialScene, sha256: "wrong-again" }),
			}),
		);
		expect(stillShared.coordinator).toBe(first);
		await secondLease.release();
		await stillShared.release();

		const replacement = createSaveCoordinator({
			key: "registry-key",
			initialScene,
			initialSha256: "sha-current",
			serialize: (scene) => JSON.stringify(scene),
			write: async () => ({ status: "written", sha256: "sha-current" }),
			read: async () => ({ scene: initialScene, sha256: "sha-current" }),
		});
		const replacementLease = acquireSaveCoordinator(
			"registry-key",
			() => replacement,
		);
		expect(replacementLease.coordinator).toBe(replacement);
		await replacementLease.release();
		clearSaveCoordinator("registry-key");
	});

	it("flushes a pending draft when the tab closes", async () => {
		const { coordinator, write } = setup();
		coordinator.update({
			...initialScene,
			elements: [{ id: "element-2", type: "rectangle" }],
		});
		await coordinator.dispose();
		expect(write).toHaveBeenCalledOnce();
	});

	it("queues a newer draft that arrives during an in-flight write", async () => {
		const { coordinator, write } = setup();
		let resolveFirst: ((result: SaveResult) => void) | undefined;
		write.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					resolveFirst = resolve;
				}),
		);
		const firstDraft = {
			...initialScene,
			elements: [{ id: "element-2", type: "rectangle" }],
		} satisfies SceneData;
		const newestDraft = {
			...initialScene,
			elements: [{ id: "element-3", type: "rectangle" }],
		} satisfies SceneData;
		coordinator.update(firstDraft);
		const firstFlush = coordinator.flush("shortcut");
		coordinator.update(newestDraft);
		resolveFirst?.({ status: "written", sha256: "sha-2" });
		await firstFlush;
		expect(coordinator.getState()).toMatchObject({
			status: "pending",
			scene: newestDraft,
			sha256: "sha-2",
		});
		await vi.runOnlyPendingTimersAsync();
		await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(2));
		expect(write.mock.calls[1]?.[0]).toEqual({
			content: JSON.stringify(newestDraft),
			expectedSha256: "sha-2",
			writerNonce: "writer-1",
		});
	});

	it("retains the exact draft after a stale conflict and never retries", async () => {
		const { coordinator, write } = setup();
		const draft = {
			...initialScene,
			elements: [{ id: "element-2", type: "rectangle" }],
		} satisfies SceneData;
		write.mockResolvedValue({
			status: "conflict",
			currentSha256: "sha-external",
		});
		coordinator.update(draft);
		await coordinator.flush("shortcut");
		await vi.advanceTimersByTimeAsync(2_000);
		expect(write).toHaveBeenCalledOnce();
		expect(coordinator.getState()).toMatchObject({
			status: "conflict",
			scene: draft,
			conflictSha256: "sha-external",
		});
	});

	it("resolves a conflict only by explicitly reloading the external scene", async () => {
		const { coordinator, write, read } = setup();
		const draft = {
			...initialScene,
			elements: [{ id: "element-local", type: "rectangle" }],
		} satisfies SceneData;
		const externalScene = {
			...initialScene,
			elements: [{ id: "element-external", type: "rectangle" }],
		} satisfies SceneData;
		write.mockResolvedValue({
			status: "conflict",
			currentSha256: "sha-external",
		});
		coordinator.update(draft);
		await coordinator.flush("shortcut");
		expect(coordinator.getState()).toMatchObject({
			status: "conflict",
			scene: draft,
			message: "File changed elsewhere; reload to discard local changes",
		});

		read.mockResolvedValue({ scene: externalScene, sha256: "sha-external" });
		await coordinator.reload();
		expect(write).toHaveBeenCalledOnce();
		expect(coordinator.getState()).toMatchObject({
			status: "clean",
			scene: externalScene,
			sha256: "sha-external",
		});
	});

	it("reloads a clean draft after a foreign invalidation", async () => {
		const { coordinator, read } = setup();
		const externalScene = {
			...initialScene,
			elements: [{ id: "element-external", type: "rectangle" }],
		} satisfies SceneData;
		read.mockResolvedValue({ scene: externalScene, sha256: "sha-external" });

		await expect(
			coordinator.handleExternalInvalidation("sha-external"),
		).resolves.toBe("reloaded");
		expect(read).toHaveBeenCalledOnce();
		expect(coordinator.getState()).toMatchObject({
			status: "clean",
			scene: externalScene,
			sha256: "sha-external",
		});
	});

	it("turns a dirty foreign invalidation into conflict without replacing the draft", async () => {
		const { coordinator, read } = setup();
		const draft = {
			...initialScene,
			elements: [{ id: "element-local", type: "rectangle" }],
		} satisfies SceneData;
		coordinator.update(draft);

		await expect(
			coordinator.handleExternalInvalidation("sha-external"),
		).resolves.toBe("conflict");
		expect(read).not.toHaveBeenCalled();
		expect(coordinator.getState()).toMatchObject({
			status: "conflict",
			scene: draft,
			sha256: "sha-1",
			conflictSha256: "sha-external",
		});
	});

	it("reconciles reconnects without replacing a draft edited during the reread", async () => {
		const { coordinator, read } = setup();
		let resolveRead:
			| ((value: Awaited<ReturnType<typeof read>>) => void)
			| undefined;
		read.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					resolveRead = resolve;
				}),
		);
		const reconciliation = coordinator.reconcileExternalChange();
		const draft = {
			...initialScene,
			elements: [{ id: "element-during-read", type: "rectangle" }],
		} satisfies SceneData;
		coordinator.update(draft);
		resolveRead?.({ scene: initialScene, sha256: "sha-external" });

		await expect(reconciliation).resolves.toBe("conflict");
		expect(coordinator.getState()).toMatchObject({
			status: "conflict",
			scene: draft,
			conflictSha256: "sha-external",
		});
	});

	it("ignores reordered reconciliation responses after a newer one wins", async () => {
		const { coordinator, read } = setup();
		let resolveOlder:
			| ((value: Awaited<ReturnType<typeof read>>) => void)
			| undefined;
		let resolveNewer:
			| ((value: Awaited<ReturnType<typeof read>>) => void)
			| undefined;
		read
			.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						resolveOlder = resolve;
					}),
			)
			.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						resolveNewer = resolve;
					}),
			);
		const older = coordinator.reconcileExternalChange();
		const newer = coordinator.reconcileExternalChange();
		const newerScene = {
			...initialScene,
			elements: [{ id: "element-newer", type: "rectangle" }],
		} satisfies SceneData;
		resolveNewer?.({ scene: newerScene, sha256: "sha-newer" });
		await expect(newer).resolves.toBe("reloaded");
		resolveOlder?.({ scene: initialScene, sha256: "sha-older" });
		await expect(older).resolves.toBe("superseded");
		expect(coordinator.getState()).toMatchObject({
			status: "clean",
			scene: newerScene,
			sha256: "sha-newer",
		});
	});
});
