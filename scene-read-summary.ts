export const MAX_SCENE_READ_OUTPUT_BYTES = 256 * 1024;

const summarizedElementTypes = new Set([
	"rectangle",
	"ellipse",
	"diamond",
	"text",
	"arrow",
	"line",
	"frame",
]);

type SummarizedElementType =
	| "rectangle"
	| "ellipse"
	| "diamond"
	| "text"
	| "arrow"
	| "line"
	| "frame";

interface ElementSummary {
	id: string;
	type: SummarizedElementType;
	groupIds: string[];
	frameId: string | null;
	label?: { id: string; text: string };
}

interface ConnectionSummary {
	id: string;
	startElementId: string | null;
	endElementId: string | null;
}

interface ImageSummary {
	id: string;
	mimeType: string;
	width?: number;
	height?: number;
	byteEstimate?: number;
}

export interface SceneReadSummary {
	revision: string;
	bounds: { x: number; y: number; width: number; height: number };
	elementCount: number;
	elementTypeCounts: Record<SummarizedElementType, number>;
	elements: ElementSummary[];
	connections: ConnectionSummary[];
	overlaps: Array<{ firstElementId: string; secondElementId: string }>;
	images: ImageSummary[];
	truncated: boolean;
	omittedElementCount: number;
}

function record(value: unknown): Record<string, unknown> | null {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return null;
	}
	return value as Record<string, unknown>;
}

function string(value: unknown): string | null {
	return typeof value === "string" ? value : null;
}

