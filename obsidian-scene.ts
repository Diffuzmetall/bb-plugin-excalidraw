import LZString from "lz-string";

const DRAWING_HEADING = /^#{1,2} Drawing\s*$/m;
const DRAWING_BLOCK = /```(compressed-json|json)\s*\r?\n([\s\S]*?)\r?\n```/;

type DrawingBlock = {
	format: "compressed-json" | "json";
	payload: string;
	payloadStart: number;
	payloadEnd: number;
};

function findDrawingBlock(markdown: string): DrawingBlock {
	const heading = DRAWING_HEADING.exec(markdown);
	if (!heading) {
		throw new Error("Drawing block is missing from the Obsidian note");
	}

	const afterHeading = heading.index + heading[0].length;
	const block = DRAWING_BLOCK.exec(markdown.slice(afterHeading));
	if (!block || !block[1] || block[2] === undefined) {
		throw new Error("Drawing block is missing from the Obsidian note");
	}

	const payloadOffset = block[0].indexOf(block[2]);
	const payloadStart = afterHeading + block.index + payloadOffset;
	return {
		format: block[1] as DrawingBlock["format"],
		payload: block[2],
		payloadStart,
		payloadEnd: payloadStart + block[2].length,
	};
}

export function decodeObsidianExcalidrawMarkdown(markdown: string): string {
	const block = findDrawingBlock(markdown);
	if (block.format === "json") return block.payload.trim();

	const decoded = LZString.decompressFromBase64(
		block.payload.replace(/\s+/g, ""),
	);
	if (!decoded) {
		throw new Error("Drawing block contains invalid compressed JSON");
	}
	return decoded;
}

export function encodeObsidianExcalidrawMarkdown(
	markdown: string,
	sceneContent: string,
): string {
	const block = findDrawingBlock(markdown);
	const normalizedScene = sceneContent.trim();
	const payload =
		block.format === "compressed-json"
			? LZString.compressToBase64(normalizedScene)
			: normalizedScene;
	return `${markdown.slice(0, block.payloadStart)}${payload}${markdown.slice(block.payloadEnd)}`;
}
