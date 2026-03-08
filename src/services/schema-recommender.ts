import { config } from "../config.js";
import { logger } from "../lib/logger.js";
import { getOpenRouterClient } from "../lib/openrouter.js";
import type { ExtractionSchema } from "../types/index.js";

const MAX_TEXT_LENGTH = 4000;

export interface RecommendedSchema {
	name: string;
	description: string;
	jsonSchema: string;
	classificationHints: string[];
	reasoning: string;
	matchingDocuments: string[];
}

export interface SchemaRecommendationResult {
	recommendations: RecommendedSchema[];
	analysis: string;
}

interface DocumentInput {
	filename: string;
	text: string;
}

export async function recommendSchemas(
	documents: DocumentInput[],
	existingSchemas: ExtractionSchema[],
): Promise<SchemaRecommendationResult> {
	const client = getOpenRouterClient();

	const documentSummaries = documents
		.map(
			(d, i) =>
				`--- Document ${i + 1}: ${d.filename} ---\n${d.text.slice(0, MAX_TEXT_LENGTH)}`,
		)
		.join("\n\n");

	const existingDescriptions =
		existingSchemas.length > 0
			? `\n\nExisting schemas (avoid duplicating these):\n${existingSchemas
					.map((s) => `- ${s.name}: ${s.description}`)
					.join("\n")}`
			: "";

	const response = await client.chat.completions.create({
		model: config.openrouter.model,
		messages: [
			{
				role: "system",
				content: `You are a document analysis expert. Analyze the provided documents and recommend JSON Schema definitions for structured data extraction.

Guidelines:
- Identify distinct document types among the uploaded documents
- Group similar documents together under one schema
- Use appropriate JSON Schema field types (string, number, boolean, array, object)
- Suggest classification hints (keywords/phrases that identify this document type)
- If an existing schema already covers a document type, mention it in your reasoning and skip recommending a duplicate
- Each jsonSchema field must be a valid JSON object serialized as a string, following JSON Schema draft-07 format with "type": "object" and "properties"`,
			},
			{
				role: "user",
				content: `Analyze these documents and recommend extraction schemas:

${documentSummaries}${existingDescriptions}`,
			},
		],
		response_format: {
			type: "json_schema",
			json_schema: {
				name: "schema_recommendations",
				strict: true,
				schema: {
					type: "object",
					properties: {
						recommendations: {
							type: "array",
							items: {
								type: "object",
								properties: {
									name: {
										type: "string",
										description: "Human-readable name for the schema",
									},
									description: {
										type: "string",
										description: "Description of what this schema extracts",
									},
									jsonSchema: {
										type: "string",
										description:
											"JSON Schema definition as a JSON-encoded string",
									},
									classificationHints: {
										type: "array",
										items: { type: "string" },
										description:
											"Keywords or phrases that identify this document type",
									},
									reasoning: {
										type: "string",
										description:
											"Why this schema was recommended based on the documents",
									},
									matchingDocuments: {
										type: "array",
										items: { type: "string" },
										description:
											"Filenames of documents that match this schema",
									},
								},
								required: [
									"name",
									"description",
									"jsonSchema",
									"classificationHints",
									"reasoning",
									"matchingDocuments",
								],
								additionalProperties: false,
							},
						},
						analysis: {
							type: "string",
							description:
								"Overall summary of the document analysis and recommendations",
						},
					},
					required: ["recommendations", "analysis"],
					additionalProperties: false,
				},
			},
		},
	});

	const content = response.choices[0]?.message?.content;
	if (!content) {
		throw new Error("No response from LLM for schema recommendation");
	}

	const result = JSON.parse(content) as SchemaRecommendationResult;

	// Validate that each jsonSchema is valid JSON
	for (const rec of result.recommendations) {
		try {
			JSON.parse(rec.jsonSchema);
		} catch {
			logger.warn("Invalid JSON in recommended schema, skipping validation", {
				name: rec.name,
			});
		}
	}

	logger.info("Schema recommendations generated", {
		count: result.recommendations.length,
		documentCount: documents.length,
	});

	return result;
}
