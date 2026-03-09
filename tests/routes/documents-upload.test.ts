import { existsSync, unlinkSync } from "node:fs";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const readFileMock = vi.fn();
const findFirstMock = vi.fn();
const insertMock = vi.fn();
const valuesMock = vi.fn();
const returningMock = vi.fn();
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
	},
}));

vi.mock("../../src/queue/jobs.js", () => ({
	enqueueClassification: enqueueClassificationMock,
}));

vi.mock("../../src/services/file-parser.js", () => ({
	parseFile: parseFileMock,
}));

describe("documentsRouter uploads", () => {
	const createdUploadPaths = new Set<string>();

	async function createApp(maxFileSize = 10 * 1024 * 1024) {
		vi.resetModules();
		process.env.UPLOAD_DIR = "./uploads/test-documents-routes";
		process.env.MAX_FILE_SIZE = String(maxFileSize);

		const express = (await import("express")).default;
		const { documentsRouter } = await import("../../src/routes/documents.js");
		const { errorHandler } = await import("../../src/middleware/error-handler.js");

		const app = express();
		app.use("/api/documents", documentsRouter);
		app.use(errorHandler);
		return app;
	}

	beforeEach(() => {
		createdUploadPaths.clear();
		readFileMock.mockReset();
		findFirstMock.mockReset();
		insertMock.mockReset();
		valuesMock.mockReset();
		returningMock.mockReset();
		enqueueClassificationMock.mockReset();
		parseFileMock.mockReset();

		findFirstMock.mockResolvedValue(null);
		insertMock.mockReturnValue({
			values: valuesMock,
		});
		valuesMock.mockImplementation((payload: { storagePath: string }) => {
			createdUploadPaths.add(payload.storagePath);
			return { returning: returningMock };
		});
		returningMock.mockResolvedValue([
			{
				id: "doc-123",
				status: "pending",
			},
		]);
		readFileMock.mockResolvedValue(Buffer.from("invoice body"));
		parseFileMock.mockResolvedValue("parsed text");
		enqueueClassificationMock.mockResolvedValue(undefined);
	});

	afterEach(() => {
		for (const filePath of createdUploadPaths) {
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

	it("returns 413 for oversized uploads", async () => {
		const app = await createApp(4);

		const response = await request(app)
			.post("/api/documents")
			.attach("file", Buffer.from("hello"), "too-large.txt");

		expect(response.status).toBe(413);
		expect(response.body).toEqual({ error: "File too large" });
		expect(parseFileMock).not.toHaveBeenCalled();
	});

	it("returns 400 for unexpected upload fields", async () => {
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
});
