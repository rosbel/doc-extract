import { readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { and, desc, eq, sql } from "drizzle-orm";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import multer from "multer";
import { config } from "../config.js";
import { db } from "../db/index.js";
import { documents, processingJobs } from "../db/schema.js";
import { isDuplicateKeyError } from "../lib/db-errors.js";
import { hashBuffer } from "../lib/hashing.js";
import { logger } from "../lib/logger.js";
import { enqueueClassification } from "../queue/jobs.js";
import { parseFile } from "../services/file-parser.js";
import type { Document } from "../types/index.js";
import { documentQueryInput } from "../validation/schemas.js";

const upload = multer({
	dest: config.upload.dir,
	limits: { fileSize: config.upload.maxFileSize },
});
const batchUpload = multer({
	dest: config.upload.dir,
	limits: {
		fileSize: config.upload.maxFileSize,
		files: config.upload.maxFilesPerBatch,
	},
});
const uploadLimiter = rateLimit({
	windowMs: config.rateLimit.documentUploadWindowMs,
	limit: config.rateLimit.documentUploadsPerWindow,
	standardHeaders: "draft-7",
	legacyHeaders: false,
	message: { error: "Too many uploads, please try again later" },
});

export const documentsRouter = Router();

type UploadResult =
	| {
			status: "accepted";
			document: Document;
	  }
	| {
			status: "duplicate";
			existingDocumentId?: string;
	  };

type BatchUploadResult =
	| {
			filename: string;
			status: "accepted";
			document: Document;
	  }
	| {
			filename: string;
			status: "duplicate";
			existingDocumentId?: string;
	  }
	| {
			filename: string;
			status: "failed";
			error: string;
	  };

async function cleanupUpload(filePath: string) {
	try {
		await unlink(filePath);
	} catch (err) {
		logger.warn("Failed to clean up uploaded file", {
			filePath,
			error: err instanceof Error ? err.message : "Unknown",
		});
	}
}

async function ingestUploadedFile(
	file: Express.Multer.File,
): Promise<UploadResult> {
	let shouldCleanupUpload = true;
	let contentHash: string | undefined;

	try {
		const fileBuffer = await readFile(file.path);
		contentHash = hashBuffer(fileBuffer);

		const existing = await db.query.documents.findFirst({
			where: eq(documents.contentHash, contentHash),
		});
		if (existing) {
			await cleanupUpload(file.path);
			shouldCleanupUpload = false;
			return {
				status: "duplicate",
				existingDocumentId: existing.id,
			};
		}

		const rawText = await parseFile(file.path, file.mimetype);

		const [doc] = await db
			.insert(documents)
			.values({
				filename: file.originalname,
				mimeType: file.mimetype,
				fileSize: file.size,
				contentHash,
				rawText,
				searchText: rawText,
				storagePath: file.path,
			})
			.returning();
		shouldCleanupUpload = false;

		try {
			await enqueueClassification(doc.id);
		} catch (err) {
			const errorMessage =
				err instanceof Error
					? err.message
					: "Failed to enqueue document for processing";
			await db
				.update(documents)
				.set({
					status: "failed",
					errorMessage,
					updatedAt: new Date(),
				})
				.where(eq(documents.id, doc.id));
			throw err;
		}
		logger.info("Document uploaded and enqueued", { documentId: doc.id });

		return { status: "accepted", document: doc };
	} catch (err) {
		if (isDuplicateKeyError(err)) {
			if (shouldCleanupUpload) {
				await cleanupUpload(file.path);
				shouldCleanupUpload = false;
			}

			const duplicate = await db.query.documents.findFirst({
				where: eq(documents.contentHash, contentHash ?? ""),
			});
			return {
				status: "duplicate",
				existingDocumentId: duplicate?.id,
			};
		}

		if (shouldCleanupUpload) {
			await cleanupUpload(file.path);
			shouldCleanupUpload = false;
		}

		throw err;
	}
}

function buildBatchSummary(results: BatchUploadResult[]) {
	return {
		accepted: results.filter((result) => result.status === "accepted").length,
		duplicate: results.filter((result) => result.status === "duplicate").length,
		failed: results.filter((result) => result.status === "failed").length,
		total: results.length,
	};
}

documentsRouter.post(
	"/",
	uploadLimiter,
	upload.single("file"),
	async (req, res, next) => {
		try {
			if (!req.file) {
				res.status(400).json({ error: "No file uploaded" });
				return;
			}

			const result = await ingestUploadedFile(req.file);
			if (result.status === "duplicate") {
				res.status(409).json({
					error: "Duplicate document",
					existingDocumentId: result.existingDocumentId,
				});
				return;
			}

			res.status(201).json(result.document);
		} catch (err) {
			next(err);
		}
	},
);

documentsRouter.post(
	"/batch",
	uploadLimiter,
	batchUpload.array("files", config.upload.maxFilesPerBatch),
	async (req, res, next) => {
		try {
			const files = (req.files as Express.Multer.File[] | undefined) ?? [];
			if (files.length === 0) {
				res.status(400).json({ error: "No files uploaded" });
				return;
			}

			const results: BatchUploadResult[] = [];

			for (const file of files) {
				try {
					const result = await ingestUploadedFile(file);
					if (result.status === "accepted") {
						results.push({
							filename: file.originalname,
							status: "accepted",
							document: result.document,
						});
					} else {
						results.push({
							filename: file.originalname,
							status: "duplicate",
							existingDocumentId: result.existingDocumentId,
						});
					}
				} catch (err) {
					results.push({
						filename: file.originalname,
						status: "failed",
						error:
							err instanceof Error ? err.message : "Failed to upload document",
					});
				}
			}

			const summary = buildBatchSummary(results);
			const statusCode = summary.accepted === summary.total ? 201 : 207;

			res.status(statusCode).json({ results, summary });
		} catch (err) {
			next(err);
		}
	},
);

// List documents with filtering/pagination
documentsRouter.get("/", async (req, res, next) => {
	try {
		const query = documentQueryInput.parse(req.query);
		const conditions = [];
		if (query.status) conditions.push(eq(documents.status, query.status));
		if (query.schemaId) conditions.push(eq(documents.schemaId, query.schemaId));

		const where = conditions.length > 0 ? and(...conditions) : undefined;
		const offset = (query.page - 1) * query.limit;

		const [rows, countResult] = await Promise.all([
			db
				.select()
				.from(documents)
				.where(where)
				.orderBy(desc(documents.createdAt))
				.limit(query.limit)
				.offset(offset),
			db
				.select({ count: sql<number>`count(*)::int` })
				.from(documents)
				.where(where),
		]);

		res.json({
			documents: rows,
			total: countResult[0].count,
			page: query.page,
			limit: query.limit,
		});
	} catch (err) {
		next(err);
	}
});

// Get document detail with relations
documentsRouter.get("/:id", async (req, res, next) => {
	try {
		const doc = await db.query.documents.findFirst({
			where: eq(documents.id, req.params.id),
			with: { schema: true, schemaRevision: true, jobs: true },
		});
		if (!doc) {
			res.status(404).json({ error: "Document not found" });
			return;
		}
		res.json(doc);
	} catch (err) {
		next(err);
	}
});

// Lightweight status poll
documentsRouter.get("/:id/status", async (req, res, next) => {
	try {
		const [doc] = await db
			.select({
				id: documents.id,
				status: documents.status,
				extractionConfidence: documents.extractionConfidence,
				errorMessage: documents.errorMessage,
			})
			.from(documents)
			.where(eq(documents.id, req.params.id));
		if (!doc) {
			res.status(404).json({ error: "Document not found" });
			return;
		}
		res.json(doc);
	} catch (err) {
		next(err);
	}
});

// SSE stream for real-time status updates
documentsRouter.get("/:id/stream", async (req, res) => {
	const POLL_INTERVAL = 2000;
	const MAX_DURATION = 5 * 60 * 1000; // 5 minutes max

	// Verify document exists before starting stream
	const [doc] = await db
		.select({ id: documents.id, status: documents.status })
		.from(documents)
		.where(eq(documents.id, req.params.id));
	if (!doc) {
		res.status(404).json({ error: "Document not found" });
		return;
	}

	res.writeHead(200, {
		"Content-Type": "text/event-stream",
		"Cache-Control": "no-cache",
		Connection: "keep-alive",
	});

	const startTime = Date.now();
	let lastStatus = "";

	const sendEvent = (data: Record<string, unknown>) => {
		res.write(`data: ${JSON.stringify(data)}\n\n`);
	};

	const poll = async () => {
		if (Date.now() - startTime > MAX_DURATION) {
			sendEvent({ type: "timeout", message: "Stream timed out" });
			res.end();
			return;
		}

		try {
			const [current] = await db
				.select({
					id: documents.id,
					status: documents.status,
					extractionConfidence: documents.extractionConfidence,
					errorMessage: documents.errorMessage,
				})
				.from(documents)
				.where(eq(documents.id, req.params.id));

			if (!current) {
				sendEvent({ type: "error", message: "Document not found" });
				res.end();
				return;
			}

			// Only send when status changes
			if (current.status !== lastStatus) {
				lastStatus = current.status;
				sendEvent({ type: "status", ...current });
			}

			// Terminal states end the stream
			if (
				current.status === "completed" ||
				current.status === "failed" ||
				current.status === "unclassified"
			) {
				res.end();
				return;
			}
		} catch {
			sendEvent({ type: "error", message: "Internal error" });
			res.end();
			return;
		}

		timer = setTimeout(poll, POLL_INTERVAL);
	};

	let timer = setTimeout(poll, 0);

	req.on("close", () => {
		clearTimeout(timer);
	});
});

// Reprocess document
documentsRouter.post("/:id/reprocess", async (req, res, next) => {
	try {
		const [doc] = await db
			.update(documents)
			.set({
				status: "pending",
				extractedData: null,
				extractionConfidence: null,
				errorMessage: null,
				schemaId: null,
				schemaVersion: null,
				schemaRevisionId: null,
				searchText: sql`${documents.rawText}`,
				updatedAt: new Date(),
			})
			.where(eq(documents.id, req.params.id))
			.returning();
		if (!doc) {
			res.status(404).json({ error: "Document not found" });
			return;
		}
		await enqueueClassification(doc.id);
		logger.info("Document reprocessing enqueued", { documentId: doc.id });
		res.json(doc);
	} catch (err) {
		next(err);
	}
});

// Delete document and clean up stored file
documentsRouter.delete("/:id", async (req, res, next) => {
	try {
		const doc = await db.query.documents.findFirst({
			where: eq(documents.id, req.params.id),
		});
		if (!doc) {
			res.status(404).json({ error: "Document not found" });
			return;
		}

		// Delete from DB (cascade removes processing_jobs)
		await db.delete(documents).where(eq(documents.id, req.params.id));

		// Clean up stored file (best-effort)
		try {
			await unlink(doc.storagePath);
		} catch (fileErr) {
			logger.warn("Failed to delete stored file", {
				documentId: doc.id,
				storagePath: doc.storagePath,
				error: fileErr instanceof Error ? fileErr.message : "Unknown",
			});
		}

		logger.info("Document deleted", { documentId: doc.id });
		res.status(204).end();
	} catch (err) {
		next(err);
	}
});
