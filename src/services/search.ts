import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { documents, extractionSchemas } from "../db/schema.js";
import { logger } from "../lib/logger.js";
import {
	buildSearchCorpus,
	extractMatchedFields,
	findSnippet,
} from "./search-index.js";
import {
	type SemanticChunkMatch,
	isSemanticSearchConfigured,
	searchDocument,
} from "./vector-store.js";

export type SearchMode = "hybrid" | "keyword";

export type SearchResult = {
	id: string;
	filename: string;
	schemaId: string | null;
	status: string;
	extractionConfidence: number | null;
	score: number;
	snippet: string;
	matchReasons: string[];
	matchedFields: string[];
};

export type SearchResponse = {
	mode: SearchMode;
	results: SearchResult[];
	degraded: boolean;
	degradedReason?: "semantic_unavailable";
};

type SearchParams = {
	query: string;
	limit: number;
	mode: SearchMode;
	schemaId?: string;
};

type KeywordCandidate = {
	id: string;
	keywordScore: number;
};

type DocumentRow = {
	id: string;
	filename: string;
	status: string;
	schemaId: string | null;
	extractionConfidence: number | null;
	extractedData: unknown;
	searchText: string | null;
	rawText: string | null;
	createdAt: Date;
};

const SEMANTIC_TOP_K = 30;
const CANDIDATE_LIMIT_FLOOR = 30;

function clampScore(value: number): number {
	return Math.max(0, Math.min(1, value));
}

function normalizeQuery(query: string): string {
	return query.trim().toLowerCase();
}

function buildSearchMode(mode: SearchParams["mode"]): SearchMode {
	return mode === "keyword" ? "keyword" : "hybrid";
}

function collapseSemanticMatches(matches: SemanticChunkMatch[]): Map<
	string,
	{
		score: number;
		preview: string;
		chunkCount: number;
	}
> {
	const byDocument = new Map<
		string,
		{ score: number; preview: string; chunkCount: number }
	>();

	for (const match of matches) {
		const documentId =
			typeof match.metadata?.documentId === "string"
				? match.metadata.documentId
				: match.id.split(":")[0];
		const preview =
			typeof match.metadata?.preview === "string" ? match.metadata.preview : "";
		const existing = byDocument.get(documentId);

		if (!existing) {
			byDocument.set(documentId, {
				score: match.score,
				preview,
				chunkCount: 1,
			});
			continue;
		}

		byDocument.set(documentId, {
			score: Math.max(existing.score, match.score),
			preview: existing.preview || preview,
			chunkCount: existing.chunkCount + 1,
		});
	}

	for (const [documentId, entry] of byDocument.entries()) {
		byDocument.set(documentId, {
			...entry,
			score: clampScore(entry.score + Math.max(0, entry.chunkCount - 1) * 0.03),
		});
	}

	return byDocument;
}

async function getSchemaContext(schemaId?: string) {
	if (!schemaId) return null;

	return db.query.extractionSchemas.findFirst({
		where: eq(extractionSchemas.id, schemaId),
	});
}

async function getKeywordCandidates(
	query: string,
	limit: number,
	schemaId?: string,
): Promise<Map<string, KeywordCandidate>> {
	const queryVector = sql`websearch_to_tsquery('english', ${query})`;
	const searchCorpus = sql`coalesce(${documents.searchText}, ${documents.rawText}, '')`;
	const rankExpr = sql<number>`ts_rank_cd(to_tsvector('english', ${searchCorpus}), ${queryVector})`;
	const likePattern = `%${query}%`;
	const conditions = [
		or(
			sql`to_tsvector('english', ${searchCorpus}) @@ ${queryVector}`,
			sql`${documents.filename} ILIKE ${likePattern}`,
			sql`${searchCorpus} ILIKE ${likePattern}`,
		),
	];

	if (schemaId) {
		conditions.push(eq(documents.schemaId, schemaId));
	}

	const rows = await db
		.select({
			id: documents.id,
			keywordScore: rankExpr,
		})
		.from(documents)
		.where(and(...conditions))
		.orderBy(desc(rankExpr))
		.limit(limit);

	return new Map(
		rows.map((row) => [
			row.id,
			{
				id: row.id,
				keywordScore: Number(row.keywordScore ?? 0),
			},
		]),
	);
}

async function getDocumentsByIds(
	documentIds: string[],
	schemaId?: string,
): Promise<DocumentRow[]> {
	if (documentIds.length === 0) return [];

	const conditions = [inArray(documents.id, documentIds)];
	if (schemaId) {
		conditions.push(eq(documents.schemaId, schemaId));
	}

	return db
		.select({
			id: documents.id,
			filename: documents.filename,
			status: documents.status,
			schemaId: documents.schemaId,
			extractionConfidence: documents.extractionConfidence,
			extractedData: documents.extractedData,
			searchText: documents.searchText,
			rawText: documents.rawText,
			createdAt: documents.createdAt,
		})
		.from(documents)
		.where(and(...conditions));
}

