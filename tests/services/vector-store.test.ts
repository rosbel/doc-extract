import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.fn();
const upsertMock = vi.fn();
const indexMock = vi.fn(() => ({
	query: queryMock,
	upsert: upsertMock,
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

describe("vector store", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.stubEnv("PINECONE_API_KEY", "test-pinecone-key");
		vi.stubEnv("OPENROUTER_API_KEY", "test-openrouter-key");
		embeddingsCreateMock.mockResolvedValue({
			data: [{ embedding: [0.1, 0.2, 0.3] }],
		});
		queryMock.mockResolvedValue({
			matches: [
				{
					id: "doc-1:header",
					score: 0.91,
					metadata: { documentId: "doc-1", filename: "invoice.pdf" },
				},
			],
		});
		upsertMock.mockResolvedValue(undefined);
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		vi.clearAllMocks();
	});

	it("passes the schema filter through to Pinecone queries", async () => {
		const { searchDocument } = await import(
			"../../src/services/vector-store.js"
		);

		const results = await searchDocument("invoice", 5, {
			schemaId: "schema-123",
			schemaName: "Invoice",
			schemaJsonSchema: {
				type: "object",
				properties: { vendor: { type: "string" } },
			},
		});

		expect(queryMock).toHaveBeenCalledWith(
			expect.objectContaining({
				topK: 5,
				filter: { schemaId: { $eq: "schema-123" } },
			}),
		);
		expect(results).toHaveLength(1);
		expect(results[0]?.id).toBe("doc-1:header");
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

	it("indexes a header chunk and raw text chunks for each document", async () => {
		const { indexDocument } = await import("../../src/services/vector-store.js");

		await indexDocument({
			documentId: "doc-1",
			filename: "invoice.pdf",
			rawText: "A".repeat(2600),
			extractedData: { vendor: "Acme" },
			schemaId: "schema-1",
			schemaName: "Invoice",
			schemaDescription: "Invoice schema",
			schemaJsonSchema: {
				type: "object",
				properties: { vendor: { type: "string" } },
			},
		});

		expect(upsertMock).toHaveBeenCalledTimes(1);
		const upsertArg = upsertMock.mock.calls[0]?.[0];
		expect(upsertArg).toHaveLength(4);
		expect(upsertArg[0]).toMatchObject({
			id: "doc-1:header",
			metadata: expect.objectContaining({
				documentId: "doc-1",
				schemaId: "schema-1",
				chunkType: "header",
			}),
		});
		expect(upsertArg[1]?.id).toBe("doc-1:raw-0");
	});
});
