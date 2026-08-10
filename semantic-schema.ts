import { z } from "zod";

export const MAX_SEMANTIC_SCENE_ELEMENTS = 10_000;
export const MAX_SEMANTIC_OPERATIONS = 500;
export const MAX_TEXT_CODE_POINTS = 20_000;

const MAX_COORDINATE = 10_000_000;
const MAX_POINTS = 1_000;
const MAX_GROUPS_PER_ELEMENT = 32;
const MAX_IMAGES = 10_000;
const MAX_IDENTIFIER_LENGTH = 128;

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const colorPattern = /^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/;
const sha256Pattern = /^[0-9a-f]{64}$/;
const imageMimeTypePattern = /^image\/[a-z0-9][a-z0-9.+-]*$/i;

export const semanticIdSchema = z
	.string()
	.min(1)
	.max(MAX_IDENTIFIER_LENGTH)
	.regex(identifierPattern, "must be a bounded semantic identifier");

export const semanticColorSchema = z.union([
	z.literal("transparent"),
	z
		.string()
		.regex(
			colorPattern,
			"must be transparent or a six- or eight-digit hex color",
		),
]);

export const sha256Schema = z
	.string()
	.regex(sha256Pattern, "must be a lowercase SHA-256 digest");

export function unicodeCodePointLength(value: string): number {
	return Array.from(value).length;
}

export const semanticTextSchema = z.string().superRefine((value, context) => {
	const length = unicodeCodePointLength(value);
	if (length > MAX_TEXT_CODE_POINTS) {
		context.addIssue({
			code: "custom",
			message: `must contain at most ${MAX_TEXT_CODE_POINTS} Unicode code points`,
		});
	}
});

const coordinateSchema = z.number().min(-MAX_COORDINATE).max(MAX_COORDINATE);
const dimensionSchema = z.number().positive().max(MAX_COORDINATE);
const linearDimensionSchema = z.number().nonnegative().max(MAX_COORDINATE);
const fontSizeSchema = z.number().positive().max(1_000);
const pointSchema = z.tuple([coordinateSchema, coordinateSchema]);
const pointsSchema = z
	.array(pointSchema)
	.min(2)
	.max(MAX_POINTS)
	.refine(
		(points) =>
			points.some(
				(point) => point[0] !== points[0]?.[0] || point[1] !== points[0]?.[1],
			),
		{ message: "linear elements require at least two distinct points" },
	);
const groupIdsSchema = z
	.array(semanticIdSchema)
	.max(MAX_GROUPS_PER_ELEMENT)
	.refine((ids) => new Set(ids).size === ids.length, {
		message: "group IDs must be unique within an element",
	});

export const semanticLabelSchema = z.strictObject({
	id: semanticIdSchema,
	text: semanticTextSchema,
	fontSize: fontSizeSchema,
	color: semanticColorSchema,
});

export const semanticBindingSchema = z.strictObject({
	elementId: semanticIdSchema,
});

const commonElementShape = {
	id: semanticIdSchema,
	x: coordinateSchema,
	y: coordinateSchema,
	width: dimensionSchema,
	height: dimensionSchema,
	strokeColor: semanticColorSchema,
	backgroundColor: semanticColorSchema,
	groupIds: groupIdsSchema.default([]),
	frameId: semanticIdSchema.nullable().default(null),
};

const labelableElementShape = {
	...commonElementShape,
	label: semanticLabelSchema.optional(),
};

const linearLabelableElementShape = {
	...labelableElementShape,
	width: linearDimensionSchema,
	height: linearDimensionSchema,
};

export const semanticRectangleSchema = z.strictObject({
	...labelableElementShape,
	type: z.literal("rectangle"),
});

export const semanticEllipseSchema = z.strictObject({
	...labelableElementShape,
	type: z.literal("ellipse"),
});

export const semanticDiamondSchema = z.strictObject({
	...labelableElementShape,
	type: z.literal("diamond"),
});

export const semanticTextElementSchema = z.strictObject({
	...commonElementShape,
	type: z.literal("text"),
	text: semanticTextSchema,
	fontSize: fontSizeSchema,
	color: semanticColorSchema,
});