function scoreStructuredSignals(
	document: DocumentRow,
	query: string,
	semanticChunkCount: number,
): {
	boost: number;
	matchReasons: string[];
	matchedFields: string[];
} {
	const normalizedQuery = normalizeQuery(query);
	const filenameMatches = document.filename
		.toLowerCase()
		.includes(normalizedQuery);
	const matchedFields = extractMatchedFields(document.extractedData, query);
	const hasExactFieldMatch =
		matchedFields.length > 0 ||
		Boolean(document.searchText?.toLowerCase().includes(normalizedQuery));

	const matchReasons: string[] = [];
	let boost = 0;

	if (filenameMatches) {
		boost += 0.05;
		matchReasons.push("Filename match");
	}

	if (hasExactFieldMatch) {
		boost += 0.05;
		matchReasons.push("Exact field match");
	}

	if (semanticChunkCount > 1) {
		boost += 0.03;
		matchReasons.push("Multi-chunk semantic coverage");
	}

	if ((document.extractionConfidence ?? 0) >= 0.85) {
		boost += 0.02;
		matchReasons.push("High-confidence extraction");
	}

	return { boost, matchReasons, matchedFields };
}

function buildSnippet(
	document: DocumentRow,
	query: string,
	semanticPreview: string,
): string {
	if (semanticPreview) {
		return semanticPreview;
	}

	const corpus =
		document.searchText ??
		buildSearchCorpus({
			filename: document.filename,
			rawText: document.rawText,
			extractedData: document.extractedData,
		});

	return findSnippet(corpus, query);
}

export async function searchDocuments({
	query,
	limit,
	mode,
	schemaId,
}: SearchParams): Promise<SearchResponse> {
	const normalizedMode = buildSearchMode(mode);
	const candidateLimit = Math.max(limit * 3, CANDIDATE_LIMIT_FLOOR);
	const schema = await getSchemaContext(schemaId);

	let degraded = false;
	let degradedReason: SearchResponse["degradedReason"];
	let semanticByDocument = new Map<
		string,
		{ score: number; preview: string; chunkCount: number }
	>();

	if (normalizedMode !== "keyword") {
		if (!isSemanticSearchConfigured()) {
			degraded = true;
			degradedReason = "semantic_unavailable";
		} else {
			try {
				const semanticMatches = await searchDocument(
					query,
					Math.max(SEMANTIC_TOP_K, candidateLimit),
					{
						schemaId,
						schemaName: schema?.name,
						schemaJsonSchema: (schema?.jsonSchema ?? null) as Record<
							string,
							unknown
						> | null,
					},
				);
				semanticByDocument = collapseSemanticMatches(semanticMatches);
			} catch (error) {
				degraded = true;
				degradedReason = "semantic_unavailable";
				logger.warn(
					"Semantic search unavailable, falling back to keyword search",
					{
						error: error instanceof Error ? error.message : "Unknown",
					},
				);
			}
		}
	}

	const keywordCandidates = await getKeywordCandidates(
		query,
		candidateLimit,
		schemaId,
	);
	const candidateIds = [
		...new Set([...semanticByDocument.keys(), ...keywordCandidates.keys()]),
	];
	const docs = await getDocumentsByIds(candidateIds, schemaId);

	if (docs.length === 0) {
		return {
			mode: normalizedMode,
			results: [],
			degraded,
			...(degradedReason ? { degradedReason } : {}),
		};
	}

	const maxKeywordScore = Math.max(
		0,
		...Array.from(keywordCandidates.values()).map(
			(candidate) => candidate.keywordScore,
		),
	);

	const results = docs
		.map((document) => {
			const semanticEntry = semanticByDocument.get(document.id);
			const semanticScore = semanticEntry?.score ?? 0;
			const keywordScore =
				keywordCandidates.get(document.id)?.keywordScore ?? 0;
			const normalizedKeywordScore =
				maxKeywordScore > 0 ? keywordScore / maxKeywordScore : 0;
			const structuredSignals = scoreStructuredSignals(
				document,
				query,
				semanticEntry?.chunkCount ?? 0,
			);
			const structuredScore = Math.min(0.1, structuredSignals.boost);
			const score =
				normalizedMode === "keyword"
					? clampScore(normalizedKeywordScore + structuredScore)
					: clampScore(
							semanticScore * 0.7 +
								normalizedKeywordScore * 0.2 +
								structuredScore,
						);

			const matchReasons = [
				...(semanticScore > 0 ? ["Semantic match"] : []),
				...(schemaId ? ["Schema-filtered"] : []),
				...structuredSignals.matchReasons,
			].filter((reason, index, reasons) => reasons.indexOf(reason) === index);

			return {
				id: document.id,
				filename: document.filename,
				schemaId: document.schemaId,
				status: document.status,
				extractionConfidence: document.extractionConfidence,
				score,
				snippet: buildSnippet(document, query, semanticEntry?.preview ?? ""),
				matchReasons,
				matchedFields: structuredSignals.matchedFields,
				createdAt: document.createdAt,
			};
		})
		.sort((left, right) => {
			if (right.score !== left.score) {
				return right.score - left.score;
			}
			return right.createdAt.getTime() - left.createdAt.getTime();
		})
		.slice(0, limit)
		.map(({ createdAt: _createdAt, ...result }) => result);

	return {
		mode: normalizedMode,
		results,
		degraded,
		...(degradedReason ? { degradedReason } : {}),
	};
}
