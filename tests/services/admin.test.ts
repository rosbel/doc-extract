import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	documentQueueMock,
	dbMock,
	setMaintenanceModeMock,
	deleteDocumentVectorsMock,
	clearVectorIndexMock,
	unlinkMock,
	mkdirMock,
	readdirMock,
	rmMock,
} = vi.hoisted(() => ({
	documentQueueMock: {
		getJobs: vi.fn(),
		getActiveCount: vi.fn(),
		clean: vi.fn(),
		drain: vi.fn(),
		isPaused: vi.fn(),
		pause: vi.fn(),
		resume: vi.fn(),
		obliterate: vi.fn(),
		getJobCounts: vi.fn(),
	},
	dbMock: {
		query: {
			documents: {
				findFirst: vi.fn(),
			},
		},
		delete: vi.fn(() => ({
			where: vi.fn(async () => []),
		})),
		transaction: vi.fn(async (callback) =>
			callback({
				delete: vi.fn(async () => []),
			}),
		),
	},
	setMaintenanceModeMock: vi.fn(),
	deleteDocumentVectorsMock: vi.fn(),
	clearVectorIndexMock: vi.fn(),
	unlinkMock: vi.fn(),
	mkdirMock: vi.fn(),
	readdirMock: vi.fn(),
	rmMock: vi.fn(),
}));

vi.mock("../../src/queue/index.js", () => ({
	documentQueue: documentQueueMock,
}));

vi.mock("../../src/db/index.js", () => ({
	db: dbMock,
}));

vi.mock("../../src/queue/redis.js", () => ({
	setMaintenanceMode: setMaintenanceModeMock,
	isMaintenanceModeEnabled: vi.fn(),
	readWorkerHeartbeat: vi.fn(),
}));

vi.mock("../../src/services/vector-store.js", () => ({
	deleteDocumentVectors: deleteDocumentVectorsMock,
	clearVectorIndex: clearVectorIndexMock,
	describeVectorIndexStats: vi.fn(),
	isSemanticSearchConfigured: vi.fn(() => true),
}));

vi.mock("node:fs/promises", () => ({
	unlink: unlinkMock,
	mkdir: mkdirMock,
	readdir: readdirMock,
	rm: rmMock,
	stat: vi.fn(),
}));

vi.mock("../../src/config.js", () => ({
	config: {
		upload: {
			dir: "./uploads",
		},
		openrouter: {
			apiKey: "",
			model: "anthropic/claude-sonnet-4",
		},
		pinecone: {
			apiKey: "pinecone-key",
			index: "document-extraction",
		},
	},
}));

