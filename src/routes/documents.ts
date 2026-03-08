import { readFile } from "node:fs/promises";
import path from "node:path";
import { and, desc, eq, sql } from "drizzle-orm";
import { Router } from "express";
import multer from "multer";
import { config } from "../config.js";
import { db } from "../db/index.js";
import { documents, processingJobs } from "../db/schema.js";
import { isDuplicateKeyError } from "../lib/db-errors.js";
import { hashBuffer } from "../lib/hashing.js";
import { logger } from "../lib/logger.js";
import { enqueueClassification } from "../queue/jobs.js";
import { parseFile } from "../services/file-parser.js";
import { documentQueryInput } from "../validation/schemas.js";

const upload = multer({
	dest: config.upload.dir,
	limits: { fileSize: config.upload.maxFileSize },
});

export const documentsRouter = Router();

// Upload document
documentsRouter.post("/", upload.single("file"), async (req, res, next) => {
	try {
		if (!req.file) {
			res.status(400).json({ error: "No file uploaded" });
			return;
		}

		const fileBuffer = await readFile(req.file.path);
		const contentHash = hashBuffer(fileBuffer);

		// Check for duplicate
		const existing = await db.query.documents.findFirst({
			where: eq(documents.contentHash, contentHash),
		});
		if (existing) {
			res.status(409).json({
				error: "Duplicate document",
				existingDocumentId: existing.id,
			});
			return;
		}

		// Extract text
		const rawText = await parseFile(req.file.path, req.file.mimetype);

		// Store document
		const [doc] = await db
			.insert(documents)
			.values({
				filename: req.file.originalname,
				mimeType: req.file.mimetype,
				fileSize: req.file.size,
				contentHash,
				rawText,
				storagePath: req.file.path,
			})
			.returning();

		// Enqueue classification
		await enqueueClassification(doc.id);
		logger.info("Document uploaded and enqueued", { documentId: doc.id });

		res.status(201).json(doc);
	} catch (err) {
		if (isDuplicateKeyError(err)) {
			res.status(409).json({ error: "Duplicate document" });
			return;
		}
		next(err);
	}
});

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
			with: { schema: true, jobs: true },
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
