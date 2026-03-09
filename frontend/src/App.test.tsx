import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RouterProvider, createMemoryRouter } from "react-router-dom";

vi.mock("./pages/Documents", () => ({
	Documents: () => <div>Documents Page</div>,
}));

vi.mock("./pages/Schemas", () => ({
	Schemas: () => <div>Schemas Page</div>,
}));

vi.mock("./pages/DocumentDetail", () => ({
	DocumentDetail: () => <div>Detail Page</div>,
}));

vi.mock("./pages/SchemaWorkbenchPage", () => ({
	SchemaWorkbenchPage: ({ mode }: { mode: "create" | "edit" }) => (
		<div>{mode === "create" ? "Create Schema Page" : "Edit Schema Page"}</div>
	),
}));

vi.mock("./pages/NotFound", () => ({
	NotFound: () => <div>Not Found Page</div>,
}));

import { appRoutes } from "./router";

function renderApp(initialEntries: string[]) {
	const router = createMemoryRouter(appRoutes, { initialEntries });
	render(<RouterProvider router={router} />);
	return router;
}

describe("App routing", () => {
	afterEach(() => {
		cleanup();
	});

	it("does not render a separate Recommend navigation item", async () => {
		renderApp(["/documents"]);

		expect(await screen.findByText("Documents Page")).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "Documents" })).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "Schemas" })).toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: /recommend/i }),
		).not.toBeInTheDocument();
	});

	it("supports direct navigation to schema create and edit routes", async () => {
		let router = renderApp(["/schemas/new"]);

		expect(await screen.findByText("Create Schema Page")).toBeInTheDocument();

		cleanup();
		router = renderApp(["/schemas/schema-1/edit"]);

		expect(await screen.findByText("Edit Schema Page")).toBeInTheDocument();
		expect(router.state.location.pathname).toBe("/schemas/schema-1/edit");
	});

	it("renders direct entries for schemas and document detail routes", async () => {
		let router = renderApp(["/schemas"]);

		expect(await screen.findByText("Schemas Page")).toBeInTheDocument();

		cleanup();
		router = renderApp(["/documents/doc-1"]);

		expect(await screen.findByText("Detail Page")).toBeInTheDocument();
		expect(router.state.location.pathname).toBe("/documents/doc-1");
	});

	it("renders the not found page for unknown routes", async () => {
		const router = renderApp(["/does-not-exist"]);

		expect(await screen.findByText("Not Found Page")).toBeInTheDocument();
		expect(router.state.location.pathname).toBe("/does-not-exist");
		expect(screen.getByRole("link", { name: "Documents" })).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "Schemas" })).toBeInTheDocument();
	});
});
