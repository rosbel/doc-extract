import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

	it("renders the search form and keyword search results", async () => {
		searchMock.mockResolvedValue({
			mode: "keyword",
			results: [
				{
					id: "doc-2",
					filename: "invoice-result.pdf",
					status: "completed",
					extractedData: { vendor: "Acme" },
					extractionConfidence: 0.88,
					schemaId: "schema-1",
					createdAt: "2026-03-09T12:00:00.000Z",
				},
			],
		});

		render(<Documents onSelectDocument={vi.fn()} />);

		await screen.findByText("invoice.pdf");
		expect(screen.getByText("Search Documents")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Keyword" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Semantic" })).toBeInTheDocument();

		fireEvent.change(screen.getByLabelText("Query"), {
			target: { value: "invoice" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Search" }));

		await screen.findByText('Showing 1 keyword result for "invoice"');
		expect(searchMock).toHaveBeenCalledWith({
			query: "invoice",
			mode: "keyword",
			limit: 10,
		});
		expect(screen.getByText("invoice-result.pdf")).toBeInTheDocument();
		expect(screen.getByText(/Invoice \(schema-1/i)).toBeInTheDocument();
	});

	it("submits semantic search with a schema filter and opens document detail on click", async () => {
		const onSelectDocument = vi.fn();
		searchMock.mockResolvedValue({
			mode: "semantic",
			results: [
				{
					id: "doc-3",
					score: 0.973,
					metadata: {
						filename: "semantic-result.pdf",
						summary: "High-confidence invoice embedding match",
					},
				},
			],
		});

		render(<Documents onSelectDocument={onSelectDocument} />);

		await screen.findByText("invoice.pdf");

		fireEvent.change(screen.getByLabelText("Query"), {
			target: { value: "acme" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Semantic" }));
		fireEvent.change(screen.getByLabelText("Schema"), {
			target: { value: "schema-1" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Search" }));

		await screen.findByText('Showing 1 semantic result for "acme"');
		expect(searchMock).toHaveBeenCalledWith({
			query: "acme",
			mode: "semantic",
			limit: 10,
			schemaId: "schema-1",
		});
		expect(screen.getByText("semantic-result.pdf")).toBeInTheDocument();
		expect(screen.getByText("97.3%")).toBeInTheDocument();

		fireEvent.click(screen.getByText("semantic-result.pdf"));
		expect(onSelectDocument).toHaveBeenCalledWith("doc-3");
	});

	it("clears search state and returns to the document list", async () => {
		searchMock.mockResolvedValue({
			mode: "keyword",
			results: [],
		});

		render(<Documents onSelectDocument={vi.fn()} />);

		await screen.findByText("invoice.pdf");

		fireEvent.change(screen.getByLabelText("Query"), {
			target: { value: "invoice" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Search" }));

		await screen.findByText('Showing 0 keyword results for "invoice"');
		expect(screen.getByText("No keyword matches found.")).toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: "Clear" }));

		await waitFor(() => {
			expect(screen.queryByText("No keyword matches found.")).not.toBeInTheDocument();
		});
		expect(screen.getByLabelText("Query")).toHaveValue("");
		expect(screen.getByText("invoice.pdf")).toBeInTheDocument();
	});

	it("does not search when the query is empty", async () => {
		render(<Documents onSelectDocument={vi.fn()} />);

		await screen.findByText("invoice.pdf");

		fireEvent.click(screen.getByRole("button", { name: "Search" }));

		expect(searchMock).not.toHaveBeenCalled();
		expect(screen.getByText("invoice.pdf")).toBeInTheDocument();
	});

	it("renders inline search errors", async () => {
		searchMock.mockRejectedValue(new Error("Search backend unavailable"));

		render(<Documents onSelectDocument={vi.fn()} />);

		await screen.findByText("invoice.pdf");

		fireEvent.change(screen.getByLabelText("Query"), {
			target: { value: "invoice" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Search" }));

		await screen.findByText("Search backend unavailable");
		expect(screen.getByText('Showing 0 keyword results for "invoice"')).toBeInTheDocument();
	});
});
