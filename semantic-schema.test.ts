import { describe, expect, it } from "vitest";
import {
	MAX_SEMANTIC_OPERATIONS,
	MAX_SEMANTIC_SCENE_ELEMENTS,
	MAX_TEXT_CODE_POINTS,
	semanticApplyRequestSchema,
	semanticCreateRequestSchema,
	semanticImageMetadataSchema,
	semanticOperationBatchSchema,
	semanticSceneSchema,
	semanticSceneSummarySchema,
} from "./semantic-schema";

const baseElement = {
	x: 10,
	y: 20,
	width: 160,
	height: 90,
	strokeColor: "#1e1e1e",
	backgroundColor: "#ffffff",
	groupIds: [],
	frameId: null,
} as const;

const rectangle = (id: string) => ({
	...baseElement,
	id,
	type: "rectangle" as const,
});

const label = (id: string, text = "Label") => ({
	id,
	text,
	fontSize: 20,
	color: "#1e1e1e",
});

const allPrimitives = [
	{ ...rectangle("rect-1"), label: label("label-1") },
	{ ...baseElement, id: "ellipse-1", type: "ellipse" as const },
	{ ...baseElement, id: "diamond-1", type: "diamond" as const },
	{
		...baseElement,
		id: "text-1",
		type: "text" as const,
		text: "Standalone text",
		fontSize: 24,
		color: "#0055aa",
	},
	{
		...baseElement,
		id: "arrow-1",
		type: "arrow" as const,
		points: [
			[0, 0],
			[160, 90],
		],
		startBinding: { elementId: "rect-1" },
		endBinding: { elementId: "ellipse-1" },
		label: label("label-2", "Flow"),
	},
	{
		...baseElement,
		id: "line-1",
		type: "line" as const,
		points: [
			[0, 0],
			[80, 45],
			[160, 90],
		],
	},
	{
		...baseElement,
		id: "frame-1",
		type: "frame" as const,
		name: "Main frame",
	},
];

