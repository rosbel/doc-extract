import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	createSchemaWithRevision,
	restoreSchemaRevision,
	updateSchemaWithRevision,
} from "../../src/services/schema-lifecycle.js";
import { extractionSchemas, schemaRevisions } from "../../src/db/schema.js";

function createLifecycleDb() {
	const schemas: Array<Record<string, unknown>> = [];
	const revisions: Array<Record<string, unknown>> = [];
	const extractionSchemaFindFirst = vi.fn();
	const schemaRevisionFindFirst = vi.fn();

	const db = {
		insert: vi.fn((table) => ({
			values: (value: Record<string, unknown>) => ({
				returning: async () => {
					if (table === extractionSchemas) {
						const row = {
							id: `schema-${schemas.length + 1}`,
							version: 1,
							status: "active",
							createdAt: new Date(),
							updatedAt: new Date(),
							...value,
						};
						schemas.push(row);
						return [row];
					}

					const row = {
						id: `revision-${revisions.length + 1}`,
						createdAt: new Date(),
						...value,
					};
					revisions.push(row);
					return [row];
				},
			}),
		})),
		update: vi.fn((table) => ({
			set: (value: Record<string, unknown>) => ({
				where: () => ({
					returning: async () => {
						if (table !== extractionSchemas || schemas.length === 0) {
							return [];
						}

						const updated = {
							...schemas[0],
							...value,
						};
						schemas[0] = updated;
						return [updated];
					},
				}),
			}),
		})),
		select: vi.fn(() => ({
			from: () => ({
				where: () => ({
					orderBy: async () => [...revisions].sort((left, right) =>
						Number(right.version) - Number(left.version),
					),
				}),
			}),
		})),
		query: {
			extractionSchemas: {
				findFirst: extractionSchemaFindFirst,
			},
			schemaRevisions: {
				findFirst: schemaRevisionFindFirst,
			},
		},
	};

	return { db, schemas, revisions, extractionSchemaFindFirst, schemaRevisionFindFirst };
}

describe("schema lifecycle", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("creates the live schema row and its first revision", async () => {
		const { db, schemas, revisions } = createLifecycleDb();

		const result = await createSchemaWithRevision(db as never, {
			name: "Invoice",
			description: "Captures invoice totals",
			jsonSchema: { type: "object", properties: {} },
			classificationHints: ["invoice"],
			revision: {
				source: "ai",
				summary: "Generated from examples",
			},
		});

		expect(result.schema.version).toBe(1);
		expect(schemas).toHaveLength(1);
		expect(revisions).toHaveLength(1);
		expect(revisions[0]).toMatchObject({
			schemaId: result.schema.id,
			version: 1,
			source: "ai",
			summary: "Generated from examples",
		});
	});

	it("updates a schema in place and appends a new revision", async () => {
		const { db, schemas, revisions, extractionSchemaFindFirst } = createLifecycleDb();
		schemas.push({
			id: "schema-1",
			name: "Invoice",
			description: "Captures invoice totals",
			version: 1,
			jsonSchema: { type: "object", properties: {} },
			classificationHints: ["invoice"],
			status: "active",
			createdAt: new Date(),
			updatedAt: new Date(),
		});
		extractionSchemaFindFirst.mockResolvedValue(schemas[0]);

		const result = await updateSchemaWithRevision(db as never, "schema-1", {
			description: "Captures invoice totals and line items",
			revision: {
				source: "manual",
				summary: "Added line item support",
			},
		});

		expect(result?.schema.version).toBe(2);
		expect(schemas[0].description).toBe("Captures invoice totals and line items");
		expect(revisions).toHaveLength(1);
		expect(revisions[0]).toMatchObject({
			schemaId: "schema-1",
			version: 2,
			summary: "Added line item support",
		});
	});

	it("restores a prior revision by creating a new current version", async () => {
		const {
			db,
			schemas,
			revisions,
			extractionSchemaFindFirst,
			schemaRevisionFindFirst,
		} = createLifecycleDb();
		schemas.push({
			id: "schema-1",
			name: "Invoice",
			description: "Latest description",
			version: 2,
			jsonSchema: { type: "object", properties: {} },
			classificationHints: ["invoice"],
			status: "active",
			createdAt: new Date(),
			updatedAt: new Date(),
		});
		extractionSchemaFindFirst.mockResolvedValue(schemas[0]);
		schemaRevisionFindFirst.mockResolvedValue({
			id: "revision-1",
			schemaId: "schema-1",
			version: 1,
			name: "Invoice",
			description: "Original description",
			jsonSchema: { type: "object", properties: {} },
			classificationHints: ["invoice"],
			source: "manual",
			summary: "Original version",
			createdAt: new Date(),
		});

		const restored = await restoreSchemaRevision(
			db as never,
			"schema-1",
			"revision-1",
		);

		expect(restored?.schema.version).toBe(3);
		expect(restored?.schema.description).toBe("Original description");
		expect(revisions[0]).toMatchObject({
			version: 3,
			source: "restore",
			summary: "Restored from version 1",
		});
	});
});
