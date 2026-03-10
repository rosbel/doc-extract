import { describe, expect, it } from "vitest";
import {
	buildSearchChunks,
	buildSearchCorpus,
	buildSemanticQueryText,
	flattenExtractedData,
} from "../../src/services/search-index.js";

describe("search index helpers", () => {
	it("builds a search corpus with schema context and flattened fields", () => {
		const corpus = buildSearchCorpus({
			filename: "invoice.pdf",
			rawText: "Invoice total due on receipt",
			extractedData: {
				vendor: "Acme Corp",
				lineItems: [{ description: "Consulting", amount: 200 }],
			},
			schemaName: "Invoice",
			schemaDescription: "Captures vendor and totals",
			schemaJsonSchema: {
				type: "object",
				properties: {
					vendor: { type: "string" },
					lineItems: {
						type: "array",
						items: {
							type: "object",
							properties: {
								description: { type: "string" },
								amount: { type: "number" },
							},
						},
					},
				},
			},
		});

		expect(corpus).toContain("filename invoice.pdf");
		expect(corpus).toContain("schema Invoice");
		expect(corpus).toContain(
			"schema fields vendor lineItems lineItems[].description lineItems[].amount",
		);
		expect(corpus).toContain("lineItems[0].description Consulting");
		expect(corpus).toContain("Invoice total due on receipt");
	});

	it("chunks raw text with overlap and preserves a header chunk", () => {
		const chunks = buildSearchChunks({
			filename: "invoice.pdf",
			rawText: "A".repeat(2600),
			extractedData: { vendor: "Acme" },
			schemaName: "Invoice",
			schemaJsonSchema: {
				type: "object",
				properties: { vendor: { type: "string" } },
			},
		});

		expect(chunks[0]).toMatchObject({
			idSuffix: "header",
			chunkType: "header",
		});
		expect(
			chunks.filter((chunk) => chunk.chunkType === "raw_text"),
		).toHaveLength(3);
		expect(chunks[1]?.text.length).toBeLessThanOrEqual(1200);
		expect(chunks[2]?.text.length).toBeLessThanOrEqual(1200);
	});

	it("builds schema-aware semantic query text", () => {
		const queryText = buildSemanticQueryText("find invoices for acme", {
			name: "Invoice",
			jsonSchema: {
				type: "object",
				properties: {
					vendor: { type: "string" },
					total: { type: "number" },
				},
			},
		});

		expect(queryText).toContain("schema Invoice");
		expect(queryText).toContain("fields vendor total");
		expect(queryText).toContain("query find invoices for acme");
	});

	it("flattens nested extracted data paths", () => {
		expect(
			flattenExtractedData({
				customer: {
					name: "Acme",
				},
				items: [{ sku: "SKU-1" }],
			}),
		).toEqual(
			expect.arrayContaining([
				{ path: "customer.name", value: "Acme" },
				{ path: "items[0].sku", value: "SKU-1" },
			]),
		);
	});
});
