import { describe, expect, it } from "vitest";
import { documentQueryInput } from "../../src/validation/schemas.js";

describe("Document query validation", () => {
	it("should accept valid query params", () => {
		const result = documentQueryInput.parse({
			status: "completed",
			page: "2",
			limit: "10",
		});
		expect(result.status).toBe("completed");
		expect(result.page).toBe(2);
		expect(result.limit).toBe(10);
	});

	it("should default page to 1 and limit to 20", () => {
		const result = documentQueryInput.parse({});
		expect(result.page).toBe(1);
		expect(result.limit).toBe(20);
	});

	it("should reject invalid status", () => {
		expect(() => documentQueryInput.parse({ status: "invalid" })).toThrow();
	});

	it("should coerce string page to number", () => {
		const result = documentQueryInput.parse({ page: "5" });
		expect(result.page).toBe(5);
	});

	it("should reject limit over 100", () => {
		expect(() => documentQueryInput.parse({ limit: "200" })).toThrow();
	});

	it("should accept schemaId as UUID", () => {
		const result = documentQueryInput.parse({
			schemaId: "550e8400-e29b-41d4-a716-446655440000",
		});
		expect(result.schemaId).toBe("550e8400-e29b-41d4-a716-446655440000");
	});
});
