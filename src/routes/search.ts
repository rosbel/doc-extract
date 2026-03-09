import { Router } from "express";
import { searchDocuments } from "../services/search.js";
import { searchInput } from "../validation/schemas.js";

export const searchRouter = Router();

searchRouter.post("/", async (req, res, next) => {
	try {
		const input = searchInput.parse(req.body);
		const mode = input.mode === "semantic" ? "hybrid" : input.mode;
		const response = await searchDocuments({
			query: input.query,
			limit: input.limit,
			mode,
			schemaId: input.schemaId,
		});
		res.json(response);
	} catch (err) {
		next(err);
	}
});
