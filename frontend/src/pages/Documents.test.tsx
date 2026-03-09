import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import { Documents } from "./Documents";
import { api } from "../api";

vi.mock("../components/FileUpload", () => ({
	FileUpload: ({ onUploaded }: { onUploaded: () => void }) => (
		<button onClick={onUploaded} type="button">
			Upload
		</button>
	),
}));

vi.mock("../components/StatusBadge", () => ({
	StatusBadge: ({ status }: { status: string }) => <span>{status}</span>,
}));

vi.mock("../api", () => ({
	api: {
		documents: {
			list: vi.fn(),
			status: vi.fn(),
		},
		schemas: {
			list: vi.fn(),
		},
		search: vi.fn(),
	},
}));

const documentsListMock = vi.mocked(api.documents.list);
const documentsStatusMock = vi.mocked(api.documents.status);
const schemasListMock = vi.mocked(api.schemas.list);
const searchMock = vi.mocked(api.search);

function LocationDisplay() {
	const location = useLocation();
	return <div data-testid="location-display">{location.pathname}</div>;
}

function renderDocuments() {
	return render(
		<MemoryRouter initialEntries={["/documents"]}>
			<Documents />
			<LocationDisplay />
		</MemoryRouter>,
	);
}

const baseDocuments = [
	{
		id: "doc-1",
		filename: "invoice.pdf",
		mimeType: "application/pdf",
		fileSize: 1024,
		contentHash: "hash-1",
		rawText: "invoice raw text",
		storagePath: "/tmp/invoice.pdf",
		status: "completed",
		schemaId: "schema-1",
		schemaVersion: 1,
		schemaRevisionId: "revision-1",
		extractedData: { vendor: "Acme" },
		extractionConfidence: 0.95,
		errorMessage: null,
		retryCount: 0,
		createdAt: "2026-03-09T12:00:00.000Z",
		updatedAt: "2026-03-09T12:00:00.000Z",
	},
];

const schemas = [
	{
		id: "schema-1",
		name: "Invoice",
		description: "Invoice schema",
		version: 1,
		jsonSchema: { type: "object" },
		classificationHints: ["invoice"],
		status: "active",
		createdAt: "2026-03-09T12:00:00.000Z",
		updatedAt: "2026-03-09T12:00:00.000Z",
	},
];

