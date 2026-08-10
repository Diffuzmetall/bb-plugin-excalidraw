import { describe, expect, it } from "vitest";
import {
	EXCALIDRAW_INVALIDATION_CHANNEL,
	decideExcalidrawInvalidation,
	decideExcalidrawReconciliation,
	excalidrawInvalidationPayloadSchema,
	shouldReconcileAfterReconnect,
	workspaceSourceKey,
	type ExcalidrawInvalidationLocalState,
	type ExcalidrawInvalidationPayload,
} from "./realtime-invalidation";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const SHA_C = "c".repeat(64);

function payload(
	overrides: Partial<ExcalidrawInvalidationPayload> = {},
): ExcalidrawInvalidationPayload {
	return {
		sourceKey: workspaceSourceKey("env-a"),
		path: "diagrams/flow.excalidraw",
		sha256: SHA_B,
		writerNonce: "foreign-writer",
		...overrides,
	};
}

function local(
	overrides: Partial<ExcalidrawInvalidationLocalState> = {},
): ExcalidrawInvalidationLocalState {
	return {
		sourceKey: workspaceSourceKey("env-a"),
		path: "diagrams/flow.excalidraw",
		sha256: SHA_A,
		writerNonce: "local-writer",
		isDirty: false,
		...overrides,
	};
}

describe("Excalidraw realtime invalidation contract", () => {
	it("exports one canonical channel and strict metadata-only payload schema", () => {
		expect(EXCALIDRAW_INVALIDATION_CHANNEL).toBe(
			"excalidraw-scene-invalidated",
		);
		expect(excalidrawInvalidationPayloadSchema.parse(payload())).toEqual(
			payload(),
		);
		expect(() =>
			excalidrawInvalidationPayloadSchema.parse({
				...payload(),
				sha256: "not-a-sha",
			}),
		).toThrow();
	});

	it.each([
		"/absolute/scene.excalidraw",
		"C:/absolute/scene.excalidraw",
		"../scene.excalidraw",
		"diagrams/../scene.excalidraw",
		"./scene.excalidraw",
		"diagrams//scene.excalidraw",
		"diagrams\\scene.excalidraw",
	])("rejects non-normalized or non-relative event path %s", (path) => {
		expect(() =>
			excalidrawInvalidationPayloadSchema.parse(payload({ path })),
		).toThrow();
	});

	it.each([
		["raw", "raw scene bytes"],
		["content", "scene bytes"],
		["dataURL", "data:image/png;base64,AA=="],
		["files", { image: "data:image/png;base64,AA==" }],
		["base64", "AA=="],
		["hostId", "host-1"],
		["rootPath", "/workspace"],
		["source", { kind: "workspace", environmentId: "env-a" }],
	] as const)("rejects forbidden extra field %s", (field, value) => {
		expect(() =>
			excalidrawInvalidationPayloadSchema.parse({
				...payload(),
				[field]: value,
			}),
		).toThrow();
	});

	it("requires canonical workspace source identity", () => {
		for (const sourceKey of [
			"workspace:",
			"workspace:env a",
			"host:host-1",
			"thread:thread-1",
			"env-a",
		]) {
			expect(() =>
				excalidrawInvalidationPayloadSchema.parse(payload({ sourceKey })),
			).toThrow();
		}
	});

	it("derives distinct workspace source keys and rejects empty authority", () => {
		expect(workspaceSourceKey("env-a")).toBe("workspace:env-a");
		expect(workspaceSourceKey("env-b")).toBe("workspace:env-b");
		expect(workspaceSourceKey(" env-a ")).toBe("workspace:env-a");
		expect(() => workspaceSourceKey("")).toThrow();
		expect(() => workspaceSourceKey("   ")).toThrow();
	});
});

describe("pure invalidation transitions", () => {
	it("ignores self events without considering their SHA", () => {
		expect(
			decideExcalidrawInvalidation(
				local(),
				payload({ writerNonce: "local-writer" }),
			),
		).toEqual({ action: "ignore", reason: "self" });
	});

	it("isolates the same relative path across authoritative environments", () => {
		expect(
			decideExcalidrawInvalidation(
				local(),
				payload({ sourceKey: workspaceSourceKey("env-b") }),
			),
		).toEqual({ action: "ignore", reason: "different-source" });
		expect(
			decideExcalidrawInvalidation(
				local(),
				payload({ path: "diagrams/other.excalidraw" }),
			),
		).toEqual({ action: "ignore", reason: "different-path" });
	});

	it("reconciles clean foreign changes and conflicts dirty drafts", () => {
		expect(decideExcalidrawInvalidation(local(), payload())).toEqual({
			action: "reconcile",
		});
		expect(
			decideExcalidrawInvalidation(local({ isDirty: true }), payload()),
		).toEqual({ action: "conflict", conflictSha256: SHA_B });
	});

	it("makes duplicate and reordered invalidations idempotent after canonical reread", () => {
		expect(
			decideExcalidrawInvalidation(
				local({ sha256: SHA_C }),
				payload({ sha256: SHA_C }),
			),
		).toEqual({ action: "ignore", reason: "current" });

		// A late older event cannot be ordered from opaque SHA metadata. It asks
		// for a canonical reread, whose current SHA prevents rollback.
		expect(
			decideExcalidrawInvalidation(
				local({ sha256: SHA_C }),
				payload({ sha256: SHA_B }),
			),
		).toEqual({ action: "reconcile" });
		expect(
			decideExcalidrawReconciliation({ sha256: SHA_C, isDirty: false }, SHA_C),
		).toEqual({ action: "ignore" });
	});

	it("reloads only clean canonical changes and never replaces dirty drafts", () => {
		expect(
			decideExcalidrawReconciliation({ sha256: SHA_A, isDirty: false }, SHA_B),
		).toEqual({ action: "reload" });
		expect(
			decideExcalidrawReconciliation({ sha256: SHA_A, isDirty: true }, SHA_B),
		).toEqual({ action: "conflict", conflictSha256: SHA_B });
	});

	it("reconciles only a subsequent reconnect, not initial connection", () => {
		expect(shouldReconcileAfterReconnect("connecting", "connected")).toBe(
			false,
		);
		expect(shouldReconcileAfterReconnect("connected", "reconnecting")).toBe(
			false,
		);
		expect(shouldReconcileAfterReconnect("reconnecting", "connected")).toBe(
			true,
		);
	});
});
