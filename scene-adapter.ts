import {
	semanticOperationBatchSchema,
	semanticSceneSchema,
} from "./semantic-schema";
import type {
	SemanticElement,
	SemanticOperation,
	SemanticOperationBatch,
	SemanticScene,
} from "./semantic-schema";

export type JsonPrimitive = boolean | null | number | string;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
	[key: string]: JsonValue;
}

export interface ExcalidrawSceneDocument extends JsonObject {
	elements: JsonObject[];
	appState: JsonObject;
	files: JsonObject;
}

const MVP_ELEMENT_TYPES = new Set([
	"rectangle",
	"ellipse",
	"diamond",
	"text",
	"arrow",
	"line",
	"frame",
]);
const CANONICAL_ELEMENT_KEYS = ["id", "type", "x", "y", "width", "height"];

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function narrowJson(value: unknown, path: string): JsonValue {
	if (
		value === null ||
		typeof value === "boolean" ||
		typeof value === "string"
	) {
		return value;
	}
	if (typeof value === "number") {
		if (!Number.isFinite(value)) throw new Error(`${path} must be finite JSON`);
		return value;
	}
	if (Array.isArray(value)) {
		return value.map((entry, index) => narrowJson(entry, `${path}[${index}]`));
	}
	if (typeof value === "object") {
		const result: JsonObject = {};
		for (const [key, entry] of Object.entries(value)) {
			result[key] = narrowJson(entry, `${path}.${key}`);
		}
		return result;
	}
	throw new Error(`${path} contains a non-JSON value`);
}

function requireString(object: JsonObject, key: string, path: string): string {
	const value = object[key];
	if (typeof value !== "string")
		throw new Error(`${path}.${key} must be a string`);
	return value;
}

function numberOr(value: JsonValue | undefined, fallback: number): number {
	return typeof value === "number" ? value : fallback;
}

function stringOr(value: JsonValue | undefined, fallback: string): string {
	return typeof value === "string" ? value : fallback;
}

function jsonEquals(left: JsonValue | undefined, right: JsonValue): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

export function parseExcalidrawScene(source: string): ExcalidrawSceneDocument {
	let parsed: unknown;
	try {
		parsed = JSON.parse(source);
	} catch (error) {
		throw new Error("invalid Excalidraw scene JSON", { cause: error });
	}
	const value = narrowJson(parsed, "scene");
	if (!isJsonObject(value))
		throw new Error("Excalidraw scene must be an object");
	if (!Array.isArray(value.elements)) {
		throw new Error("Excalidraw scene elements must be an array");
	}
	const elements: JsonObject[] = [];
	const ids = new Set<string>();
	for (const [index, element] of value.elements.entries()) {
		if (!isJsonObject(element)) {
			throw new Error(`scene.elements[${index}] must be an object`);
		}
		const id = requireString(element, "id", `scene.elements[${index}]`);
		requireString(element, "type", `scene.elements[${index}]`);
		if (ids.has(id)) throw new Error(`duplicate native element ID: ${id}`);
		ids.add(id);
		elements.push(element);
	}
	const appStateValue = value.appState;
	if (!isJsonObject(appStateValue)) {
		throw new Error("Excalidraw scene appState must be an object");
	}
	const filesValue = value.files;
	if (filesValue !== undefined && !isJsonObject(filesValue)) {
		throw new Error("Excalidraw scene files must be an object");
	}
	return {
		...value,
		elements,
		appState: appStateValue,
		files: filesValue ?? {},
	};
}

