import { mkdir, readdir, rm, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { and, count, desc, eq, sql } from "drizzle-orm";
import { config } from "../config.js";
import { db } from "../db/index.js";
import {
	documents,
	extractionSchemas,
	processingJobs,
	schemaRevisions,
} from "../db/schema.js";
import { logger } from "../lib/logger.js";
import { getOpenRouterClient } from "../lib/openrouter.js";
import { documentQueue } from "../queue/index.js";
import {
	isMaintenanceModeEnabled,
	readWorkerHeartbeat,
	setMaintenanceMode,
} from "../queue/redis.js";
import type {
	AdminActionResult,
	AdminDocumentRow,
	AdminOverview,
	AdminQueueStatus,
} from "../types/admin.js";
import {
	clearVectorIndex,
	deleteDocumentVectors,
	describeVectorIndexStats,
	isSemanticSearchConfigured,
} from "./vector-store.js";

const DOCUMENT_STATUSES = [
	"pending",
	"classifying",
	"extracting",
	"completed",
	"failed",
	"duplicate",
] as const;
const SCHEMA_STATUSES = ["active", "archived"] as const;
const JOB_STATUSES = ["pending", "running", "completed", "failed"] as const;
const RECENT_LIMIT = 10;

function createHttpError(status: number, message: string) {
	const error = new Error(message) as Error & { status?: number };
	error.status = status;
	return error;
}

function fillCountRecord(
	keys: readonly string[],
	rows: Array<{ status: string | null; count: number }>,
) {
	const result = Object.fromEntries(keys.map((key) => [key, 0])) as Record<
		string,
		number
	>;

	for (const row of rows) {
		if (row.status) {
			result[row.status] = Number(row.count);
		}
	}

	return result;
}

async function readDirectoryStats(
	dir: string,
): Promise<{ exists: boolean; fileCount: number; totalBytes: number }> {
	try {
		const entries = await readdir(dir, { withFileTypes: true });
		let fileCount = 0;
		let totalBytes = 0;

		for (const entry of entries) {
			const entryPath = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				const nested = await readDirectoryStats(entryPath);
				fileCount += nested.fileCount;
				totalBytes += nested.totalBytes;
				continue;
			}

			if (entry.isFile()) {
				const fileStat = await stat(entryPath);
				fileCount += 1;
				totalBytes += fileStat.size;
			}
		}

		return { exists: true, fileCount, totalBytes };
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return { exists: false, fileCount: 0, totalBytes: 0 };
		}
		throw error;
	}
}

async function clearUploadDirectory() {
	await mkdir(config.upload.dir, { recursive: true });
	const entries = await readdir(config.upload.dir, { withFileTypes: true });
	const warnings: string[] = [];
	let removedEntries = 0;

	for (const entry of entries) {
		try {
			await rm(path.join(config.upload.dir, entry.name), {
				recursive: true,
				force: true,
			});
			removedEntries += 1;
		} catch (error) {
			warnings.push(
				`Failed to remove upload entry "${entry.name}": ${
					error instanceof Error ? error.message : "Unknown error"
				}`,
			);
		}
	}

	return { removedEntries, warnings };
}

async function getOpenRouterStatus(): Promise<AdminOverview["openrouter"]> {
	if (!config.openrouter.apiKey) {
		return {
			configured: false,
			status: "disabled",
			model: config.openrouter.model,
			message: "OpenRouter is not configured",
		};
	}

	try {
		await getOpenRouterClient().models.list();
		return {
			configured: true,
			status: "healthy",
			model: config.openrouter.model,
			message: "OpenRouter reachable",
		};
	} catch (error) {
		return {
			configured: true,
			status: "offline",
			model: config.openrouter.model,
			message:
				error instanceof Error ? error.message : "OpenRouter probe failed",
		};
	}
}

async function getPineconeStatus(): Promise<AdminOverview["pinecone"]> {
	if (!isSemanticSearchConfigured()) {
		return {
			configured: false,
			status: "disabled",
			index: config.pinecone.index,
			totalRecordCount: null,
			namespaceCount: null,
			message: "Pinecone is not configured",
		};
	}

	try {
		const stats = await describeVectorIndexStats();
		return {
			configured: true,
			status: "healthy",
			index: config.pinecone.index,
			totalRecordCount: stats?.totalRecordCount ?? null,
			namespaceCount: stats?.namespaces
				? Object.keys(stats.namespaces).length
				: 0,
			message: "Pinecone reachable",
		};
	} catch (error) {
		return {
			configured: true,
			status: "offline",
			index: config.pinecone.index,
			totalRecordCount: null,
			namespaceCount: null,
			message: error instanceof Error ? error.message : "Pinecone probe failed",
		};
	}
}

