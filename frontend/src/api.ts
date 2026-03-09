const BASE = "/api";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
	const res = await fetch(`${BASE}${path}`, {
		headers: { "Content-Type": "application/json" },
		...options,
	});
	if (!res.ok) {
		const body = await res.json().catch(() => ({}));
		const details = body.details?.map((d: { path: string; message: string }) => `${d.path}: ${d.message}`).join("; ");
		throw new Error(details ? `${body.error}: ${details}` : (body.error || `Request failed: ${res.status}`));
	}
	return res.json();
}

export interface Schema {
	id: string;
	name: string;
	description: string;
	version: number;
	jsonSchema: Record<string, unknown>;
	classificationHints: string[];
	status: string;
	createdAt: string;
	updatedAt: string;
}

export type DocumentStatus =
	| "pending"
	| "classifying"
	| "extracting"
	| "completed"
	| "unclassified"
	| "failed"
	| "duplicate";

export interface SchemaRevision {
	id: string;
	schemaId: string;
	version: number;
	name: string;
	description: string;
	jsonSchema: Record<string, unknown>;
	classificationHints: string[];
	source: "manual" | "ai" | "restore";
	summary: string | null;
	createdAt: string;
}

export interface Document {
	id: string;
	filename: string;
	mimeType: string;
	fileSize: number;
	contentHash: string;
	rawText: string | null;
	storagePath: string;
	status: DocumentStatus;
	schemaId: string | null;
	schemaVersion: number | null;
	schemaRevisionId: string | null;
	extractedData: Record<string, unknown> | null;
	extractionConfidence: number | null;
	errorMessage: string | null;
	retryCount: number;
	createdAt: string;
	updatedAt: string;
}

export type SearchMode = "hybrid" | "keyword";

export interface SearchResult {
	id: string;
	filename: string;
	schemaId: string | null;
	status: DocumentStatus;
	extractionConfidence: number | null;
	score: number;
	snippet: string;
	matchReasons: string[];
	matchedFields: string[];
}

export interface DocumentDetail extends Document {
	schema: Schema | null;
	schemaRevision: SchemaRevision | null;
	jobs: Array<{
		id: string;
		jobType: string;
		status: string;
		attemptNumber: number;
		errorMessage: string | null;
		metadata: unknown;
		startedAt: string | null;
		completedAt: string | null;
		createdAt: string;
	}>;
}

export interface SchemaRecommendation {
	name: string;
	description: string;
	jsonSchema: Record<string, unknown>;
	classificationHints: string[];
	reasoning: string;
	matchingDocuments: string[];
}

export interface SchemaAssistDiffEntry {
	field: "name" | "description" | "classificationHints" | "jsonSchema";
	label: string;
	changed: boolean;
	before: unknown;
	after: unknown;
}

export interface SchemaAssistCreateResponse {
	analysis: string;
	proposals: SchemaRecommendation[];
	warnings?: Array<{ filename: string; warning: string }>;
}

export interface SchemaAssistEditResponse {
	analysis: string;
	proposal: SchemaRecommendation;
	diff: SchemaAssistDiffEntry[];
	warnings?: Array<{ filename: string; warning: string }>;
}

export interface SearchRequest {
	query: string;
	mode: SearchMode;
	schemaId?: string;
	limit?: number;
}

export interface SearchResponse {
	results: SearchResult[];
	mode: SearchMode;
	degraded: boolean;
	degradedReason?: "semantic_unavailable";
}

export const api = {
	schemas: {
		list: () => request<Schema[]>("/schemas"),
		get: (id: string) => request<Schema>(`/schemas/${id}`),
		create: (data: {
			name: string;
			description: string;
			jsonSchema: Record<string, unknown>;
			classificationHints?: string[];
			revision?: {
				source?: "manual" | "ai" | "restore";
				summary?: string;
			};
		}) => request<Schema>("/schemas", { method: "POST", body: JSON.stringify(data) }),
		update: (
			id: string,
			data: Partial<Schema> & {
				revision?: {
					source?: "manual" | "ai" | "restore";
					summary?: string;
				};
			},
		) =>
			request<Schema>(`/schemas/${id}`, { method: "PUT", body: JSON.stringify(data) }),
		delete: (id: string) =>
			request<Schema>(`/schemas/${id}`, { method: "DELETE" }),
		revisions: (id: string) =>
			request<SchemaRevision[]>(`/schemas/${id}/revisions`),
		restoreRevision: (id: string, revisionId: string) =>
			request<Schema>(`/schemas/${id}/revisions/${revisionId}/restore`, {
				method: "POST",
			}),
		assist: async (data: {
			mode: "create" | "edit";
			prompt?: string;
			schemaId?: string;
			files?: File[];
			documentIds?: string[];
		}): Promise<SchemaAssistCreateResponse | SchemaAssistEditResponse> => {
			const form = new FormData();
			form.append("mode", data.mode);
			if (data.prompt?.trim()) {
				form.append("prompt", data.prompt.trim());
			}
			if (data.schemaId) {
				form.append("schemaId", data.schemaId);
			}
			for (const file of data.files ?? []) {
				form.append("files", file);
			}
			for (const documentId of data.documentIds ?? []) {
				form.append("documentIds", documentId);
			}

			const res = await fetch(`${BASE}/schemas/assist`, {
				method: "POST",
				body: form,
			});
			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				throw new Error(body.error || `Schema assist failed: ${res.status}`);
			}
			return res.json();
		},
	},
	documents: {
		list: (params?: Record<string, string>) => {
			const qs = params ? `?${new URLSearchParams(params)}` : "";
			return request<{ documents: Document[]; total: number; page: number; limit: number }>(
				`/documents${qs}`,
			);
		},
		get: (id: string) => request<DocumentDetail>(`/documents/${id}`),
		status: (id: string) =>
			request<{ id: string; status: DocumentStatus; extractionConfidence: number | null; errorMessage: string | null }>(
				`/documents/${id}/status`,
			),
		upload: async (file: File) => {
			const form = new FormData();
			form.append("file", file);
			const res = await fetch(`${BASE}/documents`, { method: "POST", body: form });
			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				throw new Error(body.error || `Upload failed: ${res.status}`);
			}
			return res.json() as Promise<Document>;
		},
		reprocess: (id: string) =>
			request<Document>(`/documents/${id}/reprocess`, { method: "POST" }),
		delete: async (id: string) => {
			const res = await fetch(`${BASE}/documents/${id}`, { method: "DELETE" });
			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				throw new Error(body.error || `Delete failed: ${res.status}`);
			}
		},
		stream: (id: string, onEvent: (data: { type: string; status?: DocumentStatus; extractionConfidence?: number | null; errorMessage?: string | null }) => void) => {
			const eventSource = new EventSource(`${BASE}/documents/${id}/stream`);
			eventSource.onmessage = (event) => {
				const data = JSON.parse(event.data);
				onEvent(data);
				if (
					data.type === "status" &&
					(data.status === "completed" ||
						data.status === "failed" ||
						data.status === "unclassified")
				) {
					eventSource.close();
				}
				if (data.type === "timeout" || data.type === "error") {
					eventSource.close();
				}
			};
			eventSource.onerror = () => {
				eventSource.close();
			};
			return eventSource;
		},
	},
	search: ({ query, mode, schemaId, limit = 10 }: SearchRequest) =>
		request<SearchResponse>("/search", {
			method: "POST",
			body: JSON.stringify({
				query,
				mode,
				limit,
				...(schemaId ? { schemaId } : {}),
			}),
		}),
};
