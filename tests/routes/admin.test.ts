import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	config,
	getAdminOverviewMock,
	listAdminDocumentsMock,
	deleteAdminDocumentMock,
	pauseQueueMock,
	resumeQueueMock,
	clearQueueMock,
	clearPineconeMock,
	resetSystemMock,
} = vi.hoisted(() => ({
	config: {
		adminToken: "secret-token",
	},
	getAdminOverviewMock: vi.fn(),
	listAdminDocumentsMock: vi.fn(),
	deleteAdminDocumentMock: vi.fn(),
	pauseQueueMock: vi.fn(),
	resumeQueueMock: vi.fn(),
	clearQueueMock: vi.fn(),
	clearPineconeMock: vi.fn(),
	resetSystemMock: vi.fn(),
}));

vi.mock("../../src/config.js", () => ({
	config,
}));

vi.mock("../../src/services/admin.js", () => ({
	getAdminOverview: getAdminOverviewMock,
	listAdminDocuments: listAdminDocumentsMock,
	deleteAdminDocument: deleteAdminDocumentMock,
	pauseQueue: pauseQueueMock,
	resumeQueue: resumeQueueMock,
	clearQueue: clearQueueMock,
	clearPinecone: clearPineconeMock,
	resetSystem: resetSystemMock,
}));

describe("adminRouter", () => {
	beforeEach(() => {
		config.adminToken = "secret-token";
		config.adminSecurity = {
			maxFailedAttempts: 5,
			lockoutMs: 15 * 60 * 1000,
			failureWindowMs: 10 * 60 * 1000,
		};
		getAdminOverviewMock.mockReset();
		listAdminDocumentsMock.mockReset();
		deleteAdminDocumentMock.mockReset();
		pauseQueueMock.mockReset();
		resumeQueueMock.mockReset();
		clearQueueMock.mockReset();
		clearPineconeMock.mockReset();
		resetSystemMock.mockReset();
	});

	async function createApp() {
		const { resetAdminSecurityState } = await import(
			"../../src/middleware/admin-auth.js"
		);
		resetAdminSecurityState();
		return import("../../src/routes/admin.js").then(({ adminRouter }) => {
			const app = express();
			app.use(express.json());
			app.use("/api/admin", adminRouter);
			app.use((error, _req, res, _next) => {
				res.status(error.status || 500).json({ error: error.message });
			});
			return app;
		});
	}

	it("rejects requests without the admin token", async () => {
		const app = await createApp();

		const response = await request(app).get("/api/admin/overview");

		expect(response.status).toBe(401);
		expect(response.body).toEqual({ error: "Unauthorized" });
	});

	it("returns disabled when ADMIN_TOKEN is unset", async () => {
		config.adminToken = "";
		const app = await createApp();

		const response = await request(app).get("/api/admin/overview");

		expect(response.status).toBe(503);
		expect(response.body).toEqual({
			error: "Admin console is disabled",
			disabled: true,
		});
	});

	it("returns the overview payload for authenticated requests", async () => {
		getAdminOverviewMock.mockResolvedValue({
			postgres: {
				documentCounts: { completed: 2 },
				schemaCounts: { active: 1 },
				jobCounts: { failed: 1 },
				recentFailedDocuments: [],
				recentFailedJobs: [],
			},
			uploads: {
				path: "./uploads",
				exists: true,
				fileCount: 1,
				totalBytes: 50,
			},
			queue: {
				paused: false,
				maintenanceMode: false,
				counts: {
					waiting: 1,
					active: 0,
					delayed: 0,
					completed: 1,
					failed: 0,
					paused: 0,
				},
				recentJobs: [],
				failedJobs: [],
				worker: {
					status: "online",
					lastHeartbeatAt: "2026-03-09T12:00:00.000Z",
					ageMs: 1000,
				},
			},
			pinecone: {
				configured: true,
				status: "healthy",
				index: "document-extraction",
				totalRecordCount: 3,
				namespaceCount: 1,
				message: "Pinecone reachable",
			},
			openrouter: {
				configured: true,
				status: "healthy",
				model: "anthropic/claude-sonnet-4",
				message: "OpenRouter reachable",
			},
		});

		const app = await createApp();
		const response = await request(app)
			.get("/api/admin/overview")
			.set("x-admin-token", "secret-token");

		expect(response.status).toBe(200);
		expect(getAdminOverviewMock).toHaveBeenCalledTimes(1);
		expect(response.body.pinecone.totalRecordCount).toBe(3);
	});

	it("requires the exact delete confirmation string", async () => {
		const app = await createApp();

		const response = await request(app)
			.delete("/api/admin/documents/doc-1")
			.set("x-admin-token", "secret-token")
			.send({ confirmation: "wrong" });

		expect(response.status).toBe(400);
		expect(response.body).toEqual({
			error: "Confirmation must be DELETE_DOCUMENT",
		});
		expect(deleteAdminDocumentMock).not.toHaveBeenCalled();
	});

	it("locks out repeated invalid admin token attempts", async () => {
		config.adminSecurity = {
			maxFailedAttempts: 2,
			lockoutMs: 60_000,
			failureWindowMs: 60_000,
		};
		const app = await createApp();

		const first = await request(app)
			.get("/api/admin/overview")
			.set("x-admin-token", "wrong");
		const second = await request(app)
			.get("/api/admin/overview")
			.set("x-admin-token", "wrong");
		const third = await request(app)
			.get("/api/admin/overview")
			.set("x-admin-token", "wrong");

		expect(first.status).toBe(401);
		expect(second.status).toBe(429);
		expect(third.status).toBe(429);
		expect(third.body.error).toBe(
			"Too many invalid admin token attempts. Try again later.",
		);
	});
});
