import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("./pages/Documents", () => ({
	Documents: () => <div>Documents Page</div>,
}));

vi.mock("./pages/Schemas", () => ({
	Schemas: () => <div>Schemas Page</div>,
}));

vi.mock("./pages/DocumentDetail", () => ({
	DocumentDetail: () => <div>Detail Page</div>,
}));

import App from "./App";

describe("App navigation", () => {
	it("does not render a separate Recommend navigation item", async () => {
		render(<App />);

		expect(await screen.findByRole("button", { name: "Documents" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Schemas" })).toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: /recommend/i }),
		).not.toBeInTheDocument();
	});
});
