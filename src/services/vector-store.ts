import { Pinecone } from "@pinecone-database/pinecone";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";
import { getOpenRouterClient } from "../lib/openrouter.js";

let pinecone: Pinecone | null = null;

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

export async function indexDocument(
	documentId: string,
	filename: string,
	extractedData: Record<string, unknown>,
): Promise<void> {
	const pc = getPinecone();
	if (!pc) return;

	const summary = JSON.stringify(extractedData).slice(0, 4000);
	const embedding = await getEmbedding(summary);

	const index = pc.Index(config.pinecone.index);
	await index.upsert([
		{
			id: documentId,
			values: embedding,
			metadata: { filename, summary },
		},
	]);

	logger.info("Document indexed in Pinecone", { documentId });
}

export async function searchDocument(
	query: string,
	limit: number,
): Promise<Array<{ id: string; score: number; metadata: unknown }>> {
	const pc = getPinecone();
	if (!pc) {
		logger.warn("Pinecone not configured, skipping semantic search");
		return [];
	}

	const embedding = await getEmbedding(query);
	const index = pc.Index(config.pinecone.index);
	const results = await index.query({
		vector: embedding,
		topK: limit,
		includeMetadata: true,
	});

	return (results.matches || []).map((m) => ({
		id: m.id,
		score: m.score || 0,
		metadata: m.metadata,
	}));
}