describe("semantic scene schema", () => {
	it("accepts every MVP primitive and explicit labels and bindings", () => {
		expect(
			semanticSceneSchema.parse({ elements: allPrimitives }),
		).toMatchObject({ elements: allPrimitives });
	});

	it("accepts vertical linear elements and rejects degenerate point paths", () => {
		const verticalLine = {
			...allPrimitives[5],
			id: "vertical-line",
			width: 0,
			points: [
				[0, 0],
				[0, 90],
			],
		};
		const degenerateLine = {
			...verticalLine,
			id: "degenerate-line",
			height: 0,
			points: [
				[0, 0],
				[0, 0],
			],
		};
		expect(
			semanticSceneSchema.safeParse({ elements: [verticalLine] }).success,
		).toBe(true);
		expect(
			semanticSceneSchema.safeParse({ elements: [degenerateLine] }).success,
		).toBe(false);
	});

	it("accepts valid group and frame references", () => {
		const scene = {
			elements: [
				{ ...allPrimitives[6] },
				{
					...rectangle("framed-rect"),
					groupIds: ["group-a"],
					frameId: "frame-1",
				},
				{
					...rectangle("grouped-rect"),
					groupIds: ["group-a"],
				},
			],
		};
		expect(semanticSceneSchema.safeParse(scene).success).toBe(true);
	});

	it("rejects duplicate element, label, and cross-kind IDs", () => {
		const duplicateElement = {
			elements: [rectangle("same"), rectangle("same")],
		};
		const duplicateLabel = {
			elements: [
				{ ...rectangle("a"), label: label("label") },
				{ ...rectangle("b"), label: label("label") },
			],
		};
		const elementAndLabel = {
			elements: [{ ...rectangle("same"), label: label("same") }],
		};

		expect(semanticSceneSchema.safeParse(duplicateElement).success).toBe(false);
		expect(semanticSceneSchema.safeParse(duplicateLabel).success).toBe(false);
		expect(semanticSceneSchema.safeParse(elementAndLabel).success).toBe(false);
	});

	it("rejects missing, mistyped, and self binding references", () => {
		const missingFrame = {
			elements: [{ ...rectangle("rect"), frameId: "missing" }],
		};
		const nonFrameTarget = {
			elements: [
				rectangle("target"),
				{ ...rectangle("rect"), frameId: "target" },
			],
		};
		const missingArrowTarget = {
			elements: [
				{
					...allPrimitives[4],
					id: "arrow",
					startBinding: { elementId: "missing" },
					endBinding: null,
					label: undefined,
				},
			],
		};
		const selfBinding = {
			elements: [
				{
					...allPrimitives[4],
					id: "arrow",
					startBinding: { elementId: "arrow" },
					endBinding: null,
					label: undefined,
				},
			],
		};

		expect(semanticSceneSchema.safeParse(missingFrame).success).toBe(false);
		expect(semanticSceneSchema.safeParse(nonFrameTarget).success).toBe(false);
		expect(semanticSceneSchema.safeParse(missingArrowTarget).success).toBe(
			false,
		);
		expect(semanticSceneSchema.safeParse(selfBinding).success).toBe(false);
	});

	it("counts Unicode code points instead of UTF-16 code units", () => {
		const accepted = "😀".repeat(MAX_TEXT_CODE_POINTS);
		const rejected = `${accepted}😀`;
		expect(
			semanticSceneSchema.safeParse({
				elements: [
					{
						...baseElement,
						id: "text",
						type: "text",
						text: accepted,
						fontSize: 20,
						color: "#000000",
					},
				],
			}).success,
		).toBe(true);
		expect(
			semanticSceneSchema.safeParse({
				elements: [
					{
						...baseElement,
						id: "text",
						type: "text",
						text: rejected,
						fontSize: 20,
						color: "#000000",
					},
				],
			}).success,
		).toBe(false);
	});

	it("enforces the effective 10k element limit including bound labels", () => {
		const atLimit = Array.from(
			{ length: MAX_SEMANTIC_SCENE_ELEMENTS },
			(_, index) => rectangle(`element-${index}`),
		);
		expect(semanticSceneSchema.safeParse({ elements: atLimit }).success).toBe(
			true,
		);
		expect(
			semanticSceneSchema.safeParse({
				elements: [
					...atLimit,
					rectangle(`element-${MAX_SEMANTIC_SCENE_ELEMENTS}`),
				],
			}).success,
		).toBe(false);
		expect(
			semanticSceneSchema.safeParse({
				elements: [
					...atLimit.slice(0, -1),
					{
						...rectangle("container"),
						label: label("extra-label"),
					},
				],
			}).success,
		).toBe(false);
	});

	it("accepts transparent fills but rejects malformed IDs, colors, dimensions, and duplicate groups", () => {
		expect(
			semanticSceneSchema.safeParse({
				elements: [
					{ ...rectangle("transparent"), backgroundColor: "transparent" },
				],
			}).success,
		).toBe(true);
		expect(
			semanticSceneSchema.safeParse({
				elements: [{ ...rectangle("bad id"), width: 0 }],
			}).success,
		).toBe(false);
		expect(
			semanticSceneSchema.safeParse({
				elements: [
					{
						...rectangle("rect"),
						strokeColor: "red",
						groupIds: ["group", "group"],
					},
				],
			}).success,
		).toBe(false);
	});
});

