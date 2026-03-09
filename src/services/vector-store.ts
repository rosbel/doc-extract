import { Pinecone } from "@pinecone-database/pinecone";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";
import { getOpenRouterClient } from "../lib/openrouter.js";
import {
	buildSearchChunks,
	buildSemanticQueryText,
	type SearchChunk,
} from "./search-index.js";

let pinecone: Pinecone | null = null;

export type IndexedDocumentInput = {
	documentId: string;
	filename: string;
	rawText?: string | null;
	extractedData: Record<string, unknown>;
	schemaId?: string | null;
	schemaName?: string | null;
	schemaDescription?: string | null;
	schemaJsonSchema?: Record<string, unknown> | null;
};

export type SemanticChunkMatch = {
	id: string;
	score: number;
	metadata: {
		documentId?: string;
		schemaId?: string;
		filename?: string;
		chunkIndex?: number;
		chunkType?: string;
		preview?: string;
		[key: string]: unknown;
	} | null;
};

function getPinecone(): Pinecone | null {
	if (!config.pinecone.apiKey) return null;
	if (!pinecone) {
		pinecone = new Pinecone({ apiKey: config.pinecone.apiKey });
	}
	return pinecone;
}

async function getEmbedding(text: string): Promise<number[]> {
	const client = getOpenRouterClient();
	const response = await client.embeddings.create({
		model: "openai/text-embedding-3-small",
		input: text.slice(0, 8000),
	});
	return response.data[0].embedding;
}

async function embedChunks(chunks: SearchChunk[]): Promise<number[][]> {
	const embeddings = await Promise.all(chunks.map((chunk) => getEmbedding(chunk.text)));
	return embeddings;
}

export function isSemanticSearchConfigured(): boolean {
	return Boolean(config.pinecone.apiKey);
}

export async function indexDocument(input: IndexedDocumentInput): Promise<void> {
	const pc = getPinecone();
	if (!pc) return;

	const chunks = buildSearchChunks({
		filename: input.filename,
		rawText: input.rawText,
		extractedData: input.extractedData,
		schemaName: input.schemaName,
		schemaDescription: input.schemaDescription,
		schemaJsonSchema: input.schemaJsonSchema,
	});
	if (chunks.length === 0) return;

	const embeddings = await embedChunks(chunks);

	const index = pc.Index(config.pinecone.index);
	await index.upsert(
		chunks.map((chunk, indexNumber) => ({
			id: `${input.documentId}:${chunk.idSuffix}`,
			values: embeddings[indexNumber],
			metadata: {
				documentId: input.documentId,
				filename: input.filename,
				chunkIndex: chunk.chunkIndex,
				chunkType: chunk.chunkType,
				preview: chunk.preview,
				...(input.schemaId ? { schemaId: input.schemaId } : {}),
			},
		})),
	);

	logger.info("Document indexed in Pinecone", { documentId: input.documentId });
}

export async function searchDocument(
	query: string,
	limit: number,
	options?: {
		schemaId?: string;
		schemaName?: string | null;
		schemaJsonSchema?: Record<string, unknown> | null;
	},
): Promise<SemanticChunkMatch[]> {
	const pc = getPinecone();
	if (!pc) {
		throw new Error("Semantic search backend unavailable");
	}

	const semanticQuery = buildSemanticQueryText(query, {
		name: options?.schemaName,
		jsonSchema: options?.schemaJsonSchema,
	});
	const embedding = await getEmbedding(semanticQuery);
	const index = pc.Index(config.pinecone.index);
	const results = await index.query({
		vector: embedding,
		topK: limit,
		includeMetadata: true,
		...(options?.schemaId ? { filter: { schemaId: { $eq: options.schemaId } } } : {}),
	});

	return (results.matches || []).map((m) => ({
		id: m.id,
		score: m.score || 0,
		metadata: (m.metadata as SemanticChunkMatch["metadata"]) ?? null,
	}));
}
