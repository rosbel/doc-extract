import { existsSync, unlinkSync } from "node:fs";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const unlinkMock = vi.fn();
const parseFileSafeMock = vi.fn();
const assistSchemaCreationMock = vi.fn();
const assistSchemaEditMock = vi.fn();
const selectMock = vi.fn();
const fromMock = vi.fn();
const whereMock = vi.fn();
const documentsFindManyMock = vi.fn();
const extractionSchemaFindFirstMock = vi.fn();

vi.mock("node:fs/promises", async (importActual) => {
	const actual = await importActual<typeof import("node:fs/promises")>();
	return {
		...actual,
		unlink: unlinkMock,
	};
});

vi.mock("../../src/db/index.js", () => ({
	db: {
		select: selectMock,
		query: {
			documents: {
				findMany: documentsFindManyMock,
			},
			extractionSchemas: {
				findFirst: extractionSchemaFindFirstMock,
			},
		},
	},
}));

vi.mock("../../src/services/file-parser.js", () => ({
	parseFileSafe: parseFileSafeMock,
}));

vi.mock("../../src/services/schema-assistant.js", () => ({
	assistSchemaCreation: assistSchemaCreationMock,
	assistSchemaEdit: assistSchemaEditMock,
}));

describe("schemasRouter uploads", () => {
	async function createApp() {
		vi.resetModules();
		process.env.UPLOAD_DIR = "./uploads/test-schemas-routes";
		process.env.MAX_FILE_SIZE = String(10 * 1024 * 1024);

		const express = (await import("express")).default;
		const { schemasRouter } = await import("../../src/routes/schemas.js");
		const { errorHandler } = await import("../../src/middleware/error-handler.js");

		const app = express();
		app.use("/api/schemas", schemasRouter);
		app.use(errorHandler);
		return app;
	}

	beforeEach(() => {
		unlinkMock.mockReset();
		parseFileSafeMock.mockReset();
		assistSchemaCreationMock.mockReset();
		assistSchemaEditMock.mockReset();
		selectMock.mockReset();
		fromMock.mockReset();
		whereMock.mockReset();
		documentsFindManyMock.mockReset();
		extractionSchemaFindFirstMock.mockReset();

		selectMock.mockReturnValue({ from: fromMock });
		fromMock.mockReturnValue({ where: whereMock });
		whereMock.mockResolvedValue([]);
		documentsFindManyMock.mockResolvedValue([]);
		extractionSchemaFindFirstMock.mockResolvedValue({
			id: "550e8400-e29b-41d4-a716-446655440010",
			name: "Invoice",
			description: "Captures invoice totals",
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
		});
		unlinkMock.mockResolvedValue(undefined);
		parseFileSafeMock
			.mockResolvedValueOnce({ quality: "good", text: "Invoice 1" })
			.mockResolvedValueOnce({ quality: "good", text: "Invoice 2" });
		assistSchemaCreationMock.mockResolvedValue({
			name: "Invoice",
			description: "Generated schema",
		});
	});

	afterEach(() => {
		for (const [filePath] of unlinkMock.mock.calls as Array<[string]>) {
			if (existsSync(filePath)) {
				unlinkSync(filePath);
			}
		}
	});

	it("accepts multi-file schema assist uploads and cleans up temp files", async () => {
		const app = await createApp();

		const response = await request(app)
			.post("/api/schemas/assist")
			.field("mode", "create")
			.attach("files", Buffer.from("one"), "invoice-1.txt")
			.attach("files", Buffer.from("two"), "invoice-2.txt");

		expect(response.status).toBe(200);
		expect(response.body).toMatchObject({
			name: "Invoice",
			description: "Generated schema",
		});
		expect(parseFileSafeMock).toHaveBeenCalledTimes(2);
		expect(assistSchemaCreationMock).toHaveBeenCalledWith(
			[
				{ filename: "invoice-1.txt", text: "Invoice 1" },
				{ filename: "invoice-2.txt", text: "Invoice 2" },
			],
			[],
			undefined,
		);
		expect(unlinkMock).toHaveBeenCalledTimes(2);
	});

	it("accepts stored document ids for create-mode assist", async () => {
		const app = await createApp();
		documentsFindManyMock.mockResolvedValue([
			{
				id: "550e8400-e29b-41d4-a716-446655440000",
				filename: "brochure.pdf",
				rawText: "Vacation package details",
			},
		]);

		const response = await request(app)
			.post("/api/schemas/assist")
			.field("mode", "create")
			.field("documentIds", "550e8400-e29b-41d4-a716-446655440000");

		expect(response.status).toBe(200);
		expect(assistSchemaCreationMock).toHaveBeenCalledWith(
			[{ filename: "brochure.pdf", text: "Vacation package details" }],
			[],
			undefined,
		);
	});

	it("accepts prompt-only edit assist requests", async () => {
		const app = await createApp();
		assistSchemaEditMock.mockResolvedValue({
			analysis: "No changes required.",
			proposal: {
				name: "Invoice",
				description: "Captures invoice totals",
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
				reasoning: "The current schema already covers the prompt.",
				matchingDocuments: [],
			},
			diff: [
				{
					field: "name",
					label: "Name",
					changed: false,
					before: "Invoice",
					after: "Invoice",
				},
			],
		});

		const response = await request(app)
			.post("/api/schemas/assist")
			.field("mode", "edit")
			.field("schemaId", "550e8400-e29b-41d4-a716-446655440010")
			.field("prompt", "Review the current invoice schema");

		expect(response.status).toBe(200);
		expect(assistSchemaEditMock).toHaveBeenCalledWith(
			expect.objectContaining({
				id: "550e8400-e29b-41d4-a716-446655440010",
			}),
			[],
			"Review the current invoice schema",
		);
		expect(response.body.diff).toEqual([
			expect.objectContaining({
				field: "name",
				changed: false,
			}),
		]);
	});

	it("accepts stored document ids for edit-mode assist", async () => {
		const app = await createApp();
		documentsFindManyMock.mockResolvedValue([
			{
				id: "550e8400-e29b-41d4-a716-446655440000",
				filename: "invoice.txt",
				rawText: "Service charge 18.00",
			},
		]);
		assistSchemaEditMock.mockResolvedValue({
			analysis: "Schema needs a service charge field.",
			proposal: {
				name: "Invoice",
				description: "Captures invoice totals and service charges",
				jsonSchema: {
					type: "object",
					properties: {
						serviceCharge: {
							type: "number",
							description: "Additional service fee",
						},
					},
				},
				classificationHints: ["invoice", "service charge"],
				reasoning: "The stored sample contains service fees.",
				matchingDocuments: ["invoice.txt"],
			},
			diff: [
				{
					field: "description",
					label: "Description",
					changed: true,
					before: "Captures invoice totals",
					after: "Captures invoice totals and service charges",
				},
			],
		});

		const response = await request(app)
			.post("/api/schemas/assist")
			.field("mode", "edit")
			.field("schemaId", "550e8400-e29b-41d4-a716-446655440010")
			.field("documentIds", "550e8400-e29b-41d4-a716-446655440000");

		expect(response.status).toBe(200);
		expect(assistSchemaEditMock).toHaveBeenCalledWith(
			expect.objectContaining({
				id: "550e8400-e29b-41d4-a716-446655440010",
			}),
			[{ filename: "invoice.txt", text: "Service charge 18.00" }],
			undefined,
		);
		expect(response.body.diff).toEqual([
			expect.objectContaining({
				field: "description",
				changed: true,
			}),
		]);
	});
});
