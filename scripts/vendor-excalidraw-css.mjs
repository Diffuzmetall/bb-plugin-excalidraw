import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = resolve(root, "node_modules/@excalidraw/excalidraw/dist/prod");
const sourcePath = resolve(packageRoot, "index.css");
const outputPath = resolve(root, "excalidraw.css");
const source = await readFile(sourcePath, "utf8");
const fontUrls = [
  ...new Set(
    [...source.matchAll(/url\(["']?(\.\/fonts\/Assistant\/[^"')]+\.woff2)["']?\)/g)].map(
      (match) => match[1],
    ),
  ),
];

let bundled = source;
for (const fontUrl of fontUrls) {
  const font = await readFile(resolve(packageRoot, fontUrl));
  const dataUrl = `data:font/woff2;base64,${font.toString("base64")}`;
  bundled = bundled.replaceAll(`url("${fontUrl}")`, `url("${dataUrl}")`);
}

const header = [
  "/*",
  " * Generated from @excalidraw/excalidraw 0.18.1 dist/prod/index.css.",
  " * Assistant fonts are inlined because older BB source builders do not",
  " * configure a .woff2 loader. Regenerate with: npm run vendor:css",
  " */",
  "",
].join("\n");
await writeFile(outputPath, `${header}${bundled.trimEnd()}\n`);
console.log(`Wrote ${outputPath} with ${fontUrls.length} inlined fonts.`);
