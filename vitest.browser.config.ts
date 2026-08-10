import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		name: "bb-plugin-excalidraw-browser",
		include: ["scene-adapter.browser.test.ts", "app.browser.test.tsx"],
		exclude: ["node_modules/**"],
		browser: {
			enabled: true,
			headless: true,
			provider: playwright(),
			instances: [{ browser: "chromium" }],
		},
	},
});
