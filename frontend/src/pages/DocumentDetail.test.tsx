import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	Outlet,
	RouterProvider,
	createMemoryRouter,
} from "react-router-dom";
import { DocumentDetail } from "./DocumentDetail";
import { api } from "../api";

const navigateMock = vi.fn();

vi.mock("react-router-dom", async (importActual) => {
	const actual = await importActual<typeof import("react-router-dom")>();
	return {
		...actual,
		useNavigate: () => navigateMock,
	};
});

vi.mock("../api", () => ({
	api: {
		documents: {
			get: vi.fn(),
			reprocess: vi.fn(),
			delete: vi.fn(),
			stream: vi.fn(),
		},
	},
}));

const documentGetMock = vi.mocked(api.documents.get);
const documentReprocessMock = vi.mocked(api.documents.reprocess);
const documentDeleteMock = vi.mocked(api.documents.delete);
const documentStreamMock = vi.mocked(api.documents.stream);

function renderDocumentDetail() {
	const router = createMemoryRouter(
		[
			{
				path: "/",
				element: <Outlet />,
				children: [
					{
						path: "documents/:documentId",
						element: <DocumentDetail />,
					},
					{
						path: "schemas/new",
						element: <div>Schema Create Page</div>,
					},
				],
			},
		],
		{
			initialEntries: ["/documents/doc-1"],
		},
	);

	return {
		router,
		...render(<RouterProvider router={router} />),
	};
}

describe("DocumentDetail", () => {
	beforeEach(() => {
		navigateMock.mockReset();
		documentGetMock.mockReset();
		documentReprocessMock.mockReset();
		documentDeleteMock.mockReset();
		documentStreamMock.mockReset();
		documentReprocessMock.mockResolvedValue(undefined as never);
		documentDeleteMock.mockResolvedValue(undefined);
		documentStreamMock.mockReturnValue({
			close: vi.fn(),
		} as unknown as EventSource);
		documentGetMock.mockResolvedValue({
			id: "doc-1",
			filename: "brochure.pdf",
			mimeType: "application/pdf",
			fileSize: 1024,
			contentHash: "hash-1",
			rawText: "Travel brochure text",
			storagePath: "/tmp/brochure.pdf",
			status: "unclassified",
			schemaId: null,
			schemaVersion: null,
			schemaRevisionId: null,
			extractedData: null,
			extractionConfidence: null,
			errorMessage: null,
			retryCount: 0,
			createdAt: "2026-03-09T12:00:00.000Z",
			updatedAt: "2026-03-09T12:00:00.000Z",
			schema: null,
			schemaRevision: null,
			jobs: [
				{
					id: "job-1",
					jobType: "classification",
					status: "completed",
					attemptNumber: 1,
					errorMessage: null,
					metadata: {
						reasoning:
							"The brochure does not match any of the configured schemas.",
					},
					startedAt: "2026-03-09T12:01:00.000Z",
					completedAt: "2026-03-09T12:01:02.000Z",
					createdAt: "2026-03-09T12:01:00.000Z",
				},
			],
		});
	});

	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
	});

	it("offers an AI assist handoff for unclassified documents", async () => {
		const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
		renderDocumentDetail();

		await screen.findByText("No Matching Schema");
		expect(
			screen.getByText(/The brochure does not match any of the configured schemas\./),
		).toBeInTheDocument();

		fireEvent.click(
			screen.getByRole("button", { name: "Create Schema With AI Assist" }),
		);

		await waitFor(() => {
			expect(confirmSpy).toHaveBeenCalled();
			expect(navigateMock).toHaveBeenCalledWith(
				"/schemas/new?sourceDocumentId=doc-1",
			);
		});
	});
});
