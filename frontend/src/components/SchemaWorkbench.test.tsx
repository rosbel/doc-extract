import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SchemaWorkbench } from "./SchemaWorkbench";
import { api, type Schema } from "../api";

vi.mock("../api", () => ({
	api: {
		schemas: {
			create: vi.fn(),
			update: vi.fn(),
			assist: vi.fn(),
			revisions: vi.fn(),
			restoreRevision: vi.fn(),
		},
	},
}));

const createMock = vi.mocked(api.schemas.create);
const updateMock = vi.mocked(api.schemas.update);
const assistMock = vi.mocked(api.schemas.assist);
const revisionsMock = vi.mocked(api.schemas.revisions);
const restoreRevisionMock = vi.mocked(api.schemas.restoreRevision);

const baseSchema: Schema = {
	id: "schema-1",
	name: "Invoice",
	description: "Captures invoice totals",
	version: 2,
	jsonSchema: {
		type: "object",
		properties: {
			total: {
				type: "number",
				description: "Invoice total",
			},
		},
	},
	classificationHints: ["invoice"],
	status: "active",
	createdAt: "2026-03-09T12:00:00.000Z",
	updatedAt: "2026-03-09T12:00:00.000Z",
};

describe("SchemaWorkbench", () => {
	beforeEach(() => {
		createMock.mockReset();
		updateMock.mockReset();
		assistMock.mockReset();
		revisionsMock.mockReset();
		restoreRevisionMock.mockReset();
		revisionsMock.mockResolvedValue([]);
	});

	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
	});

	it("creates a schema manually", async () => {
		createMock.mockResolvedValue(baseSchema);

		render(
			<SchemaWorkbench onSaved={vi.fn()} onCancel={vi.fn()} />,
		);

		fireEvent.change(screen.getByLabelText("Name"), {
			target: { value: "Receipt" },
		});
		fireEvent.change(screen.getByLabelText("Description"), {
			target: { value: "Captures merchant receipts" },
		});
		fireEvent.change(screen.getByLabelText("Classification Hints"), {
			target: { value: "receipt, merchant" },
		});
		fireEvent.change(screen.getByLabelText("JSON Schema"), {
			target: {
				value: JSON.stringify(
					{
						type: "object",
						properties: {
							storeName: {
								type: "string",
								description: "Merchant name",
							},
						},
					},
					null,
					2,
				),
			},
		});

		fireEvent.click(screen.getByRole("button", { name: "Create Schema" }));

		await waitFor(() => {
			expect(createMock).toHaveBeenCalledWith({
				name: "Receipt",
				description: "Captures merchant receipts",
				jsonSchema: {
					type: "object",
					properties: {
						storeName: {
							type: "string",
							description: "Merchant name",
						},
					},
				},
				classificationHints: ["receipt", "merchant"],
				revision: {
					source: "manual",
				},
			});
		});
	});

	it("generates a draft from a prompt and saves it as an AI revision", async () => {
		createMock.mockResolvedValue(baseSchema);
		assistMock.mockResolvedValue({
			analysis: "A single schema fits the prompt.",
			proposals: [
				{
					name: "Contract",
					description: "Tracks contract parties and dates.",
					jsonSchema: {
						type: "object",
						properties: {
							parties: {
								type: "array",
								description: "Parties to the contract",
							},
						},
					},
					classificationHints: ["agreement", "contract"],
					reasoning: "The prompt focuses on agreement metadata.",
					matchingDocuments: [],
				},
			],
		});

		render(
			<SchemaWorkbench
				initialAssistantMode
				onSaved={vi.fn()}
				onCancel={vi.fn()}
			/>,
		);

		fireEvent.change(screen.getByLabelText("Prompt"), {
			target: { value: "Build a contract schema" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Generate Drafts" }));

		await screen.findByText("Contract");
		fireEvent.click(screen.getByRole("button", { name: "Load Draft" }));
		fireEvent.click(screen.getByRole("button", { name: "Create Schema" }));

		await waitFor(() => {
			expect(assistMock).toHaveBeenCalledWith({
				mode: "create",
				prompt: "Build a contract schema",
				schemaId: undefined,
				files: [],
			});
			expect(createMock).toHaveBeenCalledWith(
				expect.objectContaining({
					name: "Contract",
					revision: {
						source: "ai",
						summary: "The prompt focuses on agreement metadata.",
					},
				}),
			);
		});
	});

	it("supports file-based AI draft generation", async () => {
		assistMock.mockResolvedValue({
			analysis: "Generated from uploaded files.",
			proposals: [],
		});

		render(
			<SchemaWorkbench onSaved={vi.fn()} onCancel={vi.fn()} />,
		);

		const file = new File(["invoice body"], "invoice.pdf", {
			type: "application/pdf",
		});
		fireEvent.change(screen.getByLabelText("Sample Files"), {
			target: { files: [file] },
		});
		fireEvent.click(screen.getByRole("button", { name: "Generate Drafts" }));

		await waitFor(() => {
			expect(assistMock).toHaveBeenCalledWith({
				mode: "create",
				prompt: "",
				schemaId: undefined,
				files: [file],
			});
		});
	});

	it("shows edit diffs, applies them, and can discard the suggestion", async () => {
		updateMock.mockResolvedValue(baseSchema);
		assistMock.mockResolvedValue({
			analysis: "The schema should capture line items.",
			proposal: {
				name: "Invoice",
				description: "Captures invoice totals and line items.",
				jsonSchema: {
					type: "object",
					properties: {
						lineItems: {
							type: "array",
							description: "Line items",
						},
					},
				},
				classificationHints: ["invoice", "amount due"],
				reasoning: "The sample contains repeated charges.",
				matchingDocuments: ["invoice-1.pdf"],
			},
			diff: [
				{
					field: "description",
					label: "Description",
					changed: true,
					before: "Captures invoice totals",
					after: "Captures invoice totals and line items.",
				},
				{
					field: "jsonSchema",
					label: "JSON Schema",
					changed: true,
					before: baseSchema.jsonSchema,
					after: {
						type: "object",
						properties: {
							lineItems: {
								type: "array",
								description: "Line items",
							},
						},
					},
				},
			],
		});

		render(
			<SchemaWorkbench schema={baseSchema} onSaved={vi.fn()} onCancel={vi.fn()} />,
		);

		await waitFor(() => {
			expect(revisionsMock).toHaveBeenCalledWith("schema-1");
		});

		fireEvent.change(screen.getByLabelText("Prompt"), {
			target: { value: "Add line items" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Suggest Edits" }));

		await screen.findByText("Proposed Revision");
		fireEvent.click(screen.getAllByRole("button", { name: "Apply Field" })[0]);
		expect(screen.getByLabelText("Description")).toHaveValue(
			"Captures invoice totals and line items.",
		);

		fireEvent.click(screen.getByRole("button", { name: "Discard" }));
		expect(screen.queryByText("Proposed Revision")).not.toBeInTheDocument();
	});

	it("renders revisions and restores a selected snapshot", async () => {
		revisionsMock.mockResolvedValue([
			{
				id: "revision-3",
				schemaId: "schema-1",
				version: 3,
				name: "Invoice",
				description: "Captures invoice totals and dates",
				jsonSchema: baseSchema.jsonSchema,
				classificationHints: ["invoice"],
				source: "ai",
				summary: "Expanded date coverage",
				createdAt: "2026-03-09T12:30:00.000Z",
			},
		]);
		restoreRevisionMock.mockResolvedValue({
			...baseSchema,
			version: 3,
		});
		const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

		render(
			<SchemaWorkbench schema={baseSchema} onSaved={vi.fn()} onCancel={vi.fn()} />,
		);

		await screen.findByText("Version 3");
		fireEvent.click(screen.getByRole("button", { name: "Restore" }));

		await waitFor(() => {
			expect(confirmSpy).toHaveBeenCalled();
			expect(restoreRevisionMock).toHaveBeenCalledWith(
				"schema-1",
				"revision-3",
			);
		});
	});
});
