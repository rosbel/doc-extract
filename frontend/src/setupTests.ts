import "@testing-library/jest-dom/vitest";

if (typeof window !== "undefined") {
	globalThis.AbortController = window.AbortController;
	globalThis.AbortSignal = window.AbortSignal;
}
