import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.fn();
const indexMock = vi.fn(() => ({
	query: queryMock,
	upsert: vi.fn(),
}));
const embeddingsCreateMock = vi.fn();

vi.mock("@pinecone-database/pinecone", () => ({
	Pinecone: vi.fn().mockImplementation(() => ({
		Index: indexMock,
	})),
}));

vi.mock("../../src/lib/openrouter.js", () => ({
	getOpenRouterClient: () => ({
		embeddings: {
			create: embeddingsCreateMock,
		},
	}),
}));

describe("searchDocument", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.stubEnv("PINECONE_API_KEY", "test-pinecone-key");
		vi.stubEnv("OPENROUTER_API_KEY", "test-openrouter-key");
		embeddingsCreateMock.mockResolvedValue({
			data: [{ embedding: [0.1, 0.2, 0.3] }],
		});
		queryMock.mockResolvedValue({
			matches: [
				{ id: "doc-1", score: 0.91, metadata: { filename: "invoice.pdf" } },
			],
		});
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		vi.clearAllMocks();
	});

	it("passes the schema filter through to Pinecone queries", async () => {
		const { searchDocument } = await import(
			"../../src/services/vector-store.js"
		);

		const results = await searchDocument("invoice", 5, "schema-123");

		expect(queryMock).toHaveBeenCalledWith(
			expect.objectContaining({
				topK: 5,
				filter: { schemaId: { $eq: "schema-123" } },
			}),
		);
		expect(results).toHaveLength(1);
		expect(results[0]?.id).toBe("doc-1");
	});

	it("omits the filter when schemaId is not provided", async () => {
		const { searchDocument } = await import(
			"../../src/services/vector-store.js"
		);

		await searchDocument("invoice", 3);

		expect(queryMock).toHaveBeenCalledWith(
			expect.not.objectContaining({
				filter: expect.anything(),
			}),
		);
	});
});
