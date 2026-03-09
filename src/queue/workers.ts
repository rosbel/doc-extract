import { Worker } from "bullmq";
import { eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import {
	documents,
	extractionSchemas,
	processingJobs,
	schemaRevisions,
} from "../db/schema.js";
import { logger } from "../lib/logger.js";
import { classifyDocument } from "../services/classifier.js";
import { extractDocument } from "../services/extractor.js";
import { getLatestSchemaRevision } from "../services/schema-lifecycle.js";
import { indexDocument } from "../services/vector-store.js";
import { redisConnectionOpts } from "./index.js";
import type { JobData } from "./jobs.js";
import { enqueueExtraction } from "./jobs.js";

export async function handleClassification(documentId: string) {
	// Update status
	await db
		.update(documents)
		.set({ status: "classifying", updatedAt: new Date() })
		.where(eq(documents.id, documentId));

	// Create audit record
	const [job] = await db
		.insert(processingJobs)
		.values({
			documentId,
			jobType: "classification",
			status: "running",
			startedAt: new Date(),
		})
		.returning();

	try {
		const doc = await db.query.documents.findFirst({
			where: eq(documents.id, documentId),
		});
		if (!doc?.rawText) throw new Error("Document not found or has no text");

		const schemas = await db
			.select()
			.from(extractionSchemas)
			.where(eq(extractionSchemas.status, "active"));
		if (schemas.length === 0) throw new Error("No active schemas available");

		const result = await classifyDocument(doc.rawText, schemas);
		const revision = await getLatestSchemaRevision(db, result.schemaId);
		if (!revision) {
			throw new Error(
				`No revision found for classified schema "${result.schemaId}"`,
			);
		}

		// Update document with classification result
		await db
			.update(documents)
			.set({
				schemaId: result.schemaId,
				schemaVersion: revision.version,
				schemaRevisionId: revision.id,
				updatedAt: new Date(),
			})
			.where(eq(documents.id, documentId));

		// Update audit record
		await db
			.update(processingJobs)
			.set({
				status: "completed",
				completedAt: new Date(),
				metadata: result as unknown as Record<string, unknown>,
			})
			.where(eq(processingJobs.id, job.id));

		// Enqueue extraction
		if (!result.schemaId) {
			throw new Error("Classification succeeded but returned no schemaId");
		}
		await enqueueExtraction(documentId, revision.id);
		logger.info("Classification complete, extraction enqueued", {
			documentId,
			schemaId: result.schemaId,
			schemaRevisionId: revision.id,
		});
	} catch (err) {
		const errorMessage =
			err instanceof Error ? err.message : "Classification failed";
		await db
			.update(processingJobs)
			.set({
				status: "failed",
				completedAt: new Date(),
				errorMessage,
			})
			.where(eq(processingJobs.id, job.id));
		await db
			.update(documents)
			.set({ status: "failed", errorMessage, updatedAt: new Date() })
			.where(eq(documents.id, documentId));
		throw err;
	}
}

export async function handleExtraction(
	documentId: string,
	schemaRevisionId: string,
) {
	// Update status
	await db
		.update(documents)
		.set({ status: "extracting", updatedAt: new Date() })
		.where(eq(documents.id, documentId));

	const [job] = await db
		.insert(processingJobs)
		.values({
			documentId,
			jobType: "extraction",
			status: "running",
			startedAt: new Date(),
		})
		.returning();

	try {
		const doc = await db.query.documents.findFirst({
			where: eq(documents.id, documentId),
		});
		if (!doc?.rawText) throw new Error("Document not found or has no text");

		const revision = await db.query.schemaRevisions.findFirst({
			where: eq(schemaRevisions.id, schemaRevisionId),
		});
		if (!revision) throw new Error("Schema revision not found");

		const result = await extractDocument(
			doc.rawText,
			revision.jsonSchema as Record<string, unknown>,
			revision.name,
		);

		// Update document with extraction results
		await db
			.update(documents)
			.set({
				status: "completed",
				extractedData: result.extractedData,
				extractionConfidence: result.confidence,
				updatedAt: new Date(),
			})
			.where(eq(documents.id, documentId));

		await db
			.update(processingJobs)
			.set({
				status: "completed",
				completedAt: new Date(),
				metadata: result as unknown as Record<string, unknown>,
			})
			.where(eq(processingJobs.id, job.id));

		// Index in Pinecone (best-effort)
		try {
			await indexDocument(
				doc.id,
				doc.filename,
				result.extractedData,
				revision.schemaId,
			);
		} catch (vecErr) {
			logger.warn("Vector indexing failed (non-fatal)", {
				documentId,
				error: vecErr instanceof Error ? vecErr.message : "Unknown",
			});
		}

		logger.info("Extraction complete", {
			documentId,
			confidence: result.confidence,
		});
	} catch (err) {
		const errorMessage =
			err instanceof Error ? err.message : "Extraction failed";
		await db
			.update(processingJobs)
			.set({
				status: "failed",
				completedAt: new Date(),
				errorMessage,
			})
			.where(eq(processingJobs.id, job.id));
		await db
			.update(documents)
			.set({ status: "failed", errorMessage, updatedAt: new Date() })
			.where(eq(documents.id, documentId));
		throw err;
	}
}

export function createWorker() {
	const worker = new Worker<JobData>(
		"document-processing",
		async (job) => {
			logger.info("Processing job", {
				jobId: job.id,
				type: job.data.type,
				documentId: job.data.documentId,
			});

			if (job.data.type === "classify") {
				await handleClassification(job.data.documentId);
			} else if (job.data.type === "extract") {
				await handleExtraction(
					job.data.documentId,
					job.data.schemaRevisionId,
				);
			}
		},
		{
			connection: redisConnectionOpts,
			concurrency: 2,
			limiter: {
				max: 10,
				duration: 60000,
			},
		},
	);

	worker.on("completed", (job) => {
		logger.info("Job completed", { jobId: job.id });
	});

	worker.on("failed", async (job, err) => {
		logger.error("Job failed", {
			jobId: job?.id,
			error: err.message,
			attempt: job?.attemptsMade,
		});

		if (!job) return;

		try {
			// Increment retryCount on every failure attempt
			await db
				.update(documents)
				.set({
					retryCount: sql`${documents.retryCount} + 1`,
					updatedAt: new Date(),
				})
				.where(eq(documents.id, job.data.documentId));

			// Mark as failed when all retries exhausted
			if (job.attemptsMade >= (job.opts.attempts ?? 1)) {
				await db
					.update(documents)
					.set({
						status: "failed",
						errorMessage: err.message,
						updatedAt: new Date(),
					})
					.where(eq(documents.id, job.data.documentId));
			}
		} catch (dbErr) {
			logger.error("Failed to update document after job failure", {
				documentId: job.data.documentId,
				error: dbErr instanceof Error ? dbErr.message : "Unknown",
			});
		}
	});

	return worker;
}