function finiteNumber(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function positiveInteger(value: unknown): number | undefined {
	return typeof value === "number" && Number.isInteger(value) && value > 0
		? value
		: undefined;
}

function elementType(value: unknown): SummarizedElementType | null {
	return typeof value === "string" && summarizedElementTypes.has(value)
		? (value as SummarizedElementType)
		: null;
}

function elementId(value: Record<string, unknown>): string | null {
	return string(value.id);
}

function stringArray(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
}

function boundTextIds(value: Record<string, unknown>): string[] {
	if (!Array.isArray(value.boundElements)) return [];
	return value.boundElements.flatMap((binding) => {
		const item = record(binding);
		return item?.type === "text" && typeof item.id === "string"
			? [item.id]
			: [];
	});
}

function bindingElementId(value: unknown): string | null {
	const binding = record(value);
	return binding === null ? null : string(binding.elementId);
}

function base64ByteEstimate(dataUrl: string): number | undefined {
	const comma = dataUrl.indexOf(",");
	if (comma < 0 || !dataUrl.slice(0, comma).includes(";base64"))
		return undefined;
	const body = dataUrl.slice(comma + 1);
	const padding = body.endsWith("==") ? 2 : body.endsWith("=") ? 1 : 0;
	return Math.max(0, Math.floor((body.length * 3) / 4) - padding);
}

function createCounts(): Record<SummarizedElementType, number> {
	return {
		rectangle: 0,
		ellipse: 0,
		diamond: 0,
		text: 0,
		arrow: 0,
		line: 0,
		frame: 0,
	};
}

function overlaps(
	elements: Array<{
		id: string;
		x: number;
		y: number;
		width: number;
		height: number;
	}>,
): Array<{ firstElementId: string; secondElementId: string }> {
	const maxCandidates = 1_000;
	const candidates: Array<{ firstElementId: string; secondElementId: string }> =
		[];
	const active: Array<{
		id: string;
		x: number;
		y: number;
		width: number;
		height: number;
	}> = [];
	for (const current of [...elements].sort((left, right) => left.x - right.x)) {
		for (let index = active.length - 1; index >= 0; index -= 1) {
			const previous = active[index];
			if (previous !== undefined && previous.x + previous.width <= current.x) {
				active.splice(index, 1);
			}
		}
		for (const previous of active) {
			if (
				previous.y < current.y + current.height &&
				previous.y + previous.height > current.y
			) {
				candidates.push({
					firstElementId: previous.id,
					secondElementId: current.id,
				});
				if (candidates.length === maxCandidates) return candidates;
			}
		}
		active.push(current);
	}
	return candidates;
}

function serializedSize(value: object): number {
	return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function trimToOutputLimit(
	summary: SceneReadSummary,
	maxOutputBytes: number,
): SceneReadSummary {
	const maxSummaryBytes = maxOutputBytes - 256;
	if (serializedSize(summary) <= maxSummaryBytes) return summary;
	summary.truncated = true;
	summary.overlaps = [];
	summary.images = [];
	summary.connections = [];
	if (serializedSize(summary) <= maxSummaryBytes) return summary;

	const originalElements = summary.elements;
	const originalElementCount = originalElements.length;
	let lower = 0;
	let upper = originalElementCount;
	while (lower < upper) {
		const middle = Math.ceil((lower + upper) / 2);
		summary.elements = originalElements.slice(0, middle);
		if (serializedSize(summary) <= maxSummaryBytes) {
			lower = middle;
		} else {
			upper = middle - 1;
		}
	}
	summary.elements = originalElements.slice(0, lower);
	summary.omittedElementCount = originalElementCount - lower;
	return summary;
}

/** Builds a model-safe semantic scene summary without returning scene bytes. */
export function summarizeSceneRead(
	content: string,
	revision: string,
	maxOutputBytes = MAX_SCENE_READ_OUTPUT_BYTES,
): SceneReadSummary {
	const parsed: unknown = JSON.parse(content);
	const scene = record(parsed);
	const nativeElements =
		scene !== null && Array.isArray(scene.elements) ? scene.elements : [];
	const textByContainerId = new Map<string, { id: string; text: string }>();
	for (const rawElement of nativeElements) {
		const element = record(rawElement);
		if (element === null || element.type !== "text") continue;
		const containerId = string(element.containerId);
		const id = elementId(element);
		const text = string(element.text);
		if (containerId !== null && id !== null && text !== null) {
			textByContainerId.set(containerId, { id, text });
		}
	}

	const counts = createCounts();
	const elements: ElementSummary[] = [];
	const connections: ConnectionSummary[] = [];
	const boundsElements: Array<{
		id: string;
		x: number;
		y: number;
		width: number;
		height: number;
	}> = [];
	for (const rawElement of nativeElements) {
		const element = record(rawElement);
		if (element === null) continue;
		const id = elementId(element);
		const type = elementType(element.type);
		if (id === null || type === null) continue;
		counts[type] += 1;
		const label = boundTextIds(element)
			.map((textId) => {
				const candidate = textByContainerId.get(id);
				return candidate?.id === textId ? candidate : undefined;
			})
			.find((candidate) => candidate !== undefined);
		elements.push({
			id,
			type,
			groupIds: stringArray(element.groupIds),
			frameId: string(element.frameId),
			...(label === undefined ? {} : { label }),
		});
		const x = finiteNumber(element.x);
		const y = finiteNumber(element.y);
		const width = finiteNumber(element.width);
		const height = finiteNumber(element.height);
		if (x !== null && y !== null && width !== null && height !== null) {
			boundsElements.push({ id, x, y, width, height });
		}
		if (type === "arrow") {
			connections.push({
				id,
				startElementId: bindingElementId(element.startBinding),
				endElementId: bindingElementId(element.endBinding),
			});
		}
	}

	const xs = boundsElements.map((element) => element.x);
	const ys = boundsElements.map((element) => element.y);
	const right = boundsElements.map((element) => element.x + element.width);
	const bottom = boundsElements.map((element) => element.y + element.height);
	const minX = xs.length === 0 ? 0 : Math.min(...xs);
	const minY = ys.length === 0 ? 0 : Math.min(...ys);
	const maxX = right.length === 0 ? 0 : Math.max(...right);
	const maxY = bottom.length === 0 ? 0 : Math.max(...bottom);
	const files = scene === null ? null : record(scene.files);
	const images: ImageSummary[] =
		files === null
			? []
			: Object.entries(files).flatMap(([id, file]) => {
					const metadata = record(file);
					if (metadata === null) return [];
					const mimeType = string(metadata.mimeType);
					if (mimeType === null || !mimeType.startsWith("image/")) return [];
					const width = positiveInteger(metadata.width);
					const height = positiveInteger(metadata.height);
					const dataUrl = string(metadata.dataURL);
					const byteEstimate =
						dataUrl === null ? undefined : base64ByteEstimate(dataUrl);
					return [
						{
							id,
							mimeType,
							...(width === undefined ? {} : { width }),
							...(height === undefined ? {} : { height }),
							...(byteEstimate === undefined ? {} : { byteEstimate }),
						},
					];
				});
	const summary: SceneReadSummary = {
		revision,
		bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
		elementCount: nativeElements.length,
		elementTypeCounts: counts,
		elements,
		connections,
		overlaps: overlaps(boundsElements),
		images,
		truncated: false,
		omittedElementCount: 0,
	};
	return trimToOutputLimit(summary, maxOutputBytes);
}
