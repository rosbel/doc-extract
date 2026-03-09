import { describe, expect, it, vi } from "vitest";
import {
	createSchemaInput,
	schemaAssistRequestInput,
	updateSchemaInput,
} from "../../src/validation/schemas.js";

describe("Schema validation", () => {
	describe("createSchemaInput", () => {
		it("should accept valid input", () => {
			const result = createSchemaInput.parse({
				name: "Invoice",
				description: "An invoice document",
				jsonSchema: {
					type: "object",
					properties: { vendor: { type: "string" } },
				},
				classificationHints: ["invoice", "billing"],
			});
			expect(result.name).toBe("Invoice");
			expect(result.classificationHints).toHaveLength(2);
		});

		it("should default classificationHints to empty array", () => {
			const result = createSchemaInput.parse({
				name: "Test",
				description: "Test schema",
				jsonSchema: { type: "object" },
			});
			expect(result.classificationHints).toEqual([]);
		});

		it("should accept revision metadata", () => {
			const result = createSchemaInput.parse({
				name: "Invoice",
				description: "An invoice document",
				jsonSchema: { type: "object" },
				revision: { source: "ai", summary: "Generated from example files" },
			});
			expect(result.revision?.source).toBe("ai");
		});

		it("should reject empty name", () => {
			expect(() =>
				createSchemaInput.parse({
					name: "",
					description: "Test",
					jsonSchema: {},
				}),
			).toThrow();
		});

		it("should reject missing description", () => {
			expect(() =>
				createSchemaInput.parse({
					name: "Test",
					jsonSchema: {},
				}),
			).toThrow();
		});
	});

	describe("updateSchemaInput", () => {
		it("should accept partial updates", () => {
			const result = updateSchemaInput.parse({ name: "Updated" });
			expect(result.name).toBe("Updated");
			expect(result.description).toBeUndefined();
		});

		it("should accept empty object", () => {
			const result = updateSchemaInput.parse({});
			expect(result).toEqual({});
		});
	});

	describe("schemaAssistRequestInput", () => {
		it("accepts create mode with a prompt", () => {
			const result = schemaAssistRequestInput.parse({
				mode: "create",
				prompt: "Build an invoice schema",
			});
			expect(result.mode).toBe("create");
		});

		it("accepts create mode with files only", () => {
			const result = schemaAssistRequestInput.parse({
				mode: "create",
				hasFiles: true,
			});
			expect(result.hasFiles).toBe(true);
		});

		it("accepts create mode with stored document ids only", () => {
			const result = schemaAssistRequestInput.parse({
				mode: "create",
				documentIds: ["550e8400-e29b-41d4-a716-446655440000"],
			});
			expect(result.documentIds).toEqual([
				"550e8400-e29b-41d4-a716-446655440000",
			]);
		});

		it("requires schemaId in edit mode", () => {
			expect(() =>
				schemaAssistRequestInput.parse({
					mode: "edit",
					prompt: "Add line items",
				}),
			).toThrow(/schemaId is required/i);
		});

		it("requires prompt or files", () => {
			expect(() =>
				schemaAssistRequestInput.parse({
					mode: "create",
				}),
			).toThrow(/provide a prompt, files, documentIds, or a combination/i);
		});
	});
});
