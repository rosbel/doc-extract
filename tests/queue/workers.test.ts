import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	classifyDocumentMock,
	extractDocumentMock,
	getLatestSchemaRevisionMock,
	enqueueExtractionMock,
	indexDocumentMock,
	documentUpdates,
	activeSchemas,
	mockDb,
} = vi.hoisted(() => {
		const updates: Array<Record<string, unknown>> = [];
		const schemas = [
			{
				id: "schema-1",
				name: "Invoice",
				description: "Invoice schema",
				version: 2,
				jsonSchema: {
					type: "object",
					properties: {
						total: {
							type: "number",
							description: "Total amount",
						},
					},
				},
				classificationHints: ["invoice"],
				status: "active",
				createdAt: new Date(),
				updatedAt: new Date(),
			},
		];

		return {
			classifyDocumentMock: vi.fn(),
			extractDocumentMock: vi.fn(),
			getLatestSchemaRevisionMock: vi.fn(),
			enqueueExtractionMock: vi.fn(),
			indexDocumentMock: vi.fn(),
			documentUpdates: updates,
			activeSchemas: schemas,
			mockDb: {
				update: vi.fn((table) => ({
					set: (values: Record<string, unknown>) => ({
						where: async () => {
							updates.push({ table, values });
							return [];
						},
					}),
				})),
				insert: vi.fn(() => ({
					values: () => ({
						returning: async () => [{ id: "job-1" }],
					}),
				})),
				select: vi.fn(() => ({
					from: () => ({
						where: async () => schemas,
					}),
				})),
				query: {
					documents: {
						findFirst: vi.fn(async () => ({
							id: "doc-1",
							filename: "invoice.pdf",
							rawText: "Invoice total due",
						})),
					},
					schemaRevisions: {
						findFirst: vi.fn(async () => ({
							id: "revision-2",
							schemaId: "schema-1",
							version: 2,
							name: "Invoice",
							description: "Invoice schema",
							jsonSchema: {
								type: "object",
								properties: {
									total: {
										type: "number",
										description: "Total amount",
									},
								},
							},
							classificationHints: ["invoice"],
							source: "manual",
							summary: null,
							createdAt: new Date(),
						})),
					},
				},
			},
		};
	});

vi.mock("bullmq", () => ({
	Worker: class MockWorker {
		on() {
			return this;
		}
	},
}));

vi.mock("../../src/db/index.js", () => ({
	db: mockDb,
}));

vi.mock("../../src/services/classifier.js", () => ({
	classifyDocument: classifyDocumentMock,
}));

vi.mock("../../src/services/extractor.js", () => ({
	extractDocument: extractDocumentMock,
}));

vi.mock("../../src/services/schema-lifecycle.js", () => ({
	getLatestSchemaRevision: getLatestSchemaRevisionMock,
}));

vi.mock("../../src/queue/jobs.js", () => ({
	enqueueExtraction: enqueueExtractionMock,
}));

vi.mock("../../src/services/vector-store.js", () => ({
	indexDocument: indexDocumentMock,
}));

vi.mock("../../src/queue/index.js", () => ({
	redisConnectionOpts: {},
}));

import { handleClassification, handleExtraction } from "../../src/queue/workers.js";

