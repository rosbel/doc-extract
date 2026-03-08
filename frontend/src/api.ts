const BASE = "/api";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
	const res = await fetch(`${BASE}${path}`, {
		headers: { "Content-Type": "application/json" },
		...options,
	});
	if (!res.ok) {
		const body = await res.json().catch(() => ({}));
		throw new Error(body.error || `Request failed: ${res.status}`);
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

export interface Document {
	id: string;
	filename: string;
	mimeType: string;
	fileSize: number;
	contentHash: string;
	rawText: string | null;
	storagePath: string;
	status: string;
	schemaId: string | null;
	extractedData: Record<string, unknown> | null;
	extractionConfidence: number | null;
	errorMessage: string | null;
	retryCount: number;
	createdAt: string;
	updatedAt: string;
}

export interface DocumentDetail extends Document {
	schema: Schema | null;
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

export interface RecommendationResponse {
	recommendations: SchemaRecommendation[];
	analysis: string;
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
		}) => request<Schema>("/schemas", { method: "POST", body: JSON.stringify(data) }),
		update: (id: string, data: Partial<Schema>) =>
			request<Schema>(`/schemas/${id}`, { method: "PUT", body: JSON.stringify(data) }),
		delete: (id: string) =>
			request<Schema>(`/schemas/${id}`, { method: "DELETE" }),
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
			request<{ id: string; status: string; extractionConfidence: number | null; errorMessage: string | null }>(
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
	},
	recommendations: {
		analyze: async (files: File[]): Promise<RecommendationResponse> => {
			const form = new FormData();
			for (const f of files) {
				form.append("files", f);
			}
			const res = await fetch(`${BASE}/recommendations`, {
				method: "POST",
				body: form,
			});
			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				throw new Error(body.error || `Analysis failed: ${res.status}`);
			}
			return res.json();
		},
	},
	search: (query: string, mode = "keyword", limit = 10) =>
		request<{ results: unknown[]; mode: string }>("/search", {
			method: "POST",
			body: JSON.stringify({ query, mode, limit }),
		}),
};