async function getQueueStatus(): Promise<AdminQueueStatus> {
	const [counts, paused, recentJobs, failedJobs, heartbeat, maintenanceMode] =
		await Promise.all([
			documentQueue.getJobCounts(
				"waiting",
				"active",
				"delayed",
				"completed",
				"failed",
				"paused",
			),
			documentQueue.isPaused(),
			documentQueue.getJobs(
				["active", "waiting", "delayed", "completed", "failed"],
				0,
				RECENT_LIMIT - 1,
				false,
			),
			documentQueue.getJobs(["failed"], 0, RECENT_LIMIT - 1, false),
			readWorkerHeartbeat(),
			isMaintenanceModeEnabled(),
		]);

	const recentJobStates = await Promise.all(
		recentJobs.map(async (job) => ({
			id: String(job.id),
			name: job.name,
			state: await job.getState(),
			attemptsMade: job.attemptsMade,
			documentId:
				typeof job.data?.documentId === "string" ? job.data.documentId : null,
			timestamp: job.timestamp,
		})),
	);
	const failedJobStates = await Promise.all(
		failedJobs.map(async (job) => ({
			id: String(job.id),
			name: job.name,
			state: await job.getState(),
			attemptsMade: job.attemptsMade,
			documentId:
				typeof job.data?.documentId === "string" ? job.data.documentId : null,
			timestamp: job.timestamp,
			failedReason:
				typeof job.failedReason === "string" ? job.failedReason : null,
			finishedAt:
				typeof job.finishedOn === "number"
					? new Date(job.finishedOn).toISOString()
					: null,
		})),
	);

	let workerStatus: AdminQueueStatus["worker"]["status"] = "offline";
	let lastHeartbeatAt: string | null = null;
	let ageMs: number | null = null;

	if (heartbeat?.timestamp) {
		lastHeartbeatAt = heartbeat.timestamp;
		ageMs = Date.now() - new Date(heartbeat.timestamp).getTime();
		workerStatus = ageMs < 45_000 ? "online" : "stale";
	}

	return {
		paused,
		maintenanceMode,
		counts: {
			waiting: counts.waiting ?? 0,
			active: counts.active ?? 0,
			delayed: counts.delayed ?? 0,
			completed: counts.completed ?? 0,
			failed: counts.failed ?? 0,
			paused: counts.paused ?? 0,
		},
		recentJobs: recentJobStates,
		failedJobs: failedJobStates,
		worker: {
			status: workerStatus,
			lastHeartbeatAt,
			ageMs,
		},
	};
}

async function findDocumentQueueJobs(documentId: string) {
	const jobs = await documentQueue.getJobs(
		["active", "waiting", "delayed", "completed", "failed"],
		0,
		-1,
		false,
	);
	const matches = [];

	for (const job of jobs) {
		const jobDocumentId =
			typeof job.data?.documentId === "string" ? job.data.documentId : null;
		if (jobDocumentId !== documentId) continue;
		matches.push({
			job,
			state: await job.getState(),
		});
	}

	return matches;
}

async function cleanQueueSet(type: "completed" | "failed") {
	let removed = 0;

	while (true) {
		const cleanedIds = await documentQueue.clean(0, 1000, type);
		removed += cleanedIds.length;
		if (cleanedIds.length === 0) break;
	}

	return removed;
}

async function waitForQueueIdle(timeoutMs = 30_000) {
	if (timeoutMs <= 0) {
		return (await documentQueue.getActiveCount()) === 0;
	}

	const startedAt = Date.now();

	while (Date.now() - startedAt <= timeoutMs) {
		if ((await documentQueue.getActiveCount()) === 0) {
			return true;
		}

		await new Promise((resolve) => setTimeout(resolve, 1_000));
	}

	return false;
}

