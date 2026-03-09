import { eq } from "drizzle-orm";
import { Router } from "express";
import { db } from "../db/index.js";
import { extractionSchemas } from "../db/schema.js";
import { createSchemaInput, updateSchemaInput } from "../validation/schemas.js";

export const schemasRouter = Router();

// Create extraction schema
schemasRouter.post("/", async (req, res, next) => {
	try {
		const input = createSchemaInput.parse(req.body);
		const [schema] = await db
			.insert(extractionSchemas)
			.values({
				name: input.name,
				description: input.description,
				jsonSchema: input.jsonSchema,
				classificationHints: input.classificationHints,
			})
			.returning();
		res.status(201).json(schema);
	} catch (err) {
		next(err);
	}
});

// List active schemas
schemasRouter.get("/", async (_req, res, next) => {
	try {
		const schemas = await db
			.select()
			.from(extractionSchemas)
			.where(eq(extractionSchemas.status, "active"))
			.orderBy(extractionSchemas.createdAt);
		res.json(schemas);
	} catch (err) {
		next(err);
	}
});

// Get schema by ID
schemasRouter.get("/:id", async (req, res, next) => {
	try {
		const schema = await db.query.extractionSchemas.findFirst({
			where: eq(extractionSchemas.id, req.params.id),
		});
		if (!schema) {
			res.status(404).json({ error: "Schema not found" });
			return;
		}
		res.json(schema);
	} catch (err) {
		next(err);
	}
});

// Update schema
schemasRouter.put("/:id", async (req, res, next) => {
	try {
		const input = updateSchemaInput.parse(req.body);
		const [updated] = await db
			.update(extractionSchemas)
			.set({ ...input, updatedAt: new Date() })
			.where(eq(extractionSchemas.id, req.params.id))
			.returning();
		if (!updated) {
			res.status(404).json({ error: "Schema not found" });
			return;
		}
		res.json(updated);
	} catch (err) {
		next(err);
	}
});

// Soft delete (archive) schema
schemasRouter.delete("/:id", async (req, res, next) => {
	try {
		const [archived] = await db
			.update(extractionSchemas)
			.set({ status: "archived", updatedAt: new Date() })
			.where(eq(extractionSchemas.id, req.params.id))
			.returning();
		if (!archived) {
			res.status(404).json({ error: "Schema not found" });
			return;
		}
		res.json(archived);
	} catch (err) {
		next(err);
	}
});