export const semanticArrowSchema = z.strictObject({
	...linearLabelableElementShape,
	type: z.literal("arrow"),
	points: pointsSchema,
	startBinding: semanticBindingSchema.nullable().default(null),
	endBinding: semanticBindingSchema.nullable().default(null),
});

export const semanticLineSchema = z.strictObject({
	...linearLabelableElementShape,
	type: z.literal("line"),
	points: pointsSchema,
});

export const semanticFrameSchema = z.strictObject({
	...commonElementShape,
	type: z.literal("frame"),
	name: semanticTextSchema,
});

const semanticElementDiscriminatedSchema = z.discriminatedUnion("type", [
	semanticRectangleSchema,
	semanticEllipseSchema,
	semanticDiamondSchema,
	semanticTextElementSchema,
	semanticArrowSchema,
	semanticLineSchema,
	semanticFrameSchema,
]);

export const semanticElementSchema =
	semanticElementDiscriminatedSchema.superRefine((element, context) => {
		if (element.frameId === element.id) {
			context.addIssue({
				code: "custom",
				path: ["frameId"],
				message: "an element cannot reference itself as its frame",
			});
		}
		if (element.type !== "arrow") return;
		for (const key of ["startBinding", "endBinding"] as const) {
			if (element[key]?.elementId === element.id) {
				context.addIssue({
					code: "custom",
					path: [key, "elementId"],
					message: "an arrow cannot bind to itself",
				});
			}
		}
	});

export type SemanticElement = z.infer<typeof semanticElementSchema>;

function labelOf(element: SemanticElement) {
	return "label" in element ? element.label : undefined;
}

function addDuplicateIdIssue(
	context: z.RefinementCtx,
	id: string,
	path: PropertyKey[],
): void {
	context.addIssue({
		code: "custom",
		path,
		message: `duplicate semantic ID: ${id}`,
	});
}

export const semanticSceneSchema = z
	.strictObject({
		elements: z.array(semanticElementSchema).max(MAX_SEMANTIC_SCENE_ELEMENTS),
	})
	.superRefine((scene, context) => {
		const elementsById = new Map<string, SemanticElement>();
		const allIds = new Set<string>();
		let effectiveElementCount = scene.elements.length;

		for (const [index, element] of scene.elements.entries()) {
			if (allIds.has(element.id)) {
				addDuplicateIdIssue(context, element.id, ["elements", index, "id"]);
			} else {
				allIds.add(element.id);
				elementsById.set(element.id, element);
			}
			const label = labelOf(element);
			if (label !== undefined) {
				effectiveElementCount += 1;
				if (allIds.has(label.id)) {
					addDuplicateIdIssue(context, label.id, [
						"elements",
						index,
						"label",
						"id",
					]);
				} else {
					allIds.add(label.id);
				}
			}
		}

		if (effectiveElementCount > MAX_SEMANTIC_SCENE_ELEMENTS) {
			context.addIssue({
				code: "custom",
				path: ["elements"],
				message: `scene expands to ${effectiveElementCount} elements; maximum is ${MAX_SEMANTIC_SCENE_ELEMENTS}`,
			});
		}

		for (const [index, element] of scene.elements.entries()) {
			if (element.frameId !== null) {
				const frame = elementsById.get(element.frameId);
				if (frame === undefined) {
					context.addIssue({
						code: "custom",
						path: ["elements", index, "frameId"],
						message: `unknown frame reference: ${element.frameId}`,
					});
				} else if (frame.type !== "frame") {
					context.addIssue({
						code: "custom",
						path: ["elements", index, "frameId"],
						message: `frame reference does not target a frame: ${element.frameId}`,
					});
				}
			}
			if (element.type !== "arrow") continue;
			for (const key of ["startBinding", "endBinding"] as const) {
				const binding = element[key];
				if (binding !== null && !elementsById.has(binding.elementId)) {
					context.addIssue({
						code: "custom",
						path: ["elements", index, key, "elementId"],
						message: `unknown binding reference: ${binding.elementId}`,
					});
				}
			}
		}
	});

export type SemanticScene = z.infer<typeof semanticSceneSchema>;

const commonChangesShape = {
	x: coordinateSchema.optional(),
	y: coordinateSchema.optional(),
	width: dimensionSchema.optional(),
	height: dimensionSchema.optional(),
	strokeColor: semanticColorSchema.optional(),
	backgroundColor: semanticColorSchema.optional(),
	groupIds: groupIdsSchema.optional(),
	frameId: semanticIdSchema.nullable().optional(),
};

