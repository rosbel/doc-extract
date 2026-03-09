import { unlink } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { Router } from "express";
import multer from "multer";
import { config } from "../config.js";
import { db } from "../db/index.js";
import { extractionSchemas } from "../db/schema.js";
import { logger } from "../lib/logger.js";
import { assistSchemaCreation, assistSchemaEdit } from "../services/schema-assistant.js";
import { parseFileSafe } from "../services/file-parser.js";
import {
	createSchemaWithRevision,
	listSchemaRevisions,
	restoreSchemaRevision,
	updateSchemaWithRevision,
} from "../services/schema-lifecycle.js";
import {
	createSchemaInput,
	schemaAssistRequestInput,
	updateSchemaInput,
} from "../validation/schemas.js";

export const schemasRouter = Router();

const upload = multer({
	dest: config.upload.dir,
	limits: { fileSize: config.upload.maxFileSize },
});

async function cleanupUploadedFiles(files: Express.Multer.File[]) {
	await Promise.allSettled(
		files.map(async (file) => {
			try {
				await unlink(file.path);
			} catch (error) {
				logger.warn("Failed to clean up schema assist upload", {
					filePath: file.path,
					error: error instanceof Error ? error.message : "Unknown",
				});
			}
		}),
	);
}

schemasRouter.post(
	"/assist",
	upload.array("files", 10),
	async (req, res, next) => {
		const files = (req.files as Express.Multer.File[] | undefined) ?? [];

		try {
			const input = schemaAssistRequestInput.parse({
				mode: req.body.mode,
				prompt: typeof req.body.prompt === "string" ? req.body.prompt : undefined,
				schemaId:
					typeof req.body.schemaId === "string" ? req.body.schemaId : undefined,
				hasFiles: files.length > 0,
			});

			const hasPrompt = Boolean(input.prompt?.trim());

			const parseResults = await Promise.all(
				files.map(async (file) => {
					const result = await parseFileSafe(file.path, file.mimetype);
					return { filename: file.originalname, ...result };
				}),
			);

			const warnings: Array<{ filename: string; warning: string }> = [];
			const validDocuments: Array<{ filename: string; text: string }> = [];

			for (const result of parseResults) {
				if (result.quality === "failed" || result.quality === "empty") {
					warnings.push({
						filename: result.filename,
						warning: result.warning ?? "File could not be processed",
					});
					continue;
				}

				if (result.warning) {
					warnings.push({
						filename: result.filename,
						warning: result.warning,
					});
				}

				validDocuments.push({
					filename: result.filename,
					text: result.text,
				});
			}

			if (files.length > 0 && validDocuments.length === 0 && !hasPrompt) {
				res.status(422).json({
					error:
						"None of the uploaded files could be parsed. Please try different files or add a prompt.",
					warnings,
				});
				return;
			}

			const activeSchemas = await db
				.select()
				.from(extractionSchemas)
				.where(eq(extractionSchemas.status, "active"));

			if (input.mode === "create") {
				const result = await assistSchemaCreation(
					validDocuments,
					activeSchemas,
					input.prompt,
				);

				res.json({
					...result,
					warnings: warnings.length > 0 ? warnings : undefined,
				});
				return;
			}

			const schemaId = input.schemaId;
			if (!schemaId) {
				res.status(400).json({ error: "schemaId is required in edit mode" });
				return;
			}
			const currentSchema = await db.query.extractionSchemas.findFirst({
				where: eq(extractionSchemas.id, schemaId),
			});
			if (!currentSchema) {
				res.status(404).json({ error: "Schema not found" });
				return;
			}

			const result = await assistSchemaEdit(
				currentSchema,
				validDocuments,
				input.prompt,
			);
			res.json({
				...result,
				warnings: warnings.length > 0 ? warnings : undefined,
			});
		} catch (error) {
			next(error);
		} finally {
			if (files.length > 0) {
				await cleanupUploadedFiles(files);
			}
		}
	},
);

// Create extraction schema
schemasRouter.post("/", async (req, res, next) => {
	try {
		const input = createSchemaInput.parse(req.body);
		const { schema } = await db.transaction((tx) =>
			createSchemaWithRevision(tx, input),
		);
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

schemasRouter.get("/:id/revisions", async (req, res, next) => {
	try {
		const schema = await db.query.extractionSchemas.findFirst({
			where: eq(extractionSchemas.id, req.params.id),
		});
		if (!schema) {
			res.status(404).json({ error: "Schema not found" });
			return;
		}

		const revisions = await listSchemaRevisions(db, req.params.id);
		res.json(revisions);
	} catch (error) {
		next(error);
	}
});

schemasRouter.post("/:id/revisions/:revisionId/restore", async (req, res, next) => {
	try {
		const restored = await db.transaction((tx) =>
			restoreSchemaRevision(tx, req.params.id, req.params.revisionId),
		);
		if (!restored) {
			res.status(404).json({ error: "Schema revision not found" });
			return;
		}

		res.json(restored.schema);
	} catch (error) {
		next(error);
	}
});

// Update schema
schemasRouter.put("/:id", async (req, res, next) => {
	try {
		const input = updateSchemaInput.parse(req.body);
		const updated = await db.transaction((tx) =>
			updateSchemaWithRevision(tx, req.params.id, input),
		);
		if (!updated) {
			res.status(404).json({ error: "Schema not found" });
			return;
		}
		res.json(updated.schema);
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
