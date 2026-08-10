import { z } from "zod";

export const EXCALIDRAW_INVALIDATION_CHANNEL =
	"excalidraw-scene-invalidated" as const;

const canonicalWorkspaceSourceKeySchema = z
	.string()
	.regex(/^workspace:[^\s]+$/);

const normalizedWorkspaceRelativePathSchema = z
	.string()
	.min(1)
	.superRefine((value, context) => {
		if (
			value.startsWith("/") ||
			/^[A-Za-z]:\//.test(value) ||
			value.includes("\\") ||
			value
				.split("/")
				.some(
					(segment) => segment === "" || segment === "." || segment === "..",
				)
		) {
			context.addIssue({
				code: "custom",
				message: "path must be a normalized workspace-relative POSIX path",
			});
		}
	});

export const excalidrawInvalidationPayloadSchema = z
	.object({
		sourceKey: canonicalWorkspaceSourceKeySchema,
		path: normalizedWorkspaceRelativePathSchema,
		sha256: z.string().regex(/^[0-9a-f]{64}$/),
		writerNonce: z.string().min(1),
	})
	.strict();

export type ExcalidrawInvalidationPayload = z.infer<
	typeof excalidrawInvalidationPayloadSchema
>;

export function workspaceSourceKey(environmentId: string): string {
	const canonicalEnvironmentId = z.string().trim().min(1).parse(environmentId);
	return canonicalWorkspaceSourceKeySchema.parse(
		`workspace:${canonicalEnvironmentId}`,
	);
}

export type ExcalidrawInvalidationLocalState = {
	sourceKey: string;
	path: string;
	writerNonce: string;
	sha256: string;
	isDirty: boolean;
};

export type ExcalidrawInvalidationDecision =
	| {
			action: "ignore";
			reason: "different-source" | "different-path" | "self" | "current";
	  }
	| { action: "reconcile" }
	| { action: "conflict"; conflictSha256: string };

export function decideExcalidrawInvalidation(
	local: ExcalidrawInvalidationLocalState,
	event: ExcalidrawInvalidationPayload,
): ExcalidrawInvalidationDecision {
	if (event.sourceKey !== local.sourceKey) {
		return { action: "ignore", reason: "different-source" };
	}
	if (event.path !== local.path) {
		return { action: "ignore", reason: "different-path" };
	}
	if (event.writerNonce === local.writerNonce) {
		return { action: "ignore", reason: "self" };
	}
	if (event.sha256 === local.sha256) {
		return { action: "ignore", reason: "current" };
	}
	if (local.isDirty) {
		return { action: "conflict", conflictSha256: event.sha256 };
	}
	return { action: "reconcile" };
}

export type ExcalidrawReconciliationDecision =
	| { action: "ignore" }
	| { action: "reload" }
	| { action: "conflict"; conflictSha256: string };

export function decideExcalidrawReconciliation(
	local: { sha256: string; isDirty: boolean },
	observedSha256: string,
): ExcalidrawReconciliationDecision {
	if (observedSha256 === local.sha256) return { action: "ignore" };
	if (local.isDirty) {
		return { action: "conflict", conflictSha256: observedSha256 };
	}
	return { action: "reload" };
}

export type ExcalidrawRealtimeConnectionState =
	| "connecting"
	| "connected"
	| "reconnecting";

export function shouldReconcileAfterReconnect(
	previous: ExcalidrawRealtimeConnectionState,
	next: ExcalidrawRealtimeConnectionState,
): boolean {
	return previous === "reconnecting" && next === "connected";
}
