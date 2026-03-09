import { beforeEach, describe, expect, it, vi } from "vitest";

const searchDocumentsMock = vi.fn();

vi.mock("../../src/services/search.js", () => ({
	searchDocuments: searchDocumentsMock,
}));

describe("searchRouter", () => {
	beforeEach(() => {
		searchDocumentsMock.mockReset();
	});

	it("defaults requests to hybrid search", async () => {
		const { searchRouter } = await import("../../src/routes/search.js");
		const handler = searchRouter.stack[0]?.route?.stack[0]?.handle as (
			req: { body: unknown },
			res: { json: (body: unknown) => void },
			next: (error?: unknown) => void,
		) => Promise<void>;
		const res = { json: vi.fn() };
		const next = vi.fn();
		searchDocumentsMock.mockResolvedValue({
			mode: "hybrid",
			results: [],
			degraded: false,
		});

		await handler(
			{
				body: { query: "invoice" },
			},
			res,
			next,
		);

		expect(searchDocumentsMock).toHaveBeenCalledWith({
			query: "invoice",
			limit: 10,
			mode: "hybrid",
			schemaId: undefined,
		});
		expect(res.json).toHaveBeenCalledWith({
			mode: "hybrid",
			results: [],
			degraded: false,
		});
		expect(next).not.toHaveBeenCalled();
	});

	it("maps legacy semantic requests onto hybrid search", async () => {
		const { searchRouter } = await import("../../src/routes/search.js");
		const handler = searchRouter.stack[0]?.route?.stack[0]?.handle as (
			req: { body: unknown },
			res: { json: (body: unknown) => void },
			next: (error?: unknown) => void,
		) => Promise<void>;
		const res = { json: vi.fn() };
		const next = vi.fn();
		searchDocumentsMock.mockResolvedValue({
			mode: "hybrid",
			results: [],
			degraded: true,
			degradedReason: "semantic_unavailable",
		});

		await handler(
			{
				body: { query: "invoice", mode: "semantic" },
			},
			res,
			next,
		);

		expect(searchDocumentsMock).toHaveBeenCalledWith({
			query: "invoice",
			limit: 10,
			mode: "hybrid",
			schemaId: undefined,
		});
		expect(next).not.toHaveBeenCalled();
	});
});