describe("Documents", () => {
	beforeEach(() => {
		documentsListMock.mockResolvedValue({
			documents: baseDocuments,
			total: 1,
			page: 1,
			limit: 20,
		});
		documentsStatusMock.mockResolvedValue({
			id: "doc-1",
			status: "completed",
			extractionConfidence: 0.95,
			errorMessage: null,
		});
		schemasListMock.mockResolvedValue(schemas);
		searchMock.mockReset();
	});

	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
	});

	it("defaults to Smart Search and renders unified results", async () => {
		searchMock.mockResolvedValue({
			mode: "hybrid",
			degraded: false,
			results: [
				{
					id: "doc-2",
					filename: "invoice-result.pdf",
					status: "completed",
					schemaId: "schema-1",
					extractionConfidence: 0.88,
					score: 0.91,
					snippet: "Acme invoice for March consulting services",
					matchReasons: ["Semantic match", "Exact field match"],
					matchedFields: ["vendor"],
				},
			],
		});

		renderDocuments();

		await screen.findByText("invoice.pdf");
		expect(screen.getByRole("button", { name: "Smart Search" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Exact text" })).toBeInTheDocument();

		fireEvent.change(screen.getByLabelText("Query"), {
			target: { value: "invoice" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Search" }));

		await screen.findByText('Showing 1 smart search result for "invoice"');
		expect(searchMock).toHaveBeenCalledWith({
			query: "invoice",
			mode: "hybrid",
			limit: 10,
		});
		expect(screen.getByText("invoice-result.pdf")).toBeInTheDocument();
		expect(screen.getByText("Semantic match")).toBeInTheDocument();
		expect(screen.getByText("vendor")).toBeInTheDocument();
	});

	it("supports exact text search with a schema filter and opens document detail", async () => {
		searchMock.mockResolvedValue({
			mode: "keyword",
			degraded: false,
			results: [
				{
					id: "doc-3",
					filename: "exact-match.pdf",
					status: "completed",
					schemaId: "schema-1",
					extractionConfidence: 0.73,
					score: 0.84,
					snippet: "vendor Acme Corp total 42",
					matchReasons: ["Exact field match", "Schema-filtered"],
					matchedFields: ["vendor"],
				},
			],
		});

		renderDocuments();

		await screen.findByText("invoice.pdf");

		fireEvent.change(screen.getByLabelText("Query"), {
			target: { value: "acme" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Exact text" }));
		fireEvent.change(screen.getByLabelText("Schema"), {
			target: { value: "schema-1" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Search" }));

		await screen.findByText('Showing 1 exact text result for "acme"');
		expect(searchMock).toHaveBeenCalledWith({
			query: "acme",
			mode: "keyword",
			limit: 10,
			schemaId: "schema-1",
		});
		expect(screen.getByText("84%")).toBeInTheDocument();

		fireEvent.click(screen.getByText("exact-match.pdf"));
		expect(screen.getByTestId("location-display")).toHaveTextContent(
			"/documents/doc-3",
		);
	});

	it("shows a friendly fallback banner when Smart Search degrades to exact text", async () => {
		searchMock.mockResolvedValue({
			mode: "hybrid",
			degraded: true,
			degradedReason: "semantic_unavailable",
			results: [
				{
					id: "doc-4",
					filename: "fallback.pdf",
					status: "completed",
					schemaId: "schema-1",
					extractionConfidence: 0.81,
					score: 0.67,
					snippet: "invoice fallback result",
					matchReasons: ["Exact field match"],
					matchedFields: ["invoiceNumber"],
				},
			],
		});

		renderDocuments();

		await screen.findByText("invoice.pdf");

		fireEvent.change(screen.getByLabelText("Query"), {
			target: { value: "invoice" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Search" }));

		await screen.findByText(
			"Smart Search isn't available right now, so we're using exact text matches instead. Results may be narrower, but you can still search your documents.",
		);
		expect(screen.getByText('Showing 1 exact text fallback result for "invoice"')).toBeInTheDocument();
	});

	it("clears search state and returns to the document list", async () => {
		searchMock.mockResolvedValue({
			mode: "hybrid",
			degraded: false,
			results: [],
		});

		renderDocuments();

		await screen.findByText("invoice.pdf");

		fireEvent.change(screen.getByLabelText("Query"), {
			target: { value: "invoice" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Search" }));

		await screen.findByText('Showing 0 smart search results for "invoice"');
		expect(screen.getByText("No matching documents found.")).toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: "Clear" }));

		await waitFor(() => {
			expect(screen.queryByText("No matching documents found.")).not.toBeInTheDocument();
		});
		expect(screen.getByLabelText("Query")).toHaveValue("");
		expect(screen.getByText("invoice.pdf")).toBeInTheDocument();
	});

	it("does not search when the query is empty", async () => {
		renderDocuments();

		await screen.findByText("invoice.pdf");

		fireEvent.click(screen.getByRole("button", { name: "Search" }));

		expect(searchMock).not.toHaveBeenCalled();
		expect(screen.getByText("invoice.pdf")).toBeInTheDocument();
	});

	it("renders inline search errors", async () => {
		searchMock.mockRejectedValue(new Error("Search backend unavailable"));

		renderDocuments();

		await screen.findByText("invoice.pdf");

		fireEvent.change(screen.getByLabelText("Query"), {
			target: { value: "invoice" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Search" }));

		await screen.findByText("Search backend unavailable");
		expect(screen.getByText('Showing 0 smart search results for "invoice"')).toBeInTheDocument();
	});
});
