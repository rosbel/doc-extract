import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCreate = vi.fn();
vi.mock("../../src/lib/openrouter.js", () => ({
	getOpenRouterClient: () => ({
		chat: {
			completions: { create: mockCreate },
		},
	}),
}));

import {
	assistSchemaCreation,
	assistSchemaEdit,
	computeSchemaDiff,
} from "../../src/services/schema-assistant.js";

describe("schema assistant", () => {
	beforeEach(() => {
		mockCreate.mockReset();
	});

	it("returns multiple creation proposals", async () => {
		mockCreate.mockResolvedValueOnce({
			choices: [
				{
					message: {
						content: JSON.stringify({
							analysis: "Two distinct document families were found.",
							proposals: [
								{
									name: "Invoice",
									description: "Captures invoice totals and vendor details.",
									jsonSchema: {
										type: "object",
										properties: {
											vendor: {
												type: "string",
												description: "Vendor legal name",
											},
										},
									},
									classificationHints: ["invoice"],
									reasoning: "The examples share invoice terminology.",
									matchingDocuments: ["invoice-1.pdf"],
								},
								{
									name: "Receipt",
									description: "Captures receipt line items.",
									jsonSchema: {
										type: "object",
										properties: {
											storeName: {
												type: "string",
												description: "Merchant name",
											},
										},
									},
									classificationHints: ["receipt"],
									reasoning: "The examples include point-of-sale receipts.",
									matchingDocuments: ["receipt-1.pdf"],
								},
							],
						}),
					},
				},
			],
		});

		const result = await assistSchemaCreation(
			[{ filename: "invoice-1.pdf", text: "Invoice total due" }],
			[],
			"Create the best schemas for these files",
		);

		expect(result.analysis).toContain("document families");
		expect(result.proposals).toHaveLength(2);
		expect(result.proposals[0].jsonSchema).toMatchObject({
			type: "object",
		});
	});

	it("normalizes edit proposals and computes a field diff", async () => {
		mockCreate.mockResolvedValueOnce({
			choices: [
				{
					message: {
						content: JSON.stringify({
							analysis: "The schema needs stronger line-item extraction.",
							proposal: {
								name: "Invoice",
								description: "Captures invoice totals and line items.",
								jsonSchema: JSON.stringify({
									type: "object",
									properties: {
										lineItems: {
											type: "array",
											description: "Invoice line items",
										},
									},
								}),
								classificationHints: ["invoice", "amount due"],
								reasoning: "Sample invoices consistently include tabular charges.",
								matchingDocuments: ["invoice-1.pdf"],
							},
						}),
					},
				},
			],
		});

		const result = await assistSchemaEdit(
			{
				id: "schema-1",
				name: "Invoice",
				description: "Captures invoice totals.",
				version: 1,
				jsonSchema: {
					type: "object",
					properties: {
						total: {
							type: "number",
							description: "Invoice total",
						},
					},
				},
				classificationHints: ["invoice"],
				status: "active",
				createdAt: "2026-03-09T12:00:00.000Z",
				updatedAt: "2026-03-09T12:00:00.000Z",
			},
			[{ filename: "invoice-1.pdf", text: "Widget A 10.00" }],
			"Add repeated charge rows",
		);

		expect(result.proposal.classificationHints).toContain("amount due");
		expect(result.diff.find((entry) => entry.field === "jsonSchema")?.changed).toBe(
			true,
		);
		expect(result.diff.find((entry) => entry.field === "description")?.changed).toBe(
			true,
		);
	});

	it("detects unchanged and changed fields in computeSchemaDiff", () => {
		const diff = computeSchemaDiff(
			{
				name: "Invoice",
				description: "Base description",
				classificationHints: ["invoice"],
				jsonSchema: { type: "object", properties: {} },
			},
			{
				name: "Invoice",
				description: "Updated description",
				classificationHints: ["invoice"],
				jsonSchema: { type: "object", properties: {} },
			},
		);

		expect(diff.find((entry) => entry.field === "name")?.changed).toBe(false);
		expect(diff.find((entry) => entry.field === "description")?.changed).toBe(
			true,
		);
	});
});
