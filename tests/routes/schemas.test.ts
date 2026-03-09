import { describe, expect, it, vi } from "vitest";
import {
	createSchemaInput,
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
});
