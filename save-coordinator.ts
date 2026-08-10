import { decideExcalidrawReconciliation } from "./realtime-invalidation";
import type { SceneData } from "./scene-state";

export type SaveResult =
	| { status: "written"; sha256: string }
	| { status: "conflict"; currentSha256: string | null }
	| { status: "error"; message: string };

export type SaveRequest = {
	content: string;
	expectedSha256: string;
	writerNonce: string;
};

export type SaveCoordinatorState = {
	scene: SceneData;
	sha256: string;
	status: "clean" | "pending" | "saving" | "conflict" | "error";
	conflictSha256: string | null;
	message: string | null;
};

type SaveCoordinatorOptions = {
	key: string;
	initialScene: SceneData;
	initialSha256: string;
	serialize: (scene: SceneData) => string;
	write: (request: SaveRequest) => Promise<SaveResult>;
	read: () => Promise<{ scene: SceneData; sha256: string }>;
	writerNonce?: string;
	debounceMs?: number;
};

type FlushReason = "debounce" | "pointerup" | "blur" | "shortcut" | "close";
type SaveListener = (state: SaveCoordinatorState) => void;

export type ExternalReconciliationResult =
	| "ignored"
	| "reloaded"
	| "conflict"
	| "superseded";

const coordinators = new Map<string, SaveCoordinator>();

export function createSaveCoordinator(
	options: SaveCoordinatorOptions,
): SaveCoordinator {
	return new SaveCoordinator(options);
}

export function getSaveCoordinator(
	key: string,
	create: () => SaveCoordinator,
): SaveCoordinator {
	const existing = coordinators.get(key);
	if (existing) return existing;
	const coordinator = create();
	coordinators.set(key, coordinator);
	return coordinator;
}

export function clearSaveCoordinator(key: string): void {
	coordinators.delete(key);
}

export class SaveCoordinator {
	private readonly options: SaveCoordinatorOptions;
	private readonly listeners = new Set<SaveListener>();
	private baseSerialized: string;
	private state: SaveCoordinatorState;
	private timer: ReturnType<typeof setTimeout> | null = null;
	private saving = false;
	private reconciliationGeneration = 0;
	private readonly writerNonce: string;

	public constructor(options: SaveCoordinatorOptions) {
		this.options = options;
		this.writerNonce = options.writerNonce ?? globalThis.crypto.randomUUID();
		this.baseSerialized = options.serialize(options.initialScene);
		this.state = {
			scene: options.initialScene,
			sha256: options.initialSha256,
			status: "clean",
			conflictSha256: null,
			message: null,
		};
	}

	public getState(): SaveCoordinatorState {
		return this.state;
	}

	public getWriterNonce(): string {
		return this.writerNonce;
	}

	public subscribe(listener: SaveListener): () => void {
		this.listeners.add(listener);
		listener(this.state);
		return () => this.listeners.delete(listener);
	}

	public update(scene: SceneData): void {
		const dirty = this.options.serialize(scene) !== this.baseSerialized;
		this.state = {
			...this.state,
			scene,
			status: dirty ? "pending" : "clean",
			conflictSha256: dirty ? this.state.conflictSha256 : null,
			message: null,
		};
		this.emit();
		if (!dirty) {
			this.clearTimer();
			return;
		}
		this.clearTimer();
		this.timer = setTimeout(() => {
			void this.flush("debounce");
		}, this.options.debounceMs ?? 700);
	}

	public async flush(_reason: FlushReason): Promise<SaveResult | null> {
		this.clearTimer();
		if (
			this.saving ||
			this.state.status === "conflict" ||
			this.state.status === "error"
		) {
			return null;
		}
		if (this.options.serialize(this.state.scene) === this.baseSerialized) {
			return null;
		}
		this.saving = true;
		const draftAtStart = this.state.scene;
		const contentAtStart = this.options.serialize(draftAtStart);
		const expectedShaAtStart = this.state.sha256;
		this.state = { ...this.state, status: "saving", message: null };
		this.emit();
		try {
			const result = await this.options.write({
				content: contentAtStart,
				expectedSha256: expectedShaAtStart,
				writerNonce: this.writerNonce,
			});
			if (result.status === "written") {
				this.reconciliationGeneration += 1;
				this.baseSerialized = contentAtStart;
				const hasNewerDraft =
					this.options.serialize(this.state.scene) !== contentAtStart;
				this.state = {
					...this.state,
					sha256: result.sha256,
					status: hasNewerDraft ? "pending" : "clean",
					conflictSha256: null,
					message: null,
				};
				this.emit();
				if (hasNewerDraft) this.scheduleImmediateFlush();
				return result;
			}
			if (result.status === "conflict") {
				this.state = {
					...this.state,
					status: "conflict",
					conflictSha256: result.currentSha256,
					message: "File changed elsewhere; reload to discard local changes",
				};
				this.emit();
				return result;
			}
			this.state = { ...this.state, status: "error", message: result.message };
			this.emit();
			return result;
		} finally {
			this.saving = false;
		}
	}

	public async handleExternalInvalidation(
		sha256: string,
	): Promise<ExternalReconciliationResult> {
		if (sha256 === this.state.sha256) return "ignored";
		if (this.isDirty()) {
			this.reconciliationGeneration += 1;
			this.enterExternalConflict(sha256);
			return "conflict";
		}
		return this.reconcileExternalChange();
	}

	public async reconcileExternalChange(): Promise<ExternalReconciliationResult> {
		const generation = ++this.reconciliationGeneration;
		const result = await this.options.read();
		if (generation !== this.reconciliationGeneration) return "superseded";

		const decision = decideExcalidrawReconciliation(
			{ sha256: this.state.sha256, isDirty: this.isDirty() },
			result.sha256,
		);
		if (decision.action === "ignore") return "ignored";
		if (decision.action === "conflict") {
			this.enterExternalConflict(decision.conflictSha256);
			return "conflict";
		}

		this.clearTimer();
		this.baseSerialized = this.options.serialize(result.scene);
		this.state = {
			scene: result.scene,
			sha256: result.sha256,
			status: "clean",
			conflictSha256: null,
			message: null,
		};
		this.emit();
		return "reloaded";
	}

	public async reload(): Promise<void> {
		this.reconciliationGeneration += 1;
		this.clearTimer();
		const result = await this.options.read();
		this.baseSerialized = this.options.serialize(result.scene);
		Object.assign(this.state, {
			scene: result.scene,
			sha256: result.sha256,
			status: "clean",
			conflictSha256: null,
			message: null,
		});
		this.emit();
	}

	public async dispose(): Promise<SaveResult | null> {
		return this.flush("close");
	}

	private isDirty(): boolean {
		return this.options.serialize(this.state.scene) !== this.baseSerialized;
	}

	private enterExternalConflict(conflictSha256: string): void {
		this.clearTimer();
		this.state = {
			...this.state,
			status: "conflict",
			conflictSha256,
			message: "File changed elsewhere; reload to discard local changes",
		};
		this.emit();
	}

	private scheduleImmediateFlush(): void {
		this.clearTimer();
		this.timer = setTimeout(() => {
			void this.flush("debounce");
		}, 0);
	}

	private clearTimer(): void {
		if (this.timer !== null) {
			clearTimeout(this.timer);
			this.timer = null;
		}
	}

	private emit(): void {
		for (const listener of this.listeners) listener(this.state);
	}
}
