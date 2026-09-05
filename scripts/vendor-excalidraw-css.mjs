import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = resolve(root, "node_modules/@excalidraw/excalidraw/dist/prod");
const sourcePath = resolve(packageRoot, "index.css");
const outputPath = resolve(root, "excalidraw.css");

async function main() {
  try {
    const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
    const excalidrawVersion = packageJson.dependencies["@excalidraw/excalidraw"];
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
      ` * Generated from @excalidraw/excalidraw ${excalidrawVersion} dist/prod/index.css.`,
      " * Assistant fonts are inlined because older BB source builders do not",
      " * configure a .woff2 loader. Regenerate with: npm run vendor:css",
      " */",
      "",
    ].join("\n");
    const expected = `${header}${bundled.trimEnd()}\n`;

    if (process.argv.includes("--check")) {
      const current = await readFile(outputPath, "utf8");
      if (current !== expected) {
        process.stderr.write(
          "excalidraw.css is out of date. Run `npm run vendor:css`, review the result, and commit it.\n",
        );
        process.exitCode = 1;
        return;
      }

      process.stdout.write(
        `excalidraw.css matches @excalidraw/excalidraw ${excalidrawVersion}.\n`,
      );
      return;
    }

    await writeFile(outputPath, expected);
    process.stdout.write(`Wrote ${outputPath} with ${fontUrls.length} inlined fonts.\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to vendor Excalidraw CSS: ${message}`, { cause: error });
  }
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