const labelableChangesShape = {
	...commonChangesShape,
	label: semanticLabelSchema.nullable().optional(),
};

const linearLabelableChangesShape = {
	...labelableChangesShape,
	width: linearDimensionSchema.optional(),
	height: linearDimensionSchema.optional(),
};

function requireChanges<T extends Record<string, unknown>>(value: T): boolean {
	return Object.keys(value).length > 0;
}

const shapeChangesSchema = z
	.strictObject(labelableChangesShape)
	.refine(requireChanges, { message: "at least one field must be updated" });
const textChangesSchema = z
	.strictObject({
		...commonChangesShape,
		text: semanticTextSchema.optional(),
		fontSize: fontSizeSchema.optional(),
		color: semanticColorSchema.optional(),
	})
	.refine(requireChanges, { message: "at least one field must be updated" });
const arrowChangesSchema = z
	.strictObject({
		...linearLabelableChangesShape,
		points: pointsSchema.optional(),
		startBinding: semanticBindingSchema.nullable().optional(),
		endBinding: semanticBindingSchema.nullable().optional(),
	})
	.refine(requireChanges, { message: "at least one field must be updated" });
const lineChangesSchema = z
	.strictObject({
		...linearLabelableChangesShape,
		points: pointsSchema.optional(),
	})
	.refine(requireChanges, { message: "at least one field must be updated" });
const frameChangesSchema = z
	.strictObject({
		...commonChangesShape,
		name: semanticTextSchema.optional(),
	})
	.refine(requireChanges, { message: "at least one field must be updated" });

const updateOperationSchema = z.discriminatedUnion("elementType", [
	z.strictObject({
		type: z.literal("update"),
		id: semanticIdSchema,
		elementType: z.literal("rectangle"),
		changes: shapeChangesSchema,
	}),
	z.strictObject({
		type: z.literal("update"),
		id: semanticIdSchema,
		elementType: z.literal("ellipse"),
		changes: shapeChangesSchema,
	}),
	z.strictObject({
		type: z.literal("update"),
		id: semanticIdSchema,
		elementType: z.literal("diamond"),
		changes: shapeChangesSchema,
	}),
	z.strictObject({
		type: z.literal("update"),
		id: semanticIdSchema,
		elementType: z.literal("text"),
		changes: textChangesSchema,
	}),
	z.strictObject({
		type: z.literal("update"),
		id: semanticIdSchema,
		elementType: z.literal("arrow"),
		changes: arrowChangesSchema,
	}),
	z.strictObject({
		type: z.literal("update"),
		id: semanticIdSchema,
		elementType: z.literal("line"),
		changes: lineChangesSchema,
	}),
	z.strictObject({
		type: z.literal("update"),
		id: semanticIdSchema,
		elementType: z.literal("frame"),
		changes: frameChangesSchema,
	}),
]);

const createOperationSchema = z.strictObject({
	type: z.literal("create"),
	element: semanticElementSchema,
});
const deleteOperationSchema = z.strictObject({
	type: z.literal("delete"),
	id: semanticIdSchema,
});

export const semanticOperationSchema = z.union([
	createOperationSchema,
	updateOperationSchema,
	deleteOperationSchema,
]);

export type SemanticOperation = z.infer<typeof semanticOperationSchema>;

function operationTargetId(operation: SemanticOperation): string {
	return operation.type === "create" ? operation.element.id : operation.id;
}

const semanticOperationsSchema = z
	.array(semanticOperationSchema)
	.max(MAX_SEMANTIC_OPERATIONS)
	.superRefine((operations, context) => {
		const targetIds = new Set<string>();
		const createdIds = new Set<string>();
		for (const [index, operation] of operations.entries()) {
			const targetId = operationTargetId(operation);
			if (targetIds.has(targetId)) {
				context.addIssue({
					code: "custom",
					path: [index],
					message: `multiple operations target semantic ID: ${targetId}`,
				});
			} else {
				targetIds.add(targetId);
			}
			if (operation.type !== "create") continue;
			for (const id of [operation.element.id, labelOf(operation.element)?.id]) {
				if (id === undefined) continue;
				if (createdIds.has(id)) {
					addDuplicateIdIssue(context, id, [index, "element", "id"]);
				} else {
					createdIds.add(id);
				}
			}
		}
	});

