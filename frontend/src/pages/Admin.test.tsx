import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { Admin } from "./Admin";
import { adminTokenStore, api } from "../api";

vi.mock("../api", () => ({
	adminTokenStore: {
		get: vi.fn(() => window.sessionStorage.getItem("admin-token") || ""),
		set: vi.fn((token: string) => window.sessionStorage.setItem("admin-token", token)),
		clear: vi.fn(() => window.sessionStorage.removeItem("admin-token")),
	},
	api: {
		admin: {
			overview: vi.fn(),
			documents: vi.fn(),
			deleteDocument: vi.fn(),
			pauseQueue: vi.fn(),
			resumeQueue: vi.fn(),
			clearQueue: vi.fn(),
			clearPinecone: vi.fn(),
			reset: vi.fn(),
		},
	},
}));

const overviewMock = vi.mocked(api.admin.overview);
const documentsMock = vi.mocked(api.admin.documents);
const deleteDocumentMock = vi.mocked(api.admin.deleteDocument);
const clearQueueMock = vi.mocked(api.admin.clearQueue);
const resetMock = vi.mocked(api.admin.reset);

const baseOverview = {
	postgres: {
		documentCounts: {
			pending: 1,
			classifying: 0,
			extracting: 0,
			completed: 2,
			failed: 1,
			duplicate: 0,
		},
		schemaCounts: {
			active: 2,
			archived: 1,
		},
		jobCounts: {
			pending: 0,
			running: 1,
			completed: 3,
			failed: 1,
		},
		recentFailedDocuments: [
			{
				id: "doc-failed",
				filename: "failed.pdf",
				errorMessage: "Extraction crashed",
				updatedAt: "2026-03-09T12:00:00.000Z",
			},
		],
		recentFailedJobs: [
			{
				id: "job-1",
				documentId: "doc-failed",
				jobType: "extraction",
				errorMessage: "OpenRouter timed out",
				completedAt: "2026-03-09T12:00:00.000Z",
				createdAt: "2026-03-09T11:55:00.000Z",
			},
		],
	},
	uploads: {
		path: "./uploads",
		exists: true,
		fileCount: 4,
		totalBytes: 1024,
	},
	queue: {
		paused: false,
		maintenanceMode: false,
		counts: {
			waiting: 2,
			active: 1,
			delayed: 0,
			completed: 5,
			failed: 1,
			paused: 0,
		},
		recentJobs: [
			{
				id: "queue-job-1",
				name: "classify",
				state: "active",
				attemptsMade: 0,
				documentId: "doc-1",
				timestamp: 100,
			},
		],
		failedJobs: [
			{
				id: "queue-job-failed-1",
				name: "classify",
				state: "failed",
				attemptsMade: 2,
				documentId: "doc-failed",
				timestamp: 200,
				failedReason: "Classifier timed out",
				finishedAt: "2026-03-09T12:01:00.000Z",
			},
		],
		worker: {
			status: "online" as const,
			lastHeartbeatAt: "2026-03-09T12:00:00.000Z",
			ageMs: 1000,
		},
	},
	pinecone: {
		configured: true,
		status: "healthy" as const,
		index: "document-extraction",
		totalRecordCount: 22,
		namespaceCount: 1,
		message: "Pinecone reachable",
	},
	openrouter: {
		configured: true,
		status: "healthy" as const,
		model: "anthropic/claude-sonnet-4",
		message: "OpenRouter reachable",
	},
};

const baseDocuments = {
	documents: [
		{
			id: "doc-1",
			filename: "invoice.pdf",
			status: "completed",
			schemaId: "schema-1",
			schemaName: "Invoice",
			retryCount: 0,
			storagePath: "./uploads/invoice.pdf",
			errorMessage: null,
			createdAt: "2026-03-09T11:00:00.000Z",
			updatedAt: "2026-03-09T12:00:00.000Z",
		},
	],
	total: 1,
	page: 1,
	limit: 20,
};

function renderAdmin() {
	return render(
		<MemoryRouter>
			<Admin />
		</MemoryRouter>,
	);
}

