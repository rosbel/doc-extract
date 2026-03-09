export type AdminServiceHealth =
	| "healthy"
	| "degraded"
	| "offline"
	| "disabled";

export interface AdminServiceStatus {
	configured: boolean;
	status: AdminServiceHealth;
	message?: string;
}

export interface AdminQueueStatus {
	paused: boolean;
	maintenanceMode: boolean;
	counts: Record<
		"waiting" | "active" | "delayed" | "completed" | "failed" | "paused",
		number
	>;
	recentJobs: Array<{
		id: string;
		name: string;
		state: string;
		attemptsMade: number;
		documentId: string | null;
		timestamp: number;
	}>;
	worker: {
		status: "online" | "stale" | "offline";
		lastHeartbeatAt: string | null;
		ageMs: number | null;
	};
}

export interface AdminDocumentRow {
	id: string;
	filename: string;
	status: string;
	schemaId: string | null;
	schemaName: string | null;
	retryCount: number;
	storagePath: string;
	errorMessage: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface AdminActionResult {
	ok: boolean;
	message: string;
	warnings: string[];
	details?: Record<string, unknown>;
}

export interface AdminOverview {
	postgres: {
		documentCounts: Record<string, number>;
		schemaCounts: Record<string, number>;
		jobCounts: Record<string, number>;
		recentFailedDocuments: Array<{
			id: string;
			filename: string;
			errorMessage: string | null;
			updatedAt: string;
		}>;
		recentFailedJobs: Array<{
			id: string;
			documentId: string;
			jobType: string;
			errorMessage: string | null;
			completedAt: string | null;
			createdAt: string;
		}>;
	};
	uploads: {
		path: string;
		exists: boolean;
		fileCount: number;
		totalBytes: number;
	};
	queue: AdminQueueStatus;
	pinecone: AdminServiceStatus & {
		index: string;
		totalRecordCount: number | null;
		namespaceCount: number | null;
	};
	openrouter: AdminServiceStatus & {
		model: string;
	};
}
