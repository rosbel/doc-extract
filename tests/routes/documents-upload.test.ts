import { existsSync, unlinkSync } from "node:fs";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const readFileMock = vi.fn();
const findFirstMock = vi.fn();
const insertMock = vi.fn();
const valuesMock = vi.fn();
const returningMock = vi.fn();
const updateMock = vi.fn();
const setMock = vi.fn();
const whereMock = vi.fn();
const enqueueClassificationMock = vi.fn();
const parseFileMock = vi.fn();

vi.mock("node:fs/promises", async (importActual) => {
	const actual = await importActual<typeof import("node:fs/promises")>();
	return {
		...actual,
		readFile: readFileMock,
	};
});

vi.mock("../../src/db/index.js", () => ({
	db: {
		query: {
			documents: {
				findFirst: findFirstMock,
			},
		},
		insert: insertMock,
		update: updateMock,
	},
}));

vi.mock("../../src/queue/jobs.js", () => ({
	enqueueClassification: enqueueClassificationMock,
}));

vi.mock("../../src/services/file-parser.js", () => ({
	parseFile: parseFileMock,
}));

describe("documentsRouter uploads", () => {
	const createdDocumentPaths = new Set<string>();

	async function createApp(options?: {
		maxFileSize?: number;
		maxBatchFiles?: number;
	}) {
		vi.resetModules();
		process.env.UPLOAD_DIR = "./uploads/test-documents-routes";
		process.env.MAX_FILE_SIZE = String(options?.maxFileSize ?? 10 * 1024 * 1024);
		process.env.MAX_FILES_PER_UPLOAD_BATCH = String(options?.maxBatchFiles ?? 10);

		const express = (await import("express")).default;
		const { documentsRouter } = await import("../../src/routes/documents.js");
		const { errorHandler } = await import("../../src/middleware/error-handler.js");

		const app = express();
		app.use("/api/documents", documentsRouter);
		app.use(errorHandler);
		return app;
	}

	beforeEach(() => {
		createdDocumentPaths.clear();
		readFileMock.mockReset();
		findFirstMock.mockReset();
		insertMock.mockReset();
		valuesMock.mockReset();
		returningMock.mockReset();
		updateMock.mockReset();
		setMock.mockReset();
		whereMock.mockReset();
		enqueueClassificationMock.mockReset();
		parseFileMock.mockReset();

		findFirstMock.mockResolvedValue(null);
		insertMock.mockReturnValue({
			values: valuesMock,
		});
		valuesMock.mockImplementation((payload: { storagePath: string }) => {
			createdDocumentPaths.add(payload.storagePath);
			return { returning: returningMock };
		});
		returningMock.mockResolvedValue([
			{
				id: "doc-123",
				filename: "invoice.txt",
				mimeType: "text/plain",
				fileSize: 5,
				contentHash: "hash-1",
				rawText: "parsed text",
				searchText: "parsed text",
				storagePath: "./uploads/test-documents-routes/doc-123",
				status: "pending",
				schemaId: null,
				schemaVersion: null,
				schemaRevisionId: null,
				extractedData: null,
				extractionConfidence: null,
				errorMessage: null,
				retryCount: 0,
				createdAt: "2026-03-09T12:00:00.000Z",
				updatedAt: "2026-03-09T12:00:00.000Z",
			},
		]);
		updateMock.mockReturnValue({
			set: setMock,
		});
		setMock.mockReturnValue({
			where: whereMock,
		});
		whereMock.mockResolvedValue(undefined);
		readFileMock.mockResolvedValue(Buffer.from("invoice body"));
		parseFileMock.mockResolvedValue("parsed text");
		enqueueClassificationMock.mockResolvedValue(undefined);
	});

	afterEach(() => {
		for (const filePath of createdDocumentPaths) {
			if (existsSync(filePath)) {
				unlinkSync(filePath);
			}
		}
	});

	it("accepts a standard single-file upload", async () => {
		const app = await createApp();

		const response = await request(app)
			.post("/api/documents")
			.attach("file", Buffer.from("hello"), "invoice.txt");

		expect(response.status).toBe(201);
		expect(response.body).toMatchObject({
			id: "doc-123",
			status: "pending",
		});
		expect(findFirstMock).toHaveBeenCalledTimes(1);
		expect(parseFileMock).toHaveBeenCalledTimes(1);
		expect(enqueueClassificationMock).toHaveBeenCalledWith("doc-123");
		expect(valuesMock).toHaveBeenCalledWith(
			expect.objectContaining({
				filename: "invoice.txt",
				mimeType: "text/plain",
				fileSize: 5,
				rawText: "parsed text",
				storagePath: expect.stringContaining("uploads/test-documents-routes/"),
			}),
		);
	});

	it("accepts a multi-file upload batch", async () => {
		const app = await createApp();

		returningMock
			.mockResolvedValueOnce([
				{
					id: "doc-1",
					status: "pending",
				},
			])
			.mockResolvedValueOnce([
				{
					id: "doc-2",
					status: "pending",
				},
			]);

		const response = await request(app)
			.post("/api/documents/batch")
			.attach("files", Buffer.from("one"), "one.txt")
			.attach("files", Buffer.from("two"), "two.txt");

		expect(response.status).toBe(201);
		expect(response.body.summary).toEqual({
			accepted: 2,
			duplicate: 0,
			failed: 0,
			total: 2,
		});
		expect(response.body.results).toEqual([
			expect.objectContaining({
				filename: "one.txt",
				status: "accepted",
				document: expect.objectContaining({ id: "doc-1" }),
			}),
			expect.objectContaining({
				filename: "two.txt",
				status: "accepted",
				document: expect.objectContaining({ id: "doc-2" }),
			}),
		]);
	});

	it("returns mixed batch results for duplicates", async () => {
		const app = await createApp();

		findFirstMock
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce({ id: "existing-doc" });
		returningMock.mockResolvedValueOnce([
			{
				id: "doc-1",
				status: "pending",
			},
		]);

		const response = await request(app)
			.post("/api/documents/batch")
			.attach("files", Buffer.from("one"), "one.txt")
			.attach("files", Buffer.from("two"), "two.txt");

		expect(response.status).toBe(207);
		expect(response.body.summary).toEqual({
			accepted: 1,
			duplicate: 1,
			failed: 0,
			total: 2,
		});
		expect(response.body.results).toEqual([
			expect.objectContaining({
				filename: "one.txt",
				status: "accepted",
			}),
			{
				filename: "two.txt",
				status: "duplicate",
				existingDocumentId: "existing-doc",
			},
		]);
	});

	it("keeps processing the batch after a file-level failure", async () => {
		const app = await createApp();

		parseFileMock
			.mockResolvedValueOnce("parsed text")
			.mockRejectedValueOnce(new Error("Parse exploded"));
		returningMock.mockResolvedValueOnce([
			{
				id: "doc-1",
				status: "pending",
			},
		]);

		const response = await request(app)
			.post("/api/documents/batch")
			.attach("files", Buffer.from("one"), "one.txt")
			.attach("files", Buffer.from("two"), "two.txt");

		expect(response.status).toBe(207);
		expect(response.body.summary).toEqual({
			accepted: 1,
			duplicate: 0,
			failed: 1,
			total: 2,
		});
		expect(response.body.results).toEqual([
			expect.objectContaining({
				filename: "one.txt",
				status: "accepted",
			}),
			{
				filename: "two.txt",
				status: "failed",
				error: "Parse exploded",
			},
		]);
	});

	it("cleans up duplicate temp files", async () => {
		const app = await createApp();
		findFirstMock.mockResolvedValueOnce({ id: "existing-doc" });

		const response = await request(app)
			.post("/api/documents/batch")
			.attach("files", Buffer.from("duplicate"), "duplicate.txt");

		const uploadPath = readFileMock.mock.calls[0]?.[0] as string | undefined;

		expect(response.status).toBe(207);
		expect(uploadPath).toBeTruthy();
		expect(uploadPath && existsSync(uploadPath)).toBe(false);
	});

	it("returns 413 for oversized uploads", async () => {
		const app = await createApp({ maxFileSize: 4 });

		const response = await request(app)
			.post("/api/documents")
			.attach("file", Buffer.from("hello"), "too-large.txt");

		expect(response.status).toBe(413);
		expect(response.body).toEqual({ error: "File too large" });
		expect(parseFileMock).not.toHaveBeenCalled();
	});

	it("returns 400 for unexpected single-upload fields", async () => {
		const app = await createApp();

		const response = await request(app)
			.post("/api/documents")
			.attach("unexpected", Buffer.from("hello"), "invoice.txt");

		expect(response.status).toBe(400);
		expect(response.body).toEqual({ error: "Unexpected field" });
		expect(parseFileMock).not.toHaveBeenCalled();
	});

	it("returns 400 for malformed multipart bodies", async () => {
		const app = await createApp();

		const response = await request(app)
			.post("/api/documents")
			.set("Content-Type", "multipart/form-data; boundary=----broken")
			.send(
				[
					"------broken",
					'Content-Disposition: form-data; name="file"; filename="invoice.txt"',
					"Content-Type: text/plain",
					"",
					"hello",
				].join("\r\n"),
			);

		expect(response.status).toBe(400);
		expect(response.body.error).toMatch(/unexpected end of form/i);
		expect(parseFileMock).not.toHaveBeenCalled();
	});

	it("returns 400 when no batch files are sent", async () => {
		const app = await createApp();

		const response = await request(app).post("/api/documents/batch");

		expect(response.status).toBe(400);
		expect(response.body).toEqual({ error: "No files uploaded" });
	});

	it("returns 400 for unexpected batch fields", async () => {
		const app = await createApp();

		const response = await request(app)
			.post("/api/documents/batch")
			.attach("file", Buffer.from("hello"), "invoice.txt");

		expect(response.status).toBe(400);
		expect(response.body).toEqual({ error: "Unexpected field" });
	});

	it("returns 400 when the batch exceeds the configured file limit", async () => {
		const app = await createApp({ maxBatchFiles: 1 });

		const response = await request(app)
			.post("/api/documents/batch")
			.attach("files", Buffer.from("one"), "one.txt")
			.attach("files", Buffer.from("two"), "two.txt");

		expect(response.status).toBe(400);
		expect(response.body).toEqual({ error: "Too many files" });
	});
});