describe("semantic operation schemas", () => {
	it("accepts strict create, update, and delete operations", () => {
		const operations = [
			{ type: "create", element: rectangle("new-rect") },
			{
				type: "update",
				id: "text-1",
				elementType: "text",
				changes: { text: "Updated", color: "#112233" },
			},
			{ type: "delete", id: "old-rect" },
		];
		expect(semanticOperationBatchSchema.parse({ operations })).toMatchObject({
			operations,
		});
	});

	it("rejects empty, type-invalid, unknown-key, and duplicate-target updates", () => {
		const emptyUpdate = {
			type: "update",
			id: "rect",
			elementType: "rectangle",
			changes: {},
		};
		const invalidTextUpdate = {
			type: "update",
			id: "text",
			elementType: "text",
			changes: {
				points: [
					[0, 0],
					[1, 1],
				],
			},
		};
		const duplicateTargets = {
			operations: [
				{ type: "delete", id: "same" },
				{
					type: "update",
					id: "same",
					elementType: "rectangle",
					changes: { x: 5 },
				},
			],
		};

		expect(
			semanticOperationBatchSchema.safeParse({ operations: [emptyUpdate] })
				.success,
		).toBe(false);
		expect(
			semanticOperationBatchSchema.safeParse({
				operations: [invalidTextUpdate],
			}).success,
		).toBe(false);
		expect(
			semanticOperationBatchSchema.safeParse({
				operations: [{ type: "delete", id: "rect", force: true }],
			}).success,
		).toBe(false);
		expect(
			semanticOperationBatchSchema.safeParse(duplicateTargets).success,
		).toBe(false);
	});

	it("enforces the 500 operation limit", () => {
		const atLimit = Array.from(
			{ length: MAX_SEMANTIC_OPERATIONS },
			(_, index) => ({
				type: "delete" as const,
				id: `element-${index}`,
			}),
		);
		expect(
			semanticOperationBatchSchema.safeParse({ operations: atLimit }).success,
		).toBe(true);
		expect(
			semanticOperationBatchSchema.safeParse({
				operations: [...atLimit, { type: "delete", id: "one-too-many" }],
			}).success,
		).toBe(false);
	});

	it("requires null SHA for create and a lowercase SHA-256 for apply", () => {
		const sha = "a".repeat(64);
		expect(
			semanticCreateRequestSchema.safeParse({
				expectedSha256: null,
				scene: { elements: [rectangle("rect")] },
			}).success,
		).toBe(true);
		expect(
			semanticCreateRequestSchema.safeParse({
				expectedSha256: sha,
				scene: { elements: [] },
			}).success,
		).toBe(false);
		expect(
			semanticApplyRequestSchema.safeParse({
				expectedSha256: sha,
				operations: [{ type: "delete", id: "rect" }],
			}).success,
		).toBe(true);
		expect(
			semanticApplyRequestSchema.safeParse({
				expectedSha256: "A".repeat(64),
				operations: [],
			}).success,
		).toBe(false);
	});

	it.each([
		"hostId",
		"root",
		"rootPath",
		"force",
		"absolutePath",
		"bytes",
	])("rejects forbidden public authority field %s", (field) => {
		expect(
			semanticCreateRequestSchema.safeParse({
				expectedSha256: null,
				scene: { elements: [] },
				[field]: field === "force" ? true : "/forbidden",
			}).success,
		).toBe(false);
		expect(
			semanticApplyRequestSchema.safeParse({
				expectedSha256: "a".repeat(64),
				operations: [],
				[field]: field === "force" ? true : "/forbidden",
			}).success,
		).toBe(false);
	});
});

describe("semantic read metadata schemas", () => {
	it("accepts bounded summary and image metadata without image bodies", () => {
		const image = {
			id: "image-1",
			mimeType: "image/png",
			width: 640,
			height: 480,
			byteEstimate: 123_456,
		};
		expect(semanticImageMetadataSchema.safeParse(image).success).toBe(true);
		expect(
			semanticSceneSummarySchema.safeParse({
				revision: "b".repeat(64),
				bounds: { x: 0, y: 0, width: 160, height: 90 },
				elementCount: 3,
				elementTypeCounts: {
					rectangle: 1,
					ellipse: 0,
					diamond: 0,
					text: 1,
					arrow: 1,
					line: 0,
					frame: 0,
				},
				elements: [
					{
						id: "rect-1",
						type: "rectangle",
						label: { id: "label-1", text: "Start" },
						groupIds: [],
						frameId: null,
					},
					{
						id: "arrow-1",
						type: "arrow",
						groupIds: [],
						frameId: null,
					},
				],
				connections: [
					{
						id: "arrow-1",
						startElementId: "rect-1",
						endElementId: null,
					},
				],
				images: [image],
			}).success,
		).toBe(true);
	});

	it("rejects inconsistent counts, duplicate summary IDs, and dangling connections", () => {
		const summary = {
			revision: "b".repeat(64),
			bounds: { x: 0, y: 0, width: 10, height: 10 },
			elementCount: 1,
			elementTypeCounts: {
				rectangle: 1,
				ellipse: 0,
				diamond: 0,
				text: 0,
				arrow: 0,
				line: 0,
				frame: 0,
			},
			elements: [
				{
					id: "same",
					type: "rectangle",
					groupIds: [],
					frameId: null,
				},
				{
					id: "same",
					type: "arrow",
					groupIds: [],
					frameId: null,
				},
			],
			connections: [
				{
					id: "missing-arrow",
					startElementId: "missing-target",
					endElementId: null,
				},
			],
			images: [],
		};
		expect(semanticSceneSummarySchema.safeParse(summary).success).toBe(false);
	});

	it.each([
		"data",
		"base64",
		"dataUrl",
		"body",
	])("rejects image body field %s", (field) => {
		expect(
			semanticImageMetadataSchema.safeParse({
				id: "image-1",
				mimeType: "image/png",
				[field]: "aGVsbG8=",
			}).success,
		).toBe(false);
	});
});