export const semanticOperationBatchSchema = z.strictObject({
	operations: semanticOperationsSchema,
});

export const semanticCreateRequestSchema = z.strictObject({
	expectedSha256: z.null(),
	scene: semanticSceneSchema,
});

export const semanticApplyRequestSchema = z.strictObject({
	expectedSha256: sha256Schema,
	operations: semanticOperationsSchema,
});

export type SemanticOperationBatch = z.infer<
	typeof semanticOperationBatchSchema
>;
export type SemanticCreateRequest = z.infer<typeof semanticCreateRequestSchema>;
export type SemanticApplyRequest = z.infer<typeof semanticApplyRequestSchema>;

export const semanticImageMetadataSchema = z.strictObject({
	id: semanticIdSchema,
	mimeType: z.string().regex(imageMimeTypePattern),
	width: z.number().int().positive().optional(),
	height: z.number().int().positive().optional(),
	byteEstimate: z.number().int().nonnegative().optional(),
});

export const semanticSceneBoundsSchema = z.strictObject({
	x: coordinateSchema,
	y: coordinateSchema,
	width: z.number().nonnegative().max(MAX_COORDINATE),
	height: z.number().nonnegative().max(MAX_COORDINATE),
});

export const semanticElementTypeSchema = z.enum([
	"rectangle",
	"ellipse",
	"diamond",
	"text",
	"arrow",
	"line",
	"frame",
]);

export const semanticLabelSummarySchema = z.strictObject({
	id: semanticIdSchema,
	text: semanticTextSchema,
});

export const semanticElementSummarySchema = z.strictObject({
	id: semanticIdSchema,
	type: semanticElementTypeSchema,
	label: semanticLabelSummarySchema.optional(),
	groupIds: groupIdsSchema,
	frameId: semanticIdSchema.nullable(),
});

export const semanticConnectionSummarySchema = z.strictObject({
	id: semanticIdSchema,
	startElementId: semanticIdSchema.nullable(),
	endElementId: semanticIdSchema.nullable(),
});

export const semanticElementTypeCountsSchema = z.strictObject({
	rectangle: z.number().int().nonnegative().max(MAX_SEMANTIC_SCENE_ELEMENTS),
	ellipse: z.number().int().nonnegative().max(MAX_SEMANTIC_SCENE_ELEMENTS),
	diamond: z.number().int().nonnegative().max(MAX_SEMANTIC_SCENE_ELEMENTS),
	text: z.number().int().nonnegative().max(MAX_SEMANTIC_SCENE_ELEMENTS),
	arrow: z.number().int().nonnegative().max(MAX_SEMANTIC_SCENE_ELEMENTS),
	line: z.number().int().nonnegative().max(MAX_SEMANTIC_SCENE_ELEMENTS),
	frame: z.number().int().nonnegative().max(MAX_SEMANTIC_SCENE_ELEMENTS),
});

const semanticSceneSummaryBaseSchema = z.strictObject({
	revision: sha256Schema,
	bounds: semanticSceneBoundsSchema,
	elementCount: z.number().int().nonnegative().max(MAX_SEMANTIC_SCENE_ELEMENTS),
	elementTypeCounts: semanticElementTypeCountsSchema,
	elements: z
		.array(semanticElementSummarySchema)
		.max(MAX_SEMANTIC_SCENE_ELEMENTS),
	connections: z
		.array(semanticConnectionSummarySchema)
		.max(MAX_SEMANTIC_SCENE_ELEMENTS),
	images: z.array(semanticImageMetadataSchema).max(MAX_IMAGES),
});

type SemanticSceneSummaryValue = z.infer<typeof semanticSceneSummaryBaseSchema>;
type SemanticElementSummary = z.infer<typeof semanticElementSummarySchema>;
type SemanticElementType = z.infer<typeof semanticElementTypeSchema>;

interface SummaryElementIndex {
	actualCounts: Record<SemanticElementType, number>;
	effectiveElementCount: number;
	elementsById: Map<string, SemanticElementSummary>;
	knownIds: Set<string>;
}