describe("admin service destructive actions", () => {
	beforeEach(() => {
		documentQueueMock.getJobs.mockReset();
		documentQueueMock.getActiveCount.mockReset();
		documentQueueMock.clean.mockReset();
		documentQueueMock.drain.mockReset();
		documentQueueMock.isPaused.mockReset();
		documentQueueMock.pause.mockReset();
		documentQueueMock.resume.mockReset();
		documentQueueMock.obliterate.mockReset();
		documentQueueMock.getJobCounts.mockReset();
		dbMock.query.documents.findFirst.mockReset();
		dbMock.delete.mockClear();
		dbMock.transaction.mockClear();
		setMaintenanceModeMock.mockReset();
		deleteDocumentVectorsMock.mockReset();
		clearVectorIndexMock.mockReset();
		unlinkMock.mockReset();
		mkdirMock.mockReset();
		readdirMock.mockReset();
		rmMock.mockReset();
	});

	it("deletes a document and triggers queue/file/vector cleanup", async () => {
		const queueJobRemove = vi.fn(async () => undefined);
		dbMock.query.documents.findFirst.mockResolvedValue({
			id: "doc-1",
			filename: "invoice.pdf",
			storagePath: "./uploads/invoice.pdf",
		});
		documentQueueMock.getJobs.mockResolvedValue([
			{
				id: "job-1",
				data: { documentId: "doc-1" },
				remove: queueJobRemove,
				getState: vi.fn(async () => "completed"),
			},
		]);

		const { deleteAdminDocument } = await import("../../src/services/admin.js");
		const result = await deleteAdminDocument("doc-1");

		expect(queueJobRemove).toHaveBeenCalledTimes(1);
		expect(dbMock.delete).toHaveBeenCalledTimes(1);
		expect(unlinkMock).toHaveBeenCalledWith("./uploads/invoice.pdf");
		expect(deleteDocumentVectorsMock).toHaveBeenCalledWith("doc-1");
		expect(result.ok).toBe(true);
		expect(result.warnings).toEqual([]);
	});

	it("refuses to delete a document with an active queue job", async () => {
		dbMock.query.documents.findFirst.mockResolvedValue({
			id: "doc-1",
			filename: "invoice.pdf",
			storagePath: "./uploads/invoice.pdf",
		});
		documentQueueMock.getJobs.mockResolvedValue([
			{
				id: "job-1",
				data: { documentId: "doc-1" },
				remove: vi.fn(),
				getState: vi.fn(async () => "active"),
			},
		]);

		const { deleteAdminDocument } = await import("../../src/services/admin.js");

		await expect(deleteAdminDocument("doc-1")).rejects.toMatchObject({
			status: 409,
			message: "Cannot delete a document while it has active queue jobs",
		});
	});

	it("clears completed jobs through BullMQ clean", async () => {
		documentQueueMock.getActiveCount.mockResolvedValue(0);
		documentQueueMock.clean.mockImplementation(
			async (_grace, _limit, type: "completed" | "failed") => {
				return type === "completed" &&
					documentQueueMock.clean.mock.calls.filter(
						(call) => call[2] === "completed",
					).length === 1
					? ["completed-1", "completed-2"]
					: [];
			},
		);

		const { clearQueue } = await import("../../src/services/admin.js");
		const result = await clearQueue("completed");

		expect(documentQueueMock.clean).toHaveBeenCalledWith(0, 1000, "completed");
		expect(result.details).toEqual({
			removed: 2,
		});
	});

	it("clears failed jobs through BullMQ clean", async () => {
		documentQueueMock.getActiveCount.mockResolvedValue(0);
		documentQueueMock.clean.mockImplementation(
			async (_grace, _limit, type: "completed" | "failed") => {
				return type === "failed" &&
					documentQueueMock.clean.mock.calls.filter(
						(call) => call[2] === "failed",
					).length === 1
					? ["failed-1"]
					: [];
			},
		);

		const { clearQueue } = await import("../../src/services/admin.js");
		const result = await clearQueue("failed");

		expect(documentQueueMock.clean).toHaveBeenCalledWith(0, 1000, "failed");
		expect(result.details).toEqual({
			removed: 1,
		});
	});

	it("aborts global reset when the queue never goes idle", async () => {
		documentQueueMock.isPaused.mockResolvedValue(false);
		documentQueueMock.getActiveCount.mockResolvedValue(1);

		const { resetSystem } = await import("../../src/services/admin.js");

		await expect(resetSystem({ waitTimeoutMs: 0 })).rejects.toMatchObject({
			status: 409,
			message: "Timed out waiting for active queue jobs to finish",
		});
		expect(setMaintenanceModeMock).toHaveBeenCalledWith(true);
		expect(documentQueueMock.pause).toHaveBeenCalledTimes(1);
		expect(setMaintenanceModeMock).toHaveBeenLastCalledWith(false);
		expect(documentQueueMock.resume).toHaveBeenCalledTimes(1);
	});

	it("reports Pinecone reset failures as warnings instead of failing the reset", async () => {
		documentQueueMock.isPaused.mockResolvedValue(false);
		documentQueueMock.getActiveCount.mockResolvedValue(0);
		readdirMock.mockResolvedValue([]);
		clearVectorIndexMock.mockRejectedValue(new Error("Pinecone outage"));

		const { resetSystem } = await import("../../src/services/admin.js");
		const result = await resetSystem({ waitTimeoutMs: 0 });

		expect(result.ok).toBe(true);
		expect(result.warnings).toEqual([
			"Failed to clear Pinecone vectors: Pinecone outage",
		]);
		expect(documentQueueMock.obliterate).toHaveBeenCalledWith({
			force: false,
			count: 1000,
		});
	});
});
