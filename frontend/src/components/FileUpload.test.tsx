import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileUpload } from "./FileUpload";
import { api } from "../api";

vi.mock("../api", () => ({
	api: {
		documents: {
			uploadBatch: vi.fn(),
		},
	},
}));

const uploadBatchMock = vi.mocked(api.documents.uploadBatch);

function createFile(name: string, contents: string, type = "text/plain") {
	return new File([contents], name, { type });
}

describe("FileUpload", () => {
	beforeEach(() => {
		uploadBatchMock.mockReset();
	});

	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
	});

	it("stages multiple files without uploading immediately", async () => {
		const onUploaded = vi.fn();
		render(<FileUpload onUploaded={onUploaded} />);

		fireEvent.change(screen.getByLabelText("Select documents"), {
			target: {
				files: [
					createFile("invoice-a.txt", "one"),
					createFile("invoice-b.txt", "two"),
				],
			},
		});

		expect(screen.getByText("invoice-a.txt")).toBeInTheDocument();
		expect(screen.getByText("invoice-b.txt")).toBeInTheDocument();
		expect(uploadBatchMock).not.toHaveBeenCalled();
		expect(onUploaded).not.toHaveBeenCalled();
	});

	it("does not upload dropped files until continue is pressed", async () => {
		uploadBatchMock.mockResolvedValueOnce({
			results: [
				{
					filename: "one.txt",
					status: "accepted",
					document: { id: "doc-1", status: "pending" },
				},
				{
					filename: "two.txt",
					status: "accepted",
					document: { id: "doc-2", status: "pending" },
				},
			],
			summary: {
				accepted: 2,
				duplicate: 0,
				failed: 0,
				total: 2,
			},
		} as never);
		const onUploaded = vi.fn();
		render(<FileUpload onUploaded={onUploaded} />);

		const firstFile = createFile("one.txt", "one");
		const secondFile = createFile("two.txt", "two");
		const dropZone = screen
			.getByText(/drag & drop files here, or click to select/i)
			.closest("div");
		if (!dropZone) {
			throw new Error("Drop zone not found");
		}
		fireEvent.drop(dropZone, {
			dataTransfer: {
				files: [firstFile, secondFile],
			},
		});

		expect(uploadBatchMock).not.toHaveBeenCalled();
		expect(screen.getByText("one.txt")).toBeInTheDocument();
		expect(screen.getByText("two.txt")).toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: "Continue" }));

		await waitFor(() => {
			expect(uploadBatchMock).toHaveBeenCalledWith([firstFile, secondFile]);
		});
		await waitFor(() => {
			expect(onUploaded).toHaveBeenCalledTimes(1);
		});
	});

	it("removes declined files before batching the upload", async () => {
		uploadBatchMock.mockResolvedValueOnce({
			results: [
				{
					filename: "invoice-a.txt",
					status: "accepted",
					document: { id: "doc-1", status: "pending" },
				},
			],
			summary: {
				accepted: 1,
				duplicate: 0,
				failed: 0,
				total: 1,
			},
		} as never);
		const onUploaded = vi.fn();
		render(<FileUpload onUploaded={onUploaded} />);

		const firstFile = createFile("invoice-a.txt", "one");
		const secondFile = createFile("invoice-b.txt", "two");

		fireEvent.change(screen.getByLabelText("Select documents"), {
			target: {
				files: [firstFile, secondFile],
			},
		});

		fireEvent.click(screen.getByRole("button", { name: "Decline invoice-b.txt" }));
		fireEvent.click(screen.getByRole("button", { name: "Continue" }));

		await waitFor(() => {
			expect(uploadBatchMock).toHaveBeenCalledWith([firstFile]);
		});
		expect(screen.queryByText("invoice-b.txt")).not.toBeInTheDocument();
		await waitFor(() => {
			expect(onUploaded).toHaveBeenCalledTimes(1);
		});
	});

	it("keeps accepted, duplicate, and failed results visible in the review list", async () => {
		uploadBatchMock.mockResolvedValueOnce({
			results: [
				{
					filename: "accepted.txt",
					status: "accepted",
					document: { id: "doc-1", status: "pending" },
				},
				{
					filename: "duplicate.txt",
					status: "duplicate",
					existingDocumentId: "doc-9",
				},
				{
					filename: "failed.txt",
					status: "failed",
					error: "Parse exploded",
				},
			],
			summary: {
				accepted: 1,
				duplicate: 1,
				failed: 1,
				total: 3,
			},
		} as never);
		const onUploaded = vi.fn();
		render(<FileUpload onUploaded={onUploaded} />);

		fireEvent.change(screen.getByLabelText("Select documents"), {
			target: {
				files: [
					createFile("accepted.txt", "one"),
					createFile("duplicate.txt", "two"),
					createFile("failed.txt", "three"),
				],
			},
		});

		fireEvent.click(screen.getByRole("button", { name: "Continue" }));

		await screen.findByText("Accepted: 1 · Duplicates: 1 · Failed: 1");
		expect(screen.getByText("accepted.txt")).toBeInTheDocument();
		expect(screen.getByText("duplicate.txt")).toBeInTheDocument();
		expect(screen.getByText("failed.txt")).toBeInTheDocument();
		expect(screen.getByText("uploaded")).toBeInTheDocument();
		expect(screen.getByText("duplicate")).toBeInTheDocument();
		expect(screen.getByText("failed")).toBeInTheDocument();
		expect(screen.getByText("Duplicate of doc-9")).toBeInTheDocument();
		expect(screen.getByText("Parse exploded")).toBeInTheDocument();
		await waitFor(() => {
			expect(onUploaded).toHaveBeenCalledTimes(1);
		});
	});

	it("keeps the selection staged when the batch request fails", async () => {
		uploadBatchMock.mockRejectedValueOnce(new Error("Upload failed"));
		const onUploaded = vi.fn();
		render(<FileUpload onUploaded={onUploaded} />);

		fireEvent.change(screen.getByLabelText("Select documents"), {
			target: {
				files: [
					createFile("duplicate.txt", "one"),
					createFile("fresh.txt", "two"),
				],
			},
		});

		fireEvent.click(screen.getByRole("button", { name: "Continue" }));

		await screen.findByText("Upload failed");
		expect(screen.getByText("duplicate.txt")).toBeInTheDocument();
		expect(screen.getByText("fresh.txt")).toBeInTheDocument();
		expect(screen.getAllByText("pending")).toHaveLength(2);
		expect(onUploaded).not.toHaveBeenCalled();
	});
});