export async function getAdminOverview(): Promise<AdminOverview> {
	const [
		documentCountRows,
		schemaCountRows,
		jobCountRows,
		recentFailedDocuments,
		recentFailedJobs,
		uploads,
		queue,
		pinecone,
		openrouter,
	] = await Promise.all([
		db
			.select({
				status: documents.status,
				count: sql<number>`count(*)::int`,
			})
			.from(documents)
			.groupBy(documents.status),
		db
			.select({
				status: extractionSchemas.status,
				count: sql<number>`count(*)::int`,
			})
			.from(extractionSchemas)
			.groupBy(extractionSchemas.status),
		db
			.select({
				status: processingJobs.status,
				count: sql<number>`count(*)::int`,
			})
			.from(processingJobs)
			.groupBy(processingJobs.status),
		db
			.select({
				id: documents.id,
				filename: documents.filename,
				errorMessage: documents.errorMessage,
				updatedAt: documents.updatedAt,
			})
			.from(documents)
			.where(eq(documents.status, "failed"))
			.orderBy(desc(documents.updatedAt))
			.limit(RECENT_LIMIT),
		db
			.select({
				id: processingJobs.id,
				documentId: processingJobs.documentId,
				jobType: processingJobs.jobType,
				errorMessage: processingJobs.errorMessage,
				completedAt: processingJobs.completedAt,
				createdAt: processingJobs.createdAt,
			})
			.from(processingJobs)
			.where(eq(processingJobs.status, "failed"))
			.orderBy(desc(processingJobs.createdAt))
			.limit(RECENT_LIMIT),
		readDirectoryStats(config.upload.dir),
		getQueueStatus(),
		getPineconeStatus(),
		getOpenRouterStatus(),
	]);

	return {
		postgres: {
			documentCounts: fillCountRecord(DOCUMENT_STATUSES, documentCountRows),
			schemaCounts: fillCountRecord(SCHEMA_STATUSES, schemaCountRows),
			jobCounts: fillCountRecord(JOB_STATUSES, jobCountRows),
			recentFailedDocuments: recentFailedDocuments.map((doc) => ({
				...doc,
				updatedAt: doc.updatedAt.toISOString(),
			})),
			recentFailedJobs: recentFailedJobs.map((job) => ({
				...job,
				completedAt: job.completedAt?.toISOString() ?? null,
				createdAt: job.createdAt.toISOString(),
			})),
		},
		uploads: {
			path: config.upload.dir,
			...uploads,
		},
		queue,
		pinecone,
		openrouter,
	};
}

export async function listAdminDocuments(params: {
	status?: (typeof DOCUMENT_STATUSES)[number];
	page: number;
	limit: number;
}): Promise<{
	documents: AdminDocumentRow[];
	total: number;
	page: number;
	limit: number;
}> {
	const conditions = [];
	if (params.status) {
		conditions.push(eq(documents.status, params.status));
	}
	const where = conditions.length > 0 ? and(...conditions) : undefined;
	const offset = (params.page - 1) * params.limit;

	const [rows, totalRows] = await Promise.all([
		db
			.select({
				id: documents.id,
				filename: documents.filename,
				status: documents.status,
				schemaId: documents.schemaId,
				schemaName: extractionSchemas.name,
				retryCount: documents.retryCount,
				storagePath: documents.storagePath,
				errorMessage: documents.errorMessage,
				createdAt: documents.createdAt,
				updatedAt: documents.updatedAt,
			})
			.from(documents)
			.leftJoin(extractionSchemas, eq(documents.schemaId, extractionSchemas.id))
			.where(where)
			.orderBy(desc(documents.createdAt))
			.limit(params.limit)
			.offset(offset),
		db.select({ count: count() }).from(documents).where(where),
	]);

	return {
		documents: rows.map((row) => ({
			...row,
			createdAt: row.createdAt.toISOString(),
			updatedAt: row.updatedAt.toISOString(),
		})),
		total: totalRows[0]?.count ?? 0,
		page: params.page,
		limit: params.limit,
	};
}

