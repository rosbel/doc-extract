import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	selectResponses,
	selectMock,
	findSchemaMock,
	searchDocumentMock,
	isSemanticSearchConfiguredMock,
} = vi.hoisted(() => ({
	selectResponses: [] as Array<{ kind: "keyword" | "documents"; rows: unknown[] }>,
	selectMock: vi.fn(() => {
		const next = selectResponses.shift();
		if (!next) {
			throw new Error("No mocked select response configured");
		}

		if (next.kind === "keyword") {
			return {
				from: () => ({
					where: () => ({
						orderBy: () => ({
							limit: async () => next.rows,
						}),
					}),
				}),
			};
		}

		return {
			from: () => ({
				where: async () => next.rows,
			}),
		};
	}),
	findSchemaMock: vi.fn(),
	searchDocumentMock: vi.fn(),
	isSemanticSearchConfiguredMock: vi.fn(),
}));

vi.mock("../../src/db/index.js", () => ({
	db: {
		select: selectMock,
		query: {
			extractionSchemas: {
				findFirst: findSchemaMock,
			},
		},
	},
}));

vi.mock("../../src/services/vector-store.js", () => ({
	searchDocument: searchDocumentMock,
	isSemanticSearchConfigured: isSemanticSearchConfiguredMock,
}));

describe("searchDocuments", () => {
	beforeEach(() => {
		selectResponses.length = 0;
		selectMock.mockClear();
		findSchemaMock.mockReset();
		searchDocumentMock.mockReset();
		isSemanticSearchConfiguredMock.mockReset();
	});

	it("merges semantic and keyword signals into one ranked result list", async () => {
		findSchemaMock.mockResolvedValue({
			id: "schema-1",
			name: "Invoice",
			jsonSchema: { type: "object", properties: { vendor: { type: "string" } } },
		});
		isSemanticSearchConfiguredMock.mockReturnValue(true);
		searchDocumentMock.mockResolvedValue([
			{
				id: "doc-1:header",
				score: 0.9,
				metadata: {
					documentId: "doc-1",
					preview: "Acme invoice for March services",
				},
			},
			{
				id: "doc-1:raw-0",
				score: 0.7,
				metadata: {
					documentId: "doc-1",
					preview: "Invoice total due",
				},
			},
		]);
		selectResponses.push(
			{
				kind: "keyword",
				rows: [{ id: "doc-1", keywordScore: 0.4 }],
			},
			{
				kind: "documents",
				rows: [
					{
						id: "doc-1",
						filename: "invoice.pdf",
						status: "completed",
						schemaId: "schema-1",
						extractionConfidence: 0.93,
						extractedData: { vendor: "Acme Corp", invoiceNumber: "INV-100" },
						searchText: "invoice Acme Corp INV-100",
						rawText: "Invoice total due",
						createdAt: new Date("2026-03-09T12:00:00.000Z"),
					},
				],
			},
		);

		const { searchDocuments } = await import("../../src/services/search.js");
		const response = await searchDocuments({
			query: "acme invoice",
			limit: 10,
			mode: "hybrid",
			schemaId: "schema-1",
		});

		expect(searchDocumentMock).toHaveBeenCalled();
		expect(response.degraded).toBe(false);
		expect(response.results).toHaveLength(1);
		expect(response.results[0]).toMatchObject({
			id: "doc-1",
			filename: "invoice.pdf",
		});
		expect(response.results[0]?.score).toBeGreaterThan(0.7);
		expect(response.results[0]?.matchReasons).toEqual(
			expect.arrayContaining([
				"Semantic match",
				"Schema-filtered",
				"Multi-chunk semantic coverage",
				"High-confidence extraction",
			]),
		);
		expect(response.results[0]?.snippet).toContain("Acme invoice");
	});

	it("returns a degraded hybrid response when semantic search is unavailable", async () => {
		findSchemaMock.mockResolvedValue(null);
		isSemanticSearchConfiguredMock.mockReturnValue(false);
		selectResponses.push(
			{
				kind: "keyword",
				rows: [{ id: "doc-2", keywordScore: 0.8 }],
			},
			{
				kind: "documents",
				rows: [
					{
						id: "doc-2",
						filename: "resume.pdf",
						status: "completed",
						schemaId: null,
						extractionConfidence: 0.72,
						extractedData: { candidate: "Alex" },
						searchText: "resume Alex engineering manager",
						rawText: "engineering manager resume",
						createdAt: new Date("2026-03-09T12:00:00.000Z"),
					},
				],
			},
		);

		const { searchDocuments } = await import("../../src/services/search.js");
		const response = await searchDocuments({
			query: "engineering manager",
			limit: 10,
			mode: "hybrid",
		});

		expect(response.degraded).toBe(true);
		expect(response.degradedReason).toBe("semantic_unavailable");
		expect(response.results[0]?.filename).toBe("resume.pdf");
		expect(searchDocumentMock).not.toHaveBeenCalled();
	});
});