describe("Admin", () => {
	beforeEach(() => {
		window.sessionStorage.clear();
		overviewMock.mockResolvedValue(baseOverview);
		documentsMock.mockResolvedValue(baseDocuments);
		deleteDocumentMock.mockResolvedValue({
			ok: true,
			message: "Deleted document invoice.pdf",
			warnings: [],
		});
		clearQueueMock.mockResolvedValue({
			ok: true,
			message: "Cleared completed jobs",
			warnings: [],
		});
		resetMock.mockResolvedValue({
			ok: true,
			message: "System reset completed",
			warnings: ["Failed to clear Pinecone vectors"],
		});
	});

	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
	});

	it("shows the token gate until a token is submitted", async () => {
		renderAdmin();

		expect(screen.getByText("Protected operations dashboard")).toBeInTheDocument();
		expect(overviewMock).not.toHaveBeenCalled();

		fireEvent.change(screen.getByLabelText("Admin token"), {
			target: { value: "secret-token" },
		});
		fireEvent.submit(screen.getByRole("button", { name: "Unlock Admin" }).closest("form")!);

		await screen.findByText("Operations console");
		expect(adminTokenStore.set).toHaveBeenCalledWith("secret-token");
		expect(overviewMock).toHaveBeenCalled();
		expect(documentsMock).toHaveBeenCalled();
	});

	it("renders service panels and recent issues after loading", async () => {
		window.sessionStorage.setItem("admin-token", "secret-token");

		renderAdmin();

		expect(await screen.findByText("failed.pdf")).toBeInTheDocument();
		expect(screen.getByText("Failure review")).toBeInTheDocument();
		expect(screen.getByText("Live queue failures")).toBeInTheDocument();
		expect(screen.getByText("Historical audit trail")).toBeInTheDocument();
		expect(screen.getByText("Classifier timed out")).toBeInTheDocument();
		expect(
			screen.getByText("active 1, failed 1, worker online"),
		).toBeInTheDocument();
		expect(screen.getAllByText("Pinecone reachable").length).toBeGreaterThan(0);
		expect(screen.getAllByText("healthy").length).toBeGreaterThan(0);
		expect(screen.getByText("invoice.pdf")).toBeInTheDocument();
		expect(screen.getAllByRole("link", { name: "Open docs" })).toHaveLength(2);
		expect(
			screen.getAllByRole("link", { name: "Open console" }),
		).toHaveLength(2);
	});

	it("requires confirmation for delete and queue clear actions", async () => {
		window.sessionStorage.setItem("admin-token", "secret-token");
		const promptSpy = vi
			.spyOn(window, "prompt")
			.mockReturnValueOnce("DELETE_DOCUMENT")
			.mockReturnValueOnce("CLEAR_QUEUE")
			.mockReturnValueOnce("CLEAR_QUEUE");

		renderAdmin();
		await screen.findByText("invoice.pdf");

		fireEvent.click(screen.getByRole("button", { name: "Delete" }));
		await waitFor(() => {
			expect(deleteDocumentMock).toHaveBeenCalledWith(
				"doc-1",
				"DELETE_DOCUMENT",
			);
		});

		fireEvent.click(
			screen.getByRole("button", { name: "Clear completed" }),
		);
		await waitFor(() => {
			expect(clearQueueMock).toHaveBeenCalledWith(
				"completed",
				"CLEAR_QUEUE",
			);
		});

		fireEvent.click(screen.getByRole("button", { name: "Clear failed" }));
		await waitFor(() => {
			expect(clearQueueMock).toHaveBeenCalledWith(
				"failed",
				"CLEAR_QUEUE",
			);
		});

		expect(promptSpy).toHaveBeenCalledTimes(3);
	});

	it("shows reset warnings clearly after a successful reset", async () => {
		window.sessionStorage.setItem("admin-token", "secret-token");

		renderAdmin();
		await screen.findByText("Reset system");

		fireEvent.change(
			screen.getByLabelText("Type RESET_SYSTEM to confirm"),
			{
				target: { value: "RESET_SYSTEM" },
			},
		);
		fireEvent.submit(screen.getByRole("button", { name: "Reset system" }).closest("form")!);

		await screen.findByText(
			"System reset completed Warnings: Failed to clear Pinecone vectors",
		);
		expect(resetMock).toHaveBeenCalledWith("RESET_SYSTEM");
	});

	it("hides the console when the server reports admin is disabled", async () => {
		window.sessionStorage.setItem("admin-token", "secret-token");
		overviewMock.mockRejectedValueOnce(
			Object.assign(new Error("Admin console is disabled"), { status: 503 }),
		);

		renderAdmin();

		expect(
			await screen.findByText("Protected operations dashboard"),
		).toBeInTheDocument();
		expect(screen.getByText("Admin console is disabled")).toBeInTheDocument();
		expect(
			screen.queryByText("Operations console"),
		).not.toBeInTheDocument();
		expect(adminTokenStore.clear).toHaveBeenCalled();
	});
});