export async function deleteAdminDocument(
	documentId: string,
): Promise<AdminActionResult> {
	const warnings: string[] = [];
	const doc = await db.query.documents.findFirst({
		where: eq(documents.id, documentId),
	});
	if (!doc) {
		throw createHttpError(404, "Document not found");
	}

	const queueJobs = await findDocumentQueueJobs(documentId);
	if (queueJobs.some((entry) => entry.state === "active")) {
		throw createHttpError(
			409,
			"Cannot delete a document while it has active queue jobs",
		);
	}

	for (const entry of queueJobs) {
		try {
			await entry.job.remove();
		} catch (error) {
			warnings.push(
				`Failed to remove queue job "${entry.job.id}": ${
					error instanceof Error ? error.message : "Unknown error"
				}`,
			);
		}
	}

	await db.delete(documents).where(eq(documents.id, documentId));

	try {
		await unlink(doc.storagePath);
	} catch (error) {
		warnings.push(
			`Failed to delete upload "${doc.storagePath}": ${
				error instanceof Error ? error.message : "Unknown error"
			}`,
		);
	}

	try {
		await deleteDocumentVectors(documentId);
	} catch (error) {
		warnings.push(
			`Failed to delete Pinecone vectors for "${documentId}": ${
				error instanceof Error ? error.message : "Unknown error"
			}`,
		);
	}

	logger.info("Admin document delete completed", {
		documentId,
		warnings,
	});

	return {
		ok: true,
		message: `Deleted document ${doc.filename}`,
		warnings,
		details: {
			documentId,
			removedQueueJobs: queueJobs.length,
		},
	};
}

export async function pauseQueue(): Promise<AdminActionResult> {
	await documentQueue.pause();
	return {
		ok: true,
		message: "Queue paused",
		warnings: [],
	};
}

export async function resumeQueue(): Promise<AdminActionResult> {
	await documentQueue.resume();
	return {
		ok: true,
		message: "Queue resumed",
		warnings: [],
	};
}

export async function clearQueue(
	scope: "completed" | "failed" | "waiting_delayed",
): Promise<AdminActionResult> {
	if ((await documentQueue.getActiveCount()) > 0) {
		throw createHttpError(
			409,
			"Cannot clear queue state while jobs are active",
		);
	}

	if (scope === "completed" || scope === "failed") {
		const removed = await cleanQueueSet(scope);
		return {
			ok: true,
			message: `Cleared ${scope} jobs`,
			warnings: [],
			details: {
				removed,
			},
		};
	}

	const counts = await documentQueue.getJobCounts("waiting", "delayed");
	await documentQueue.drain(true);
	return {
		ok: true,
		message: "Cleared waiting and delayed jobs",
		warnings: [],
		details: {
			waitingRemoved: counts.waiting ?? 0,
			delayedRemoved: counts.delayed ?? 0,
		},
	};
}

export async function clearPinecone(): Promise<AdminActionResult> {
	if (!isSemanticSearchConfigured()) {
		return {
			ok: true,
			message: "Pinecone is not configured",
			warnings: [],
			details: {
				skipped: true,
			},
		};
	}

	await clearVectorIndex();
	return {
		ok: true,
		message: "Cleared Pinecone vectors in the default namespace",
		warnings: [],
	};
}

export async function resetSystem(options?: {
	waitTimeoutMs?: number;
}): Promise<AdminActionResult> {
	const warnings: string[] = [];
	const wasPaused = await documentQueue.isPaused();

	await setMaintenanceMode(true);
	if (!wasPaused) {
		await documentQueue.pause();
	}

	try {
		const idle = await waitForQueueIdle(options?.waitTimeoutMs);
		if (!idle) {
			throw createHttpError(
				409,
				"Timed out waiting for active queue jobs to finish",
			);
		}

		const uploadResult = await clearUploadDirectory();
		warnings.push(...uploadResult.warnings);

		await db.transaction(async (tx) => {
			await tx.delete(documents);
			await tx.delete(schemaRevisions);
			await tx.delete(extractionSchemas);
		});

		await documentQueue.obliterate({ force: false, count: 1000 });

		try {
			await clearVectorIndex();
		} catch (error) {
			warnings.push(
				`Failed to clear Pinecone vectors: ${
					error instanceof Error ? error.message : "Unknown error"
				}`,
			);
		}

		logger.info("Admin reset completed", {
			warnings,
		});

		return {
			ok: true,
			message: "System reset completed",
			warnings,
			details: {
				uploadsRemoved: uploadResult.removedEntries,
			},
		};
	} finally {
		await setMaintenanceMode(false);
		if (!wasPaused) {
			try {
				await documentQueue.resume();
			} catch (error) {
				logger.warn("Failed to resume queue after admin reset", {
					error: error instanceof Error ? error.message : "Unknown error",
				});
			}
		}
	}
}
