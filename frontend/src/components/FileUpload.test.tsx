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

describe("FileUpload", () => {
	beforeEach(() => {
		uploadBatchMock.mockReset();
	});

	afterEach(() => {
		cleanup();
	});

	it("uploads multiple selected files in one batch and calls onUploaded once", async () => {
		uploadBatchMock.mockResolvedValueOnce({
			results: [
				{
					filename: "one.txt",
					status: "accepted",
				},
				{
					filename: "two.txt",
					status: "accepted",
				},
			],
			summary: {
				accepted: 2,
				duplicate: 0,
				failed: 0,
				total: 2,
			},
		});
		const onUploaded = vi.fn();
		render(<FileUpload onUploaded={onUploaded} />);

		const input = screen.getByLabelText(
			/drag & drop files here, or click to select/i,
		) as HTMLInputElement;
		const firstFile = new File(["one"], "one.txt", { type: "text/plain" });
		const secondFile = new File(["two"], "two.txt", { type: "text/plain" });

		fireEvent.change(input, {
			target: { files: [firstFile, secondFile] },
		});

		await waitFor(() => {
			expect(uploadBatchMock).toHaveBeenCalledWith([firstFile, secondFile]);
		});
		expect(onUploaded).toHaveBeenCalledTimes(1);
		expect(screen.getByText("Processed 2 files")).toBeInTheDocument();
	});

	it("uploads all dropped files in one batch", async () => {
		uploadBatchMock.mockResolvedValueOnce({
			results: [],
			summary: {
				accepted: 0,
				duplicate: 0,
				failed: 0,
				total: 0,
			},
		});
		const { container } = render(<FileUpload onUploaded={() => {}} />);

		const firstFile = new File(["one"], "one.txt", { type: "text/plain" });
		const secondFile = new File(["two"], "two.txt", { type: "text/plain" });

		fireEvent.drop(container.firstElementChild as HTMLElement, {
			dataTransfer: {
				files: [firstFile, secondFile],
			},
		});

		await waitFor(() => {
			expect(uploadBatchMock).toHaveBeenCalledWith([firstFile, secondFile]);
		});
	});

	it("renders mixed result feedback", async () => {
		uploadBatchMock.mockResolvedValueOnce({
			results: [
				{
					filename: "accepted.txt",
					status: "accepted",
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
		});
		render(<FileUpload onUploaded={() => {}} />);

		const input = screen.getByLabelText(
			/drag & drop files here, or click to select/i,
		) as HTMLInputElement;
		fireEvent.change(input, {
			target: {
				files: [new File(["x"], "mixed.txt", { type: "text/plain" })],
			},
		});

		await screen.findByText("Accepted: 1 · Duplicates: 1 · Failed: 1");
		expect(screen.getByText("duplicate.txt: duplicate (doc-9)")).toBeInTheDocument();
		expect(screen.getByText("failed.txt: Parse exploded")).toBeInTheDocument();
	});
});
