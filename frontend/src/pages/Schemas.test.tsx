import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { Schemas } from "./Schemas";
import { api } from "../api";

vi.mock("../api", () => ({
	api: {
		schemas: {
			list: vi.fn(),
			delete: vi.fn(),
		},
	},
}));

const listMock = vi.mocked(api.schemas.list);
const deleteMock = vi.mocked(api.schemas.delete);

describe("Schemas page", () => {
	beforeEach(() => {
		listMock.mockReset();
		deleteMock.mockReset();
	});

	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
	});

	it("shows a single new schema entry point", async () => {
		listMock.mockResolvedValue([]);

		render(
			<MemoryRouter>
				<Schemas />
			</MemoryRouter>,
		);

		expect(await screen.findByText("No schemas yet.")).toBeInTheDocument();
		expect(screen.getAllByRole("link", { name: "New Schema" })).toHaveLength(1);
		expect(
			screen.queryByRole("button", { name: /generate with ai/i }),
		).not.toBeInTheDocument();
	});

	it("renders polished edit and archive actions with accessible labels", async () => {
		listMock.mockResolvedValue([
			{
				id: "schema-1",
				name: "Invoice",
				description: "Captures invoice totals",
				version: 2,
				jsonSchema: { type: "object" },
				classificationHints: ["invoice"],
				status: "active",
				createdAt: "2026-03-09T12:00:00.000Z",
				updatedAt: "2026-03-09T12:00:00.000Z",
			},
		]);
		deleteMock.mockResolvedValue({
			id: "schema-1",
		} as never);

		render(
			<MemoryRouter>
				<Schemas />
			</MemoryRouter>,
		);

		expect(await screen.findByText("Invoice")).toBeInTheDocument();
		expect(
			screen.getByRole("link", { name: "Edit schema Invoice" }),
		).toHaveAttribute("href", "/schemas/schema-1/edit");
		expect(
			screen.getByRole("button", { name: "Archive schema Invoice" }),
		).toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: "Archive schema Invoice" }));

		await waitFor(() => {
			expect(deleteMock).toHaveBeenCalledWith("schema-1");
		});
	});
});
