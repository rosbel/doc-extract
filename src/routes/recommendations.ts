import { unlink } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { Router } from "express";
import multer from "multer";
import { config } from "../config.js";
import { db } from "../db/index.js";
import { extractionSchemas } from "../db/schema.js";
import { logger } from "../lib/logger.js";
import { parseFileSafe } from "../services/file-parser.js";
import { recommendSchemas } from "../services/schema-recommender.js";

const upload = multer({
	dest: config.upload.dir,
	limits: { fileSize: config.upload.maxFileSize },
});

export const recommendationsRouter = Router();

async function cleanupUploadedFiles(files: Express.Multer.File[]) {
	await Promise.allSettled(
		files.map(async (file) => {
			try {
				await unlink(file.path);
			} catch (err) {
				logger.warn("Failed to clean up recommendation upload", {
					filePath: file.path,
					error: err instanceof Error ? err.message : "Unknown",
				});
			}
		}),
	);
}

recommendationsRouter.post(
	"/",
	upload.array("files", 10),
	async (req, res, next) => {
		const files = (req.files as Express.Multer.File[] | undefined) ?? [];

		try {
			if (files.length === 0) {
				res.status(400).json({ error: "No files uploaded" });
				return;
			}

			// Parse each file resiliently
			const parseResults = await Promise.all(
				files.map(async (file) => {
					const result = await parseFileSafe(file.path, file.mimetype);
					return { filename: file.originalname, ...result };
				}),
			);

			// Separate valid documents from warnings
			const fileWarnings: Array<{ filename: string; warning: string }> = [];
			const validDocuments: Array<{ filename: string; text: string }> = [];

			for (const r of parseResults) {
				if (r.quality === "failed" || r.quality === "empty") {
					fileWarnings.push({
						filename: r.filename,
						warning: r.warning ?? "File could not be processed",
					});
				} else {
					if (r.warning) {
						fileWarnings.push({ filename: r.filename, warning: r.warning });
					}
					validDocuments.push({ filename: r.filename, text: r.text });
				}
			}

			if (validDocuments.length === 0) {
				res.status(422).json({
					error:
						"None of the uploaded files could be parsed. Please try different files.",
					warnings: fileWarnings,
				});
				return;
			}

			// Fetch active schemas for dedup awareness
			const activeSchemas = await db
				.select()
				.from(extractionSchemas)
				.where(eq(extractionSchemas.status, "active"));

			const result = await recommendSchemas(validDocuments, activeSchemas);

			logger.info("Recommendations generated", {
				fileCount: files.length,
				validCount: validDocuments.length,
				warningCount: fileWarnings.length,
				recommendationCount: result.recommendations.length,
			});

			res.json({
				...result,
				warnings: fileWarnings.length > 0 ? fileWarnings : undefined,
			});
		} catch (err) {
			next(err);
		} finally {
			if (files.length > 0) {
				await cleanupUploadedFiles(files);
			}
		}
	},
);