// Adapted from the deterministic export model in yctimlin/mcp_excalidraw.
// See scene-adapter.ATTRIBUTION.md for source revision and MIT notice.
function stableHash(value: string): number {
	let hash = 0x811c9dc5;
	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

function deterministicPositiveInteger(value: string): number {
	return (stableHash(value) % 2_147_483_646) + 1;
}

function canonicalize(value: JsonValue): JsonValue {
	if (Array.isArray(value)) return value.map(canonicalize);
	if (!isJsonObject(value)) return value;
	const keys = Object.keys(value).sort((left, right) => {
		const leftIndex = CANONICAL_ELEMENT_KEYS.indexOf(left);
		const rightIndex = CANONICAL_ELEMENT_KEYS.indexOf(right);
		if (leftIndex !== -1 || rightIndex !== -1) {
			return (
				(leftIndex === -1 ? CANONICAL_ELEMENT_KEYS.length : leftIndex) -
				(rightIndex === -1 ? CANONICAL_ELEMENT_KEYS.length : rightIndex)
			);
		}
		if (left < right) return -1;
		if (left > right) return 1;
		return 0;
	});
	const result: JsonObject = {};
	for (const key of keys) result[key] = canonicalize(value[key] ?? null);
	return result;
}

function serializeCanonical(scene: ExcalidrawSceneDocument): string {
	return `${JSON.stringify(canonicalize(scene), null, 2)}\n`;
}

function createIndexAllocator(elements: JsonObject[]) {
	const used = new Set(
		elements.flatMap((element) =>
			typeof element.index === "string" ? [element.index] : [],
		),
	);
	let counter = 0;
	return (): string => {
		while (used.has(`a${counter.toString(36)}`)) counter += 1;
		const index = `a${counter.toString(36)}`;
		used.add(index);
		counter += 1;
		return index;
	};
}

function commonNativeElement(
	element: SemanticElement,
	index: string,
): JsonObject {
	const rounded = ["rectangle", "ellipse", "diamond"].includes(element.type);
	return {
		id: element.id,
		type: element.type,
		x: element.x,
		y: element.y,
		width: element.width,
		height: element.height,
		angle: 0,
		strokeColor: element.strokeColor,
		backgroundColor: element.backgroundColor,
		fillStyle: "solid",
		strokeWidth: 2,
		strokeStyle: "solid",
		roughness: 1,
		opacity: 100,
		groupIds: [...element.groupIds],
		frameId: element.frameId,
		index,
		roundness: rounded ? { type: 3 } : null,
		seed: deterministicPositiveInteger(`${element.id}:seed`),
		version: 1,
		versionNonce: deterministicPositiveInteger(`${element.id}:version:1`),
		isDeleted: false,
		boundElements: null,
		updated: 1,
		link: null,
		locked: false,
	};
}

function bindingFor(elementId: string): JsonObject {
	return { elementId, focus: 0, gap: 4, fixedPoint: null };
}

function textDimensions(text: string, fontSize: number): [number, number] {
	const lines = text.split("\n");
	const longest = Math.max(1, ...lines.map((line) => Array.from(line).length));
	return [
		Math.ceil(longest * fontSize * 0.6),
		Math.ceil(lines.length * fontSize * 1.25),
	];
}

function boundLabelPosition(
	container: JsonObject,
	text: string,
	fontSize: number,
): { height: number; width: number; x: number; y: number } {
	const [estimatedWidth, estimatedHeight] = textDimensions(text, fontSize);
	const containerX = numberOr(container.x, 0);
	const containerY = numberOr(container.y, 0);
	const containerWidth = numberOr(container.width, estimatedWidth);
	const containerHeight = numberOr(container.height, estimatedHeight);
	const width = Math.min(
		Math.max(estimatedWidth, 20),
		Math.max(containerWidth - 20, 20),
	);
	const height = Math.min(
		Math.max(estimatedHeight, fontSize * 1.25),
		Math.max(containerHeight, fontSize * 1.25),
	);
	return {
		width,
		height,
		x: containerX + (containerWidth - width) / 2,
		y: containerY + (containerHeight - height) / 2,
	};
}

function createBoundLabel(
	container: JsonObject,
	label: { color: string; fontSize: number; id: string; text: string },
	index: string,
): JsonObject {
	const position = boundLabelPosition(container, label.text, label.fontSize);
	return {
		id: label.id,
		type: "text",
		...position,
		angle: 0,
		strokeColor: label.color,
		backgroundColor: "transparent",
		fillStyle: "solid",
		strokeWidth: 1,
		strokeStyle: "solid",
		roughness: 1,
		opacity: 100,
		groupIds: Array.isArray(container.groupIds) ? [...container.groupIds] : [],
		frameId: container.frameId ?? null,
		index,
		roundness: null,
		seed: deterministicPositiveInteger(`${label.id}:seed`),
		version: 1,
		versionNonce: deterministicPositiveInteger(`${label.id}:version:1`),
		isDeleted: false,
		boundElements: null,
		updated: 1,
		link: null,
		locked: false,
		text: label.text,
		originalText: label.text,
		fontSize: label.fontSize,
		fontFamily: 5,
		textAlign: "center",
		verticalAlign: "middle",
		autoResize: true,
		lineHeight: 1.25,
		containerId: requireString(container, "id", "label container"),
	};
}

function appendBoundReference(
	element: JsonObject,
	id: string,
	type: "arrow" | "text",
): boolean {
	const current = Array.isArray(element.boundElements)
		? element.boundElements.filter(isJsonObject)
		: [];
	if (current.some((entry) => entry.id === id && entry.type === type))
		return false;
	element.boundElements = [...current, { id, type }];
	return true;
}

function removeBoundReference(
	element: JsonObject,
	id: string,
	type?: "arrow" | "text",
): boolean {
	if (!Array.isArray(element.boundElements)) return false;
	const before = element.boundElements;
	const after = before.filter(
		(entry) =>
			!isJsonObject(entry) ||
			entry.id !== id ||
			(type !== undefined && entry.type !== type),
	);
	if (after.length === before.length) return false;
	element.boundElements = after.length === 0 ? null : after;
	return true;
}

function createNativeElements(
	element: SemanticElement,
	allocateIndex: () => string,
): JsonObject[] {
	const native = commonNativeElement(element, allocateIndex());
	if (element.type === "text") {
		native.strokeColor = element.color;
		native.text = element.text;
		native.originalText = element.text;
		native.fontSize = element.fontSize;
		native.fontFamily = 5;
		native.textAlign = "center";
		native.verticalAlign = "middle";
		native.autoResize = true;
		native.lineHeight = 1.25;
		native.containerId = null;
	}
	if (element.type === "arrow" || element.type === "line") {
		native.points = element.points.map((point) => [...point]);
		native.lastCommittedPoint = null;
		native.startBinding =
			element.type === "arrow" && element.startBinding !== null
				? bindingFor(element.startBinding.elementId)
				: null;
		native.endBinding =
			element.type === "arrow" && element.endBinding !== null
				? bindingFor(element.endBinding.elementId)
				: null;
		native.startArrowhead = null;
		native.endArrowhead = element.type === "arrow" ? "arrow" : null;
		if (element.type === "arrow") native.elbowed = false;
	}
	if (element.type === "frame") native.name = element.name;
	if (!("label" in element) || element.label === undefined) return [native];
	const label = createBoundLabel(native, element.label, allocateIndex());
	appendBoundReference(native, element.label.id, "text");
	return [native, label];
}

function indexElements(elements: JsonObject[]): Map<string, JsonObject> {
	const result = new Map<string, JsonObject>();
	for (const [index, element] of elements.entries()) {
		const id = requireString(element, "id", `elements[${index}]`);
		if (result.has(id)) throw new Error(`duplicate native element ID: ${id}`);
		result.set(id, element);
	}
	return result;
}

function active(element: JsonObject | undefined): element is JsonObject {
	return element !== undefined && element.isDeleted !== true;
}

function nativeType(element: JsonObject): string {
	return requireString(
		element,
		"type",
		`element ${stringOr(element.id, "unknown")}`,
	);
}

function bindingTarget(
	element: JsonObject,
	key: "endBinding" | "startBinding",
): string | null {
	const binding = element[key];
	if (!isJsonObject(binding)) return null;
	return typeof binding.elementId === "string" ? binding.elementId : null;
}

function currentBoundLabel(
	container: JsonObject,
	elementsById: Map<string, JsonObject>,
): JsonObject | undefined {
	if (!Array.isArray(container.boundElements)) return undefined;
	for (const reference of container.boundElements) {
		if (!isJsonObject(reference) || reference.type !== "text") continue;
		if (typeof reference.id !== "string") continue;
		const candidate = elementsById.get(reference.id);
		if (active(candidate) && candidate.containerId === container.id)
			return candidate;
	}
	return undefined;
}

function copyArray(value: JsonValue): JsonValue {
	return Array.isArray(value)
		? value.map((entry) => narrowJson(entry, "change"))
		: value;
}

function updateCommonFields(element: JsonObject, changes: JsonObject): void {
	for (const key of [
		"x",
		"y",
		"width",
		"height",
		"strokeColor",
		"backgroundColor",
		"frameId",
	] as const) {
		if (changes[key] !== undefined) element[key] = changes[key];
	}
	if (changes.groupIds !== undefined)
		element.groupIds = copyArray(changes.groupIds);
}

interface MutationContext {
	elements: JsonObject[];
	elementsById: Map<string, JsonObject>;
	allocateIndex: () => string;
	changedIds: Set<string>;
	newIds: Set<string>;
	affectedArrowIds: Set<string>;
}

function bumpElement(element: JsonObject, context: MutationContext): void {
	const id = requireString(element, "id", "changed element");
	if (context.newIds.has(id) || context.changedIds.has(id)) return;
	const version = numberOr(element.version, 0) + 1;
	element.version = version;
	element.versionNonce = deterministicPositiveInteger(
		`${id}:version:${version}`,
	);
	element.updated = numberOr(element.updated, 0) + 1;
	context.changedIds.add(id);
}

function repositionLabel(
	container: JsonObject,
	label: JsonObject,
	context: MutationContext,
): void {
	const text = stringOr(label.text, "");
	const fontSize = numberOr(label.fontSize, 16);
	const position = boundLabelPosition(container, text, fontSize);
	let changed = false;
	for (const [key, value] of Object.entries(position)) {
		if (label[key] !== value) {
			label[key] = value;
			changed = true;
		}
	}
	for (const key of ["frameId", "groupIds"] as const) {
		const value =
			key === "frameId"
				? (container.frameId ?? null)
				: (container.groupIds ?? []);
		if (!jsonEquals(label[key], value)) {
			label[key] = copyArray(value);
			changed = true;
		}
	}
	if (changed) bumpElement(label, context);
}

function applyLabelChange(
	container: JsonObject,
	labelChange: JsonValue,
	context: MutationContext,
): void {
	const existing = currentBoundLabel(container, context.elementsById);
	if (labelChange === null) {
		if (existing !== undefined) {
			existing.isDeleted = true;
			bumpElement(existing, context);
			if (
				removeBoundReference(
					container,
					requireString(existing, "id", "bound label"),
					"text",
				)
			) {
				bumpElement(container, context);
			}
		}
		return;
	}
	if (!isJsonObject(labelChange))
		throw new Error("label change must be an object or null");
	const id = requireString(labelChange, "id", "label change");
	const text = requireString(labelChange, "text", "label change");
	const color = requireString(labelChange, "color", "label change");
	const fontSize = labelChange.fontSize;
	if (typeof fontSize !== "number")
		throw new Error("label change fontSize must be a number");
	if (existing !== undefined) {
		const existingId = requireString(existing, "id", "bound label");
		if (existingId !== id)
			throw new Error("bound label ID cannot change during update");
		existing.text = text;
		existing.originalText = text;
		existing.strokeColor = color;
		existing.fontSize = fontSize;
		bumpElement(existing, context);
		repositionLabel(container, existing, context);
		return;
	}
	if (context.elementsById.has(id)) {
		throw new Error(`native element ID already exists: ${id}`);
	}
	const label = createBoundLabel(
		container,
		{ id, text, color, fontSize },
		context.allocateIndex(),
	);
	context.elements.push(label);
	context.elementsById.set(id, label);
	context.newIds.add(id);
	if (appendBoundReference(container, id, "text")) {
		bumpElement(container, context);
	}
}

function markDeleted(element: JsonObject, context: MutationContext): void {
	if (element.isDeleted === true) return;
	element.isDeleted = true;
	bumpElement(element, context);
}

function validateSupportedTarget(element: JsonObject, id: string): string {
	const type = nativeType(element);
	if (!MVP_ELEMENT_TYPES.has(type)) {
		throw new Error(`element ${id} has unsupported type: ${type}`);
	}
	return type;
}

function validateFinalReferences(elementsById: Map<string, JsonObject>): void {
	for (const element of elementsById.values()) {
		if (!active(element) || !MVP_ELEMENT_TYPES.has(nativeType(element)))
			continue;
		if (typeof element.frameId === "string") {
			const frame = elementsById.get(element.frameId);
			if (!active(frame) || nativeType(frame) !== "frame") {
				throw new Error(`invalid frame reference: ${element.frameId}`);
			}
		}
		if (nativeType(element) !== "arrow") continue;
		for (const key of ["startBinding", "endBinding"] as const) {
			const targetId = bindingTarget(element, key);
			if (targetId !== null && !active(elementsById.get(targetId))) {
				throw new Error(`invalid arrow binding reference: ${targetId}`);
			}
		}
	}
}

function reconcileArrowBindings(context: MutationContext): void {
	for (const element of context.elements) {
		for (const arrowId of context.affectedArrowIds) {
			if (removeBoundReference(element, arrowId, "arrow")) {
				bumpElement(element, context);
			}
		}
	}
	for (const arrowId of context.affectedArrowIds) {
		const arrow = context.elementsById.get(arrowId);
		if (!active(arrow) || nativeType(arrow) !== "arrow") continue;
		for (const key of ["startBinding", "endBinding"] as const) {
			const targetId = bindingTarget(arrow, key);
			if (targetId === null) continue;
			const target = context.elementsById.get(targetId);
			if (!active(target)) {
				arrow[key] = null;
				bumpElement(arrow, context);
				continue;
			}
			if (appendBoundReference(target, arrowId, "arrow")) {
				bumpElement(target, context);
			}
		}
	}
}

function cleanupDeletedTargetReferences(
	deletedId: string,
	context: MutationContext,
): void {
	for (const element of context.elements) {
		if (!active(element)) continue;
		const type = nativeType(element);
		if (type === "arrow") {
			for (const key of ["startBinding", "endBinding"] as const) {
				if (bindingTarget(element, key) === deletedId) {
					element[key] = null;
					context.affectedArrowIds.add(requireString(element, "id", "arrow"));
					bumpElement(element, context);
				}
			}
		}
		if (element.frameId === deletedId) {
			element.frameId = null;
			bumpElement(element, context);
		}
	}
	const deleted = context.elementsById.get(deletedId);
	if (deleted === undefined) return;
	const label = currentBoundLabel(deleted, context.elementsById);
	if (label !== undefined) markDeleted(label, context);
	if (
		nativeType(deleted) === "text" &&
		typeof deleted.containerId === "string"
	) {
		const container = context.elementsById.get(deleted.containerId);
		if (
			active(container) &&
			removeBoundReference(container, deletedId, "text")
		) {
			bumpElement(container, context);
		}
	}
}

function createMutationContext(
	elements: JsonObject[],
	newIds: Set<string> = new Set(),
): MutationContext {
	return {
		elements,
		elementsById: indexElements(elements),
		allocateIndex: createIndexAllocator(elements),
		changedIds: new Set(),
		newIds,
		affectedArrowIds: new Set(),
	};
}

function applyCreateOperation(
	operation: Extract<SemanticOperation, { type: "create" }>,
	context: MutationContext,
): void {
	const created = createNativeElements(
		operation.element,
		context.allocateIndex,
	);
	for (const element of created) {
		const id = requireString(element, "id", "created element");
		if (context.elementsById.has(id)) {
			throw new Error(`native element ID already exists: ${id}`);
		}
		context.elements.push(element);
		context.elementsById.set(id, element);
		context.newIds.add(id);
	}
	if (operation.element.type === "arrow") {
		context.affectedArrowIds.add(operation.element.id);
	}
}

function applyDeleteOperation(
	operation: Extract<SemanticOperation, { type: "delete" }>,
	context: MutationContext,
): void {
	const element = context.elementsById.get(operation.id);
	if (!active(element))
		throw new Error(`native element not found: ${operation.id}`);
	const type = validateSupportedTarget(element, operation.id);
	markDeleted(element, context);
	if (type === "arrow") context.affectedArrowIds.add(operation.id);
	cleanupDeletedTargetReferences(operation.id, context);
}

function applyTextChanges(element: JsonObject, changes: JsonObject): void {
	if (typeof changes.text === "string") {
		element.text = changes.text;
		element.originalText = changes.text;
	}
	if (typeof changes.fontSize === "number") element.fontSize = changes.fontSize;
	if (typeof changes.color === "string") element.strokeColor = changes.color;
}

function applyArrowChanges(
	element: JsonObject,
	changes: JsonObject,
	operationId: string,
	context: MutationContext,
): void {
	for (const key of ["startBinding", "endBinding"] as const) {
		if (changes[key] === undefined) continue;
		if (changes[key] === null) {
			element[key] = null;
		} else if (isJsonObject(changes[key])) {
			element[key] = bindingFor(
				requireString(changes[key], "elementId", `operation.changes.${key}`),
			);
		}
	}
	context.affectedArrowIds.add(operationId);
}

function supportsLabel(type: string): boolean {
	return ["rectangle", "ellipse", "diamond", "arrow", "line"].includes(type);
}

function applyUpdateOperation(
	operation: Extract<SemanticOperation, { type: "update" }>,
	context: MutationContext,
): void {
	const element = context.elementsById.get(operation.id);
	if (!active(element))
		throw new Error(`native element not found: ${operation.id}`);
	const type = validateSupportedTarget(element, operation.id);
	if (type !== operation.elementType) {
		throw new Error(
			`element type mismatch for ${operation.id}: expected ${operation.elementType}, found ${type}`,
		);
	}
	const changes = narrowJson(operation.changes, "operation.changes");
	if (!isJsonObject(changes))
		throw new Error("operation changes must be an object");
	updateCommonFields(element, changes);
	if (operation.elementType === "text") applyTextChanges(element, changes);
	if (
		(operation.elementType === "arrow" || operation.elementType === "line") &&
		Array.isArray(changes.points)
	) {
		element.points = copyArray(changes.points);
	}
	if (operation.elementType === "arrow") {
		applyArrowChanges(element, changes, operation.id, context);
	}
	if (operation.elementType === "frame" && typeof changes.name === "string") {
		element.name = changes.name;
	}
	if (supportsLabel(operation.elementType) && changes.label !== undefined) {
		applyLabelChange(element, changes.label, context);
	}
	bumpElement(element, context);
	const label = currentBoundLabel(element, context.elementsById);
	if (label !== undefined) repositionLabel(element, label, context);
}

function applyOperation(
	operation: SemanticOperation,
	context: MutationContext,
): void {
	switch (operation.type) {
		case "create":
			applyCreateOperation(operation, context);
			return;
		case "delete":
			applyDeleteOperation(operation, context);
			return;
		case "update":
			applyUpdateOperation(operation, context);
	}
}

export function createExcalidrawScene(scene: SemanticScene): string {
	const semantic = semanticSceneSchema.parse(scene);
	const elements: JsonObject[] = [];
	const allocateIndex = createIndexAllocator(elements);
	for (const element of semantic.elements) {
		elements.push(...createNativeElements(element, allocateIndex));
	}
	const context = createMutationContext(
		elements,
		new Set(indexElements(elements).keys()),
	);
	for (const element of elements) {
		if (nativeType(element) === "arrow") {
			context.affectedArrowIds.add(requireString(element, "id", "arrow"));
		}
	}
	reconcileArrowBindings(context);
	const sceneDocument: ExcalidrawSceneDocument = {
		type: "excalidraw",
		version: 2,
		source: "bb-excalidraw-plugin",
		elements,
		appState: { gridSize: null, viewBackgroundColor: "#ffffff" },
		files: {},
	};
	return serializeCanonical(sceneDocument);
}

export function applySemanticOperationBatch(
	source: string,
	batch: SemanticOperationBatch,
): string {
	const operations = semanticOperationBatchSchema.parse(batch).operations;
	const sceneDocument = parseExcalidrawScene(source);
	if (operations.length === 0) return source;
	const context = createMutationContext(sceneDocument.elements);
	for (const operation of operations) applyOperation(operation, context);
	validateFinalReferences(context.elementsById);
	reconcileArrowBindings(context);
	validateFinalReferences(context.elementsById);
	return serializeCanonical(sceneDocument);
}
