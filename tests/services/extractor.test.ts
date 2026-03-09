import { describe, expect, it, vi } from "vitest";

const mockCreate = vi.fn();
vi.mock("../../src/lib/openrouter.js", () => ({
	getOpenRouterClient: () => ({
		chat: {
			completions: { create: mockCreate },
		},
	}),
}));

import { extractDocument } from "../../src/services/extractor.js";

describe("extractDocument", () => {
	it("should return extracted data from LLM", async () => {
		mockCreate.mockResolvedValueOnce({
			choices: [
				{
					message: {
						content: JSON.stringify({
							extractedData: { vendor: "Acme", amount: 500 },
							confidence: 0.9,
						}),
					},
				},
			],
		});

		const result = await extractDocument(
			"Invoice from Acme Corp. Total: $500",
			{
				type: "object",
				properties: { vendor: { type: "string" }, amount: { type: "number" } },
			},
			"Invoice",
		);

		expect(result.extractedData.vendor).toBe("Acme");
		expect(result.extractedData.amount).toBe(500);
		expect(result.confidence).toBe(0.9);
	});

	it("should normalize schema with additionalProperties and required", async () => {
		mockCreate.mockResolvedValueOnce({
			choices: [
				{
					message: {
						content: JSON.stringify({
							extractedData: { name: "John" },
							confidence: 0.85,
						}),
					},
				},
			],
		});

		await extractDocument(
			"Resume: John Doe",
			{ type: "object", properties: { name: { type: "string" } } },
			"Resume",
		);

		const call = mockCreate.mock.lastCall?.[0];
		if (!call) {
			throw new Error("Expected LLM call");
		}
		const jsonSchema = call.response_format.json_schema.schema;
		expect(jsonSchema.additionalProperties).toBe(false);
		expect(jsonSchema.required).toContain("extractedData");
		expect(jsonSchema.required).toContain("confidence");

		// Check the nested user schema is also normalized
		expect(jsonSchema.properties.extractedData.additionalProperties).toBe(
			false,
		);
		expect(jsonSchema.properties.extractedData.required).toContain("name");
	});

	it("should truncate document text before sending it to the LLM", async () => {
		mockCreate.mockResolvedValueOnce({
			choices: [
				{
					message: {
						content: JSON.stringify({
							extractedData: { name: "John" },
							confidence: 0.7,
						}),
					},
				},
			],
		});

		await extractDocument(
			"x".repeat(10000),
			{ type: "object", properties: { name: { type: "string" } } },
			"Resume",
		);

		const call = mockCreate.mock.lastCall?.[0];
		if (!call) {
			throw new Error("Expected LLM call");
		}
		const userMessage = call.messages.find(
			(message: { role: string }) => message.role === "user",
		);
		expect(userMessage.content.length).toBeLessThan(10000);
	});

	it("should throw on empty LLM response", async () => {
		mockCreate.mockResolvedValueOnce({
			choices: [{ message: { content: null } }],
		});

		await expect(
			extractDocument("test", { type: "object", properties: {} }, "Test"),
		).rejects.toThrow("No response from LLM");
	});
});
