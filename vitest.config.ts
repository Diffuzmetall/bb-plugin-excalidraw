import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		silent: "passed-only",
		name: "bb-plugin-excalidraw",
		environment: "jsdom",
		include: ["**/*.test.{ts,tsx}"],
		exclude: ["node_modules/**", "**/*.browser.test.{ts,tsx}"],
	},
});