function indexSummaryElements(
	summary: SemanticSceneSummaryValue,
	context: z.RefinementCtx,
): SummaryElementIndex {
	const elementsById = new Map<string, SemanticElementSummary>();
	const knownIds = new Set<string>();
	const actualCounts: Record<SemanticElementType, number> = {
		rectangle: 0,
		ellipse: 0,
		diamond: 0,
		text: 0,
		arrow: 0,
		line: 0,
		frame: 0,
	};
	let effectiveElementCount = summary.elements.length;
	for (const [index, element] of summary.elements.entries()) {
		if (knownIds.has(element.id)) {
			addDuplicateIdIssue(context, element.id, ["elements", index, "id"]);
		} else {
			knownIds.add(element.id);
			elementsById.set(element.id, element);
		}
		actualCounts[element.type] += 1;
		if (element.label === undefined) continue;
		effectiveElementCount += 1;
		actualCounts.text += 1;
		if (knownIds.has(element.label.id)) {
			addDuplicateIdIssue(context, element.label.id, [
				"elements",
				index,
				"label",
				"id",
			]);
		} else {
			knownIds.add(element.label.id);
		}
	}
	return { actualCounts, effectiveElementCount, elementsById, knownIds };
}

function validateSummaryCounts(
	summary: SemanticSceneSummaryValue,
	index: SummaryElementIndex,
	context: z.RefinementCtx,
): void {
	if (summary.elementCount !== index.effectiveElementCount) {
		context.addIssue({
			code: "custom",
			path: ["elementCount"],
			message: "element count must include semantic elements and bound labels",
		});
	}
	for (const type of semanticElementTypeSchema.options) {
		if (summary.elementTypeCounts[type] !== index.actualCounts[type]) {
			context.addIssue({
				code: "custom",
				path: ["elementTypeCounts", type],
				message: `element type count does not match summaries for ${type}`,
			});
		}
	}
}

function validateSummaryReferences(
	summary: SemanticSceneSummaryValue,
	index: SummaryElementIndex,
	context: z.RefinementCtx,
): void {
	for (const [elementIndex, element] of summary.elements.entries()) {
		if (element.frameId === null) continue;
		const frame = index.elementsById.get(element.frameId);
		if (frame?.type !== "frame") {
			context.addIssue({
				code: "custom",
				path: ["elements", elementIndex, "frameId"],
				message: `invalid summary frame reference: ${element.frameId}`,
			});
		}
	}
	const connectionIds = new Set<string>();
	for (const [connectionIndex, connection] of summary.connections.entries()) {
		if (connectionIds.has(connection.id)) {
			addDuplicateIdIssue(context, connection.id, [
				"connections",
				connectionIndex,
				"id",
			]);
		} else {
			connectionIds.add(connection.id);
		}
		const connector = index.elementsById.get(connection.id);
		if (connector?.type !== "arrow") {
			context.addIssue({
				code: "custom",
				path: ["connections", connectionIndex, "id"],
				message: `connection does not reference an arrow: ${connection.id}`,
			});
		}
		for (const key of ["startElementId", "endElementId"] as const) {
			const targetId = connection[key];
			if (targetId !== null && !index.knownIds.has(targetId)) {
				context.addIssue({
					code: "custom",
					path: ["connections", connectionIndex, key],
					message: `unknown connection target: ${targetId}`,
				});
			}
		}
	}
}

function validateSummaryImages(
	summary: SemanticSceneSummaryValue,
	context: z.RefinementCtx,
): void {
	const imageIds = new Set<string>();
	for (const [index, image] of summary.images.entries()) {
		if (imageIds.has(image.id)) {
			addDuplicateIdIssue(context, image.id, ["images", index, "id"]);
		} else {
			imageIds.add(image.id);
		}
	}
}

export const semanticSceneSummarySchema =
	semanticSceneSummaryBaseSchema.superRefine((summary, context) => {
		const index = indexSummaryElements(summary, context);
		validateSummaryCounts(summary, index, context);
		validateSummaryReferences(summary, index, context);
		validateSummaryImages(summary, context);
	});

export type SemanticSceneSummary = z.infer<typeof semanticSceneSummarySchema>;
export type SemanticImageMetadata = z.infer<typeof semanticImageMetadataSchema>;
