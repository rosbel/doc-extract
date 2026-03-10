import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/routes/documents.js", async () => {
	const { Router } = await import("express");
	const router = Router();
	router.get("/", (_req, res) => {
		res.json({ documents: [] });
	});
	router.get("/:id/status", (_req, res) => {
		res.json({
			id: "doc-1",
			status: "pending",
			extractionConfidence: null,
			errorMessage: null,
		});
	});
	router.post("/", (_req, res) => {
		res.status(201).json({ ok: true });
	});
	return { documentsRouter: router };
});
vi.mock("../src/routes/admin.js", async () => {
	const { Router } = await import("express");
	return { adminRouter: Router() };
});
vi.mock("../src/routes/schemas.js", async () => {
	const { Router } = await import("express");
	return { schemasRouter: Router() };
});
vi.mock("../src/routes/search.js", async () => {
	const { Router } = await import("express");
	return { searchRouter: Router() };
});

describe("server rate limiting", () => {
	beforeEach(() => {
		vi.resetModules();
		process.env.API_RATE_LIMIT_REQUESTS_PER_WINDOW = "1";
		process.env.DOCUMENT_UPLOAD_RATE_LIMIT_REQUESTS_PER_WINDOW = "1";
	});

	afterEach(() => {
		vi.clearAllMocks();
		process.env.API_RATE_LIMIT_REQUESTS_PER_WINDOW = undefined;
		process.env.DOCUMENT_UPLOAD_RATE_LIMIT_REQUESTS_PER_WINDOW = undefined;
	});

	it("does not rate limit document reads", async () => {
		const { createApp } = await import("../src/server.js");
		const app = createApp();

		const listFirst = await request(app).get("/api/documents");
		const listSecond = await request(app).get("/api/documents");
		const statusFirst = await request(app).get("/api/documents/doc-1/status");
		const statusSecond = await request(app).get("/api/documents/doc-1/status");

		expect(listFirst.status).toBe(200);
		expect(listSecond.status).toBe(200);
		expect(statusFirst.status).toBe(200);
		expect(statusSecond.status).toBe(200);
	});

	it("still rate limits document uploads", async () => {
		const { createApp } = await import("../src/server.js");
		const app = createApp();

		const first = await request(app).post("/api/documents");
		const second = await request(app).post("/api/documents");

		expect(first.status).toBe(201);
		expect(second.status).toBe(429);
		expect(second.body.error).toMatch(/too many/i);
	});
});
