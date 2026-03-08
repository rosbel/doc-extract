import { eq } from "drizzle-orm";
import { Router } from "express";
import multer from "multer";
import { config } from "../config.js";
import { db } from "../db/index.js";
import { extractionSchemas } from "../db/schema.js";
import { logger } from "../lib/logger.js";
import { parseFile } from "../services/file-parser.js";
import { recommendSchemas } from "../services/schema-recommender.js";

const upload = multer({
	dest: config.upload.dir,
	limits: { fileSize: config.upload.maxFileSize },
});

export const recommendationsRouter = Router();

recommendationsRouter.post(
	"/",
	upload.array("files", 10),
	async (req, res, next) => {
		try {
			const files = req.files as Express.Multer.File[] | undefined;
			if (!files || files.length === 0) {
				res.status(400).json({ error: "No files uploaded" });
				return;
			}

			// Parse each file
			const documents = await Promise.all(
				files.map(async (file) => {
					const text = await parseFile(file.path, file.mimetype);
					return { filename: file.originalname, text };
				}),
			);

			// Fetch active schemas for dedup awareness
			const activeSchemas = await db
				.select()
				.from(extractionSchemas)
				.where(eq(extractionSchemas.status, "active"));

			const result = await recommendSchemas(documents, activeSchemas);

			logger.info("Recommendations generated", {
				fileCount: files.length,
				recommendationCount: result.recommendations.length,
			});

			res.json(result);
		} catch (err) {
			next(err);
		}
	},
);
