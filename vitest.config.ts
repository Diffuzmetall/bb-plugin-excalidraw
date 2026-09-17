import { defineConfig } from "vitest/config";

export default defineConfig({
	// Plugin sources import the canonical `@bb/plugin-sdk*` specifier BB supplies at
	// runtime; tests resolve it to the published package that provides the types
	// and the `/testing` helpers.
	resolve: {
		alias: [
			{ find: "@bb/plugin-sdk/app", replacement: "@get-bb/plugin-sdk/app" },
			{ find: "@bb/plugin-sdk", replacement: "@get-bb/plugin-sdk" },
		],
	},
	optimizeDeps: {
		exclude: [
			"@bb/plugin-sdk",
			"@bb/plugin-sdk/app",
			"@get-bb/plugin-sdk",
			"@get-bb/plugin-sdk/app",
		],
	},
	test: {
		silent: "passed-only",
		name: "bb-plugin-excalidraw",
		environment: "jsdom",
		include: ["**/*.test.{ts,tsx}"],
		exclude: ["node_modules/**", "**/*.browser.test.{ts,tsx}"],
	},
});