describe("worker schema snapshots", () => {
	beforeEach(() => {
		documentUpdates.length = 0;
		activeSchemas.splice(0, activeSchemas.length, {
			id: "schema-1",
			name: "Invoice",
			description: "Invoice schema",
			version: 2,
			jsonSchema: {
				type: "object",
				properties: {
					total: {
						type: "number",
						description: "Total amount",
					},
				},
			},
			classificationHints: ["invoice"],
			status: "active",
			createdAt: new Date(),
			updatedAt: new Date(),
		});
		classifyDocumentMock.mockReset();
		extractDocumentMock.mockReset();
		getLatestSchemaRevisionMock.mockReset();
		enqueueExtractionMock.mockReset();
		indexDocumentMock.mockReset();
	});

	it("stores schemaVersion and schemaRevisionId after classification", async () => {
		classifyDocumentMock.mockResolvedValue({
			matched: true,
			schemaId: "schema-1",
			confidence: 0.94,
			reasoning: "Invoice keywords matched",
		});
		getLatestSchemaRevisionMock.mockResolvedValue({
			id: "revision-2",
			schemaId: "schema-1",
			version: 2,
		});

		await handleClassification("doc-1");

		expect(getLatestSchemaRevisionMock).toHaveBeenCalledWith(mockDb, "schema-1");
		expect(enqueueExtractionMock).toHaveBeenCalledWith("doc-1", "revision-2");
		expect(
			documentUpdates.some(
				(update) =>
					update.values.schemaId === "schema-1" &&
					update.values.schemaVersion === 2 &&
					update.values.schemaRevisionId === "revision-2",
			),
		).toBe(true);
	});

	it("marks a document unclassified when no schema matches", async () => {
		classifyDocumentMock.mockResolvedValue({
			matched: false,
			schemaId: null,
			confidence: 0.27,
			reasoning: "This document does not fit the configured schemas.",
		});
		getLatestSchemaRevisionMock.mockResolvedValue({
			id: "revision-2",
			schemaId: "schema-1",
			version: 2,
		});

		await handleClassification("doc-1");

		expect(enqueueExtractionMock).not.toHaveBeenCalled();
		expect(
			documentUpdates.some(
				(update) =>
					update.values.status === "unclassified" &&
					update.values.schemaId === null &&
					update.values.schemaRevisionId === null,
			),
		).toBe(true);
	});

	it("skips active schemas without revisions and classifies against the eligible ones", async () => {
		activeSchemas.splice(
			0,
			activeSchemas.length,
			{
				id: "schema-orphan",
				name: "Orphan Schema",
				description: "No revision yet",
				version: 1,
				jsonSchema: { type: "object", properties: {} },
				classificationHints: ["orphan"],
				status: "active",
				createdAt: new Date(),
				updatedAt: new Date(),
			},
			{
				id: "schema-2",
				name: "Resume",
				description: "Resume schema",
				version: 1,
				jsonSchema: { type: "object", properties: {} },
				classificationHints: ["resume"],
				status: "active",
				createdAt: new Date(),
				updatedAt: new Date(),
			},
		);
		getLatestSchemaRevisionMock
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce({
				id: "revision-9",
				schemaId: "schema-2",
				version: 1,
			});
		classifyDocumentMock.mockResolvedValue({
			matched: true,
			schemaId: "schema-2",
			confidence: 0.88,
			reasoning: "Resume keywords matched",
		});

		await handleClassification("doc-1");

		expect(classifyDocumentMock).toHaveBeenCalledWith(
			"Invoice total due",
			[
				expect.objectContaining({
					id: "schema-2",
				}),
			],
		);
		expect(enqueueExtractionMock).toHaveBeenCalledWith("doc-1", "revision-9");
	});

	it("fails clearly when no active schemas have saved revisions", async () => {
		getLatestSchemaRevisionMock.mockResolvedValue(null);

		await expect(handleClassification("doc-1")).rejects.toThrow(
			"No active schemas with saved revisions are available for classification",
		);
		expect(classifyDocumentMock).not.toHaveBeenCalled();
	});

	it("extracts against the frozen schema revision snapshot", async () => {
		extractDocumentMock.mockResolvedValue({
			extractedData: { total: 42 },
			confidence: 0.91,
		});

		await handleExtraction("doc-1", "revision-2");

		expect(extractDocumentMock).toHaveBeenCalledWith(
			"Invoice total due",
			{
				type: "object",
				properties: {
					total: {
						type: "number",
						description: "Total amount",
					},
				},
			},
			"Invoice",
		);
		expect(indexDocumentMock).toHaveBeenCalledWith(
			expect.objectContaining({
				documentId: "doc-1",
				filename: "invoice.pdf",
				rawText: "Invoice total due",
				extractedData: { total: 42 },
				schemaId: "schema-1",
				schemaName: "Invoice",
			}),
		);
		expect(
			documentUpdates.some(
				(update) =>
					typeof update.values.searchText === "string" &&
					update.values.searchText.includes("Invoice total due") &&
					update.values.searchText.includes("total 42"),
			),
		).toBe(true);
	});
});
