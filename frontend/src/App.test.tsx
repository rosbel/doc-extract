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

vi.mock("./pages/Admin", () => ({
	Admin: () => <div>Admin Page</div>,
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
		expect(screen.getByRole("link", { name: "Admin" })).toBeInTheDocument();
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

	it("preserves back and forward history between routes", async () => {
		const router = renderApp(["/documents"]);

		expect(await screen.findByText("Documents Page")).toBeInTheDocument();

		await router.navigate("/schemas");
		await waitFor(() => {
			expect(screen.getByText("Schemas Page")).toBeInTheDocument();
		});

		await router.navigate("/documents/doc-1");
		await waitFor(() => {
			expect(screen.getByText("Detail Page")).toBeInTheDocument();
		});

		await router.navigate(-1);
		await waitFor(() => {
			expect(screen.getByText("Schemas Page")).toBeInTheDocument();
		});

		await router.navigate(1);
		await waitFor(() => {
			expect(screen.getByText("Detail Page")).toBeInTheDocument();
		});
	});

	it("supports direct navigation to the admin route", async () => {
		const router = renderApp(["/admin"]);

		expect(await screen.findByText("Admin Page")).toBeInTheDocument();
		expect(router.state.location.pathname).toBe("/admin");
	});
});
