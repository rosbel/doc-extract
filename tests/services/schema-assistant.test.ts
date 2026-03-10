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

const currentSchema = {
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
};

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

	it("skips malformed creation proposals instead of throwing", async () => {
		mockCreate.mockResolvedValueOnce({
			choices: [
				{
					message: {
						content: JSON.stringify({
							analysis: "One candidate was malformed, one was usable.",
							proposals: [
								{
									name: "Broken proposal",
									description: "Missing a usable schema payload.",
									jsonSchema: "not-json",
									classificationHints: ["broken"],
									reasoning: "This should be ignored.",
									matchingDocuments: ["broken.csv"],
								},
								{
									name: "RSVP List",
									description: "Captures event RSVPs and guest counts.",
									jsonSchema: {
										type: "object",
										properties: {
											guestName: {
												type: "string",
												description: "Guest name",
											},
										},
									},
									classificationHints: ["rsvp", "guest list"],
									reasoning: "The upload is a structured RSVP export.",
									matchingDocuments: ["rsvp.csv"],
								},
							],
						}),
					},
				},
			],
		});

		const result = await assistSchemaCreation(
			[{ filename: "rsvp.csv", text: "Name,Attending\nAriela,Yes" }],
			[],
		);

		expect(result.analysis).toContain("malformed");
		expect(result.proposals).toHaveLength(1);
		expect(result.proposals[0]).toMatchObject({
			name: "RSVP List",
			classificationHints: ["rsvp", "guest list"],
		});
	});

	it("accepts a bare proposal object for creation responses", async () => {
		mockCreate.mockResolvedValueOnce({
			choices: [
				{
					message: {
						content: JSON.stringify({
							name: "RSVP List",
							description: "Captures event RSVPs and guest counts.",
							jsonSchema: {
								type: "object",
								properties: {
									guestName: {
										type: "string",
										description: "Guest name",
									},
								},
							},
							classificationHints: ["rsvp", "guest list"],
							reasoning: "The upload is a structured RSVP export.",
							matchingDocuments: ["rsvp.csv"],
						}),
					},
				},
			],
		});

		const result = await assistSchemaCreation(
			[{ filename: "rsvp.csv", text: "Name,Attending\nAriela,Yes" }],
			[],
		);

		expect(result.analysis).toBe("");
		expect(result.proposals).toHaveLength(1);
		expect(result.proposals[0].name).toBe("RSVP List");
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
			currentSchema,
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

	it("accepts a bare top-level edit proposal object", async () => {
		mockCreate.mockResolvedValueOnce({
			choices: [
				{
					message: {
						content: JSON.stringify({
							name: "Invoice",
							description: "Captures invoice totals and due dates.",
							jsonSchema: {
								type: "object",
								properties: {
									total: {
										type: "number",
										description: "Invoice total",
									},
									dueDate: {
										type: "string",
										description: "Invoice due date",
									},
								},
							},
							classificationHints: ["invoice", "due date"],
							reasoning: "The examples consistently include payment deadlines.",
							matchingDocuments: ["invoice-2.pdf"],
						}),
					},
				},
			],
		});

		const result = await assistSchemaEdit(
			currentSchema,
			[{ filename: "invoice-2.pdf", text: "Due date 2026-03-12" }],
			"Add due dates",
		);

		expect(result.proposal.description).toContain("due dates");
		expect(result.diff.find((entry) => entry.field === "jsonSchema")?.changed).toBe(
			true,
		);
	});

	it("merges partial edit proposals with the current schema", async () => {
		mockCreate.mockResolvedValueOnce({
			choices: [
				{
					message: {
						content: JSON.stringify({
							analysis: "Only the schema body needs to change.",
							proposal: {
								jsonSchema: {
									type: "object",
									properties: {
										total: {
											type: "number",
											description: "Invoice total",
										},
										lineItems: {
											type: "array",
											description: "Invoice line items",
										},
									},
								},
								reasoning: "The sample adds repeated charges.",
							},
						}),
					},
				},
			],
		});

		const result = await assistSchemaEdit(
			currentSchema,
			[{ filename: "invoice-1.pdf", text: "Widget A 10.00" }],
			"Add line items",
		);

		expect(result.proposal.name).toBe(currentSchema.name);
		expect(result.proposal.description).toBe(currentSchema.description);
		expect(result.proposal.classificationHints).toEqual(
			currentSchema.classificationHints,
		);
		expect(result.diff.find((entry) => entry.field === "jsonSchema")?.changed).toBe(
			true,
		);
	});

	it("normalizes alias fields for edit responses", async () => {
		mockCreate.mockResolvedValueOnce({
			choices: [
				{
					message: {
						content: JSON.stringify({
							analysis: "Alias-based fields were returned.",
							proposals: [
								{
									title: "Invoice",
									description: "Captures invoice totals and service charges.",
									json_schema: JSON.stringify({
										type: "object",
										properties: {
											total: {
												type: "number",
												description: "Invoice total",
											},
											serviceCharges: {
												type: "array",
												description: "Additional service fees",
											},
										},
									}),
									classification_hints: ["invoice", "service charge"],
									rationale: "The provider used alternate field names.",
									matching_documents: ["invoice-3.pdf"],
								},
							],
						}),
					},
				},
			],
		});

		const result = await assistSchemaEdit(
			currentSchema,
			[{ filename: "invoice-3.pdf", text: "Service charge 18.00" }],
			"Track service charges",
		);

		expect(result.proposal.classificationHints).toContain("service charge");
		expect(result.proposal.reasoning).toContain("alternate field names");
		expect(result.proposal.matchingDocuments).toEqual(["invoice-3.pdf"]);
	});

	it("treats no-op edit responses as successful with an unchanged diff", async () => {
		mockCreate.mockResolvedValueOnce({
			choices: [
				{
					message: {
						content: JSON.stringify({
							analysis: "The current schema already covers the request.",
							proposal: {
								reasoning: "No additional fields are needed for these samples.",
							},
						}),
					},
				},
			],
		});

		const result = await assistSchemaEdit(
			currentSchema,
			[{ filename: "invoice-4.pdf", text: "Invoice total 42.00" }],
			"Review the current schema",
		);

		expect(result.proposal.name).toBe(currentSchema.name);
		expect(result.diff.every((entry) => entry.changed === false)).toBe(true);
	});

	it("returns a controlled error when edit output is unusable", async () => {
		mockCreate.mockResolvedValueOnce({
			choices: [
				{
					message: {
						content: JSON.stringify({
							analysis: "The assistant could not produce a valid revision.",
							proposal: {
								name: "",
								description: "",
								jsonSchema: "not-json",
								classificationHints: [],
								reasoning: "",
								matchingDocuments: [],
							},
						}),
					},
				},
			],
		});

		await expect(
			assistSchemaEdit(
				currentSchema,
				[{ filename: "invoice-1.pdf", text: "Widget A 10.00" }],
				"Add repeated charge rows",
			),
		).rejects.toMatchObject({
			message:
				"AI returned an unusable schema revision. Please try again with more guidance or different files.",
			statusCode: 502,
		});
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
