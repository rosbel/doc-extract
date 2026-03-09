import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	Link,
	Outlet,
	RouterProvider,
	createMemoryRouter,
	useNavigate,
} from "react-router-dom";
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

function renderWorkbench(
	ui: ReactElement,
	{
		withLeaveLink = false,
	}: { withLeaveLink?: boolean } = {},
) {
	const router = createMemoryRouter(
		[
			{
				path: "/",
				element: (
					<>
						{withLeaveLink && <Link to="/schemas">Leave page</Link>}
						<Outlet />
					</>
				),
				children: [
					{ path: "schemas/new", element: ui },
					{ path: "schemas", element: <div>Schemas Route</div> },
				],
			},
		],
		{
			initialEntries: ["/schemas/new"],
		},
	);

	return render(
		<RouterProvider router={router} />,
	);
}

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

		renderWorkbench(
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

		renderWorkbench(
			<SchemaWorkbench
				assistantFirst
				onSaved={vi.fn()}
				onCancel={vi.fn()}
			/>,
		);

		fireEvent.change(screen.getByLabelText("Optional Guidance"), {
			target: { value: "Build a contract schema" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Generate Drafts" }));

		await screen.findByRole("heading", { name: "Review the detected schema draft" });
		expect(
			screen.queryByRole("heading", {
				name: "Detect schema drafts from uploaded documents",
			}),
		).not.toBeInTheDocument();
		expect(
			screen.getByRole("heading", { name: "Review the detected schema draft" }),
		).toBeInTheDocument();
		expect(screen.getByText(/"parties"/)).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "Use Draft" }));
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

		renderWorkbench(
			<SchemaWorkbench assistantFirst onSaved={vi.fn()} onCancel={vi.fn()} />,
		);

		const file = new File(["invoice body"], "invoice.pdf", {
			type: "application/pdf",
		});
		fireEvent.change(screen.getByLabelText("Documents for AI Detection"), {
			target: { files: [file] },
		});
		fireEvent.click(screen.getByRole("button", { name: "Analyze Documents" }));

		await waitFor(() => {
			expect(assistMock).toHaveBeenCalledWith({
				mode: "create",
				prompt: "",
				schemaId: undefined,
				files: [file],
			});
		});

		expect(
			screen.getByText(
				"AI could not detect a reusable schema draft from those documents yet. Add optional guidance or upload more representative files.",
			),
		).toBeInTheDocument();
	});

	it("keeps draft review in place, supports proposal switching, and can return to analysis", async () => {
		assistMock.mockResolvedValue({
			analysis: "Two drafts match the uploaded documents.",
			proposals: [
				{
					name: "Event RSVP",
					description: "Tracks event responses.",
					jsonSchema: {
						type: "object",
						properties: {
							guestName: {
								type: "string",
								description: "Guest name",
							},
						},
					},
					classificationHints: ["rsvp"],
					reasoning: "The files look like RSVP exports.",
					matchingDocuments: ["rsvp.csv"],
				},
				{
					name: "Guest Manifest",
					description: "Tracks expected attendees.",
					jsonSchema: {
						type: "object",
						properties: {
							partySize: {
								type: "number",
								description: "Number of guests in party",
							},
						},
					},
					classificationHints: ["guest list"],
					reasoning: "The files emphasize attendee counts.",
					matchingDocuments: ["guest-list.csv"],
				},
			],
		});

		renderWorkbench(
			<SchemaWorkbench assistantFirst onSaved={vi.fn()} onCancel={vi.fn()} />,
		);

		const file = new File(["name,count"], "rsvp.csv", {
			type: "text/csv",
		});
		fireEvent.change(screen.getByLabelText("Documents for AI Detection"), {
			target: { files: [file] },
		});
		fireEvent.change(screen.getByLabelText("Optional Guidance"), {
			target: { value: "Prioritize RSVP semantics" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Analyze Documents" }));

		await screen.findByRole("heading", { name: "Review the detected schema draft" });
		expect(screen.getByRole("button", { name: "Event RSVP" })).toBeInTheDocument();
		expect(screen.getByText(/guestName/)).toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: "Guest Manifest" }));
		expect(screen.getByText("Tracks expected attendees.")).toBeInTheDocument();
		expect(screen.getByText(/partySize/)).toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: "Analyze Again" }));

		expect(
			screen.getByRole("heading", {
				name: "Detect schema drafts from uploaded documents",
			}),
		).toBeInTheDocument();
		expect(screen.getByLabelText("Optional Guidance")).toHaveValue(
			"Prioritize RSVP semantics",
		);
		expect(screen.getByText("rsvp.csv")).toBeInTheDocument();
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

		renderWorkbench(
			<SchemaWorkbench schema={baseSchema} onSaved={vi.fn()} onCancel={vi.fn()} />,
		);

		await waitFor(() => {
			expect(revisionsMock).toHaveBeenCalledWith("schema-1");
		});

		fireEvent.change(screen.getByLabelText("Optional Guidance"), {
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

		renderWorkbench(
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

	it("renders the assistant section first on create routes", () => {
		renderWorkbench(
			<SchemaWorkbench assistantFirst onSaved={vi.fn()} onCancel={vi.fn()} />,
		);

		const assistantHeading = screen.getByText(
			"Detect schema drafts from uploaded documents",
		);
		const manualHeading = screen.getByText(
			"Review or refine the schema manually",
		);

		expect(
			Boolean(
				assistantHeading.compareDocumentPosition(manualHeading) &
					Node.DOCUMENT_POSITION_FOLLOWING,
			),
		).toBe(true);
	});

	it("highlights the editor after using a detected draft", async () => {
		assistMock.mockResolvedValue({
			analysis: "One schema fits the documents.",
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

		renderWorkbench(
			<SchemaWorkbench assistantFirst onSaved={vi.fn()} onCancel={vi.fn()} />,
		);

		fireEvent.change(screen.getByLabelText("Optional Guidance"), {
			target: { value: "Build a contract schema" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Generate Drafts" }));

		await screen.findByRole("button", { name: "Use Draft" });
		fireEvent.click(screen.getByRole("button", { name: "Use Draft" }));

		expect(screen.getByLabelText("Name")).toHaveValue("Contract");
		expect(screen.getByText("Draft loaded into editor")).toBeInTheDocument();
		expect(screen.getByLabelText("Name").closest(".rounded-2xl")).toHaveClass(
			"border-sky-300",
		);
	});

	it("prompts before leaving with unsaved edits", async () => {
		const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

		renderWorkbench(
			<SchemaWorkbench assistantFirst onSaved={vi.fn()} onCancel={vi.fn()} />,
			{ withLeaveLink: true },
		);

		fireEvent.change(screen.getByLabelText("Name"), {
			target: { value: "Unsaved draft" },
		});
		fireEvent.click(screen.getByRole("link", { name: "Leave page" }));

		await waitFor(() => {
			expect(confirmSpy).toHaveBeenCalled();
		});
	});

	it("does not prompt after a successful save navigation", async () => {
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
		const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

		function SaveAndNavigateWorkbench() {
			const navigate = useNavigate();

			return (
				<SchemaWorkbench
					assistantFirst
					onSaved={() => navigate("/schemas")}
					onCancel={vi.fn()}
				/>
			);
		}

		renderWorkbench(<SaveAndNavigateWorkbench />);

		fireEvent.change(screen.getByLabelText("Optional Guidance"), {
			target: { value: "Build a contract schema" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Generate Drafts" }));

		await screen.findByRole("button", { name: "Use Draft" });
		fireEvent.click(screen.getByRole("button", { name: "Use Draft" }));
		fireEvent.click(screen.getByRole("button", { name: "Create Schema" }));

		await screen.findByText("Schemas Route");
		expect(confirmSpy).not.toHaveBeenCalled();
	});
});
