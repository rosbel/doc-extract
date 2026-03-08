import { and, eq, or, sql } from "drizzle-orm";
import { Router } from "express";
import { db } from "../db/index.js";
import { documents } from "../db/schema.js";
import { searchDocument } from "../services/vector-store.js";
import { searchInput } from "../validation/schemas.js";

export const searchRouter = Router();

searchRouter.post("/", async (req, res, next) => {
	try {
		const input = searchInput.parse(req.body);

		if (input.mode === "semantic") {
			const results = await searchDocument(input.query, input.limit);
			res.json({ results, mode: "semantic" });
			return;
		}

		// Keyword search: full-text search on raw_text + ILIKE on extracted_data
		const conditions = [
			sql`to_tsvector('english', coalesce(${documents.rawText}, '')) @@ plainto_tsquery('english', ${input.query})`,
			sql`${documents.extractedData}::text ILIKE ${"%" + input.query + "%"}`,
		];

		const schemaFilter = input.schemaId
			? eq(documents.schemaId, input.schemaId)
			: undefined;

		const searchFilter = or(...conditions);
		const where = schemaFilter ? and(searchFilter, schemaFilter) : searchFilter;

		const results = await db
			.select({
				id: documents.id,
				filename: documents.filename,
				status: documents.status,
				extractedData: documents.extractedData,
				extractionConfidence: documents.extractionConfidence,
				schemaId: documents.schemaId,
				createdAt: documents.createdAt,
			})
			.from(documents)
			.where(where)
			.limit(input.limit);

		res.json({ results, mode: "keyword" });
	} catch (err) {
		next(err);
	}
});
