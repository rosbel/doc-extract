import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [react()],
	server: {
		port: 5173,
		proxy: {
			"/api": "http://localhost:3001",
			"/health": "http://localhost:3001",
		},
	},
	test: {
		environment: "jsdom",
		setupFiles: "./src/setupTests.ts",
	},
});
