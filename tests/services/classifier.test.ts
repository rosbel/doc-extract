import { describe, expect, it, vi } from "vitest";

// Mock OpenRouter client
const mockCreate = vi.fn();
vi.mock("../../src/lib/openrouter.js", () => ({
	getOpenRouterClient: () => ({
		chat: {
			completions: { create: mockCreate },
		},
	}),
}));

import { classifyDocument } from "../../src/services/classifier.js";
import type { ExtractionSchema } from "../../src/types/index.js";

const mockSchemas: ExtractionSchema[] = [
	{
		id: "schema-1",
		name: "Invoice",
		description: "An invoice document",
		version: 1,
		jsonSchema: { type: "object", properties: { vendor: { type: "string" } } },
		classificationHints: ["invoice", "billing"],
		status: "active",
		createdAt: new Date(),
		updatedAt: new Date(),
	},
	{
		id: "schema-2",
		name: "Resume",
		description: "A resume or CV",
		version: 1,
		jsonSchema: { type: "object", properties: { name: { type: "string" } } },
		classificationHints: ["resume", "cv"],
		status: "active",
		createdAt: new Date(),
		updatedAt: new Date(),
	},
];

describe("classifyDocument", () => {
	it("should return classification result from LLM", async () => {
		mockCreate.mockResolvedValueOnce({
			choices: [
				{
					message: {
						content: JSON.stringify({
							schemaId: "schema-1",
							confidence: 0.95,
							reasoning: "Contains invoice-related terms",
						}),
					},
				},
			],
		});

		const result = await classifyDocument(
			"Invoice from Acme Corp for $500",
			mockSchemas,
		);

		expect(result.schemaId).toBe("schema-1");
		expect(result.confidence).toBe(0.95);
		expect(result.reasoning).toBeTruthy();
		expect(mockCreate).toHaveBeenCalledOnce();
	});

	it("should truncate text to 8000 characters", async () => {
		const longText = "x".repeat(10000);
		mockCreate.mockResolvedValueOnce({
			choices: [
				{
					message: {
						content: JSON.stringify({
							schemaId: "schema-2",
							confidence: 0.8,
							reasoning: "Best guess",
						}),
					},
				},
			],
		});

		await classifyDocument(longText, mockSchemas);

		const call = mockCreate.mock.calls[0][0];
		const userMessage = call.messages.find(
			(m: { role: string }) => m.role === "user",
		);
		expect(userMessage.content.length).toBeLessThan(10000);
	});

	it("should throw on empty LLM response", async () => {
		mockCreate.mockResolvedValueOnce({
			choices: [{ message: { content: null } }],
		});

		await expect(classifyDocument("test doc", mockSchemas)).rejects.toThrow(
			"No response from LLM",
		);
	});
});
