import { config } from "../config.js";
import { logger } from "../lib/logger.js";
import { getOpenRouterClient } from "../lib/openrouter.js";
import { parseLLMResponse } from "../lib/parse-llm-response.js";
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
- Each jsonSchema field must be a valid JSON object serialized as a string, following JSON Schema draft-07 format with "type": "object" and "properties"

IMPORTANT: You MUST respond with ONLY valid JSON. No explanatory text before or after the JSON.`,
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

	const parsed = parseLLMResponse<Record<string, unknown>>(content);

	// The model may nest the result under a wrapper key (e.g. "schema_recommendations")
	// or return it directly. Normalize to our expected shape.
	let result: SchemaRecommendationResult;

	if (Array.isArray(parsed.recommendations)) {
		result = parsed as unknown as SchemaRecommendationResult;
	} else if (Array.isArray(parsed.schemas)) {
		// LLM used "schemas" instead of "recommendations"
		result = {
			recommendations: parsed.schemas as unknown as RecommendedSchema[],
			analysis:
				typeof parsed.analysis === "string"
					? parsed.analysis
					: "Analysis not provided by model",
		};
	} else {
		// Check if the expected data is nested under another key
		const nested = Object.values(parsed).find(
			(v) =>
				typeof v === "object" &&
				v !== null &&
				"recommendations" in v &&
				Array.isArray((v as Record<string, unknown>).recommendations),
		) as SchemaRecommendationResult | undefined;

		if (nested) {
			result = nested;
		} else {
			// Last resort: maybe the entire response IS the array of recommendations
			const values = Object.values(parsed);
			const arr = values.find((v) => Array.isArray(v)) as
				| RecommendedSchema[]
				| undefined;
			if (arr && arr.length > 0 && typeof arr[0] === "object" && arr[0] !== null && "name" in arr[0]) {
				const normalized = (arr as unknown as Record<string, unknown>[]).map((item) => ({
					name: item.name as string,
					description: (item.description ?? "") as string,
					jsonSchema: (item.jsonSchema ?? item.json_schema ?? "{}") as string,
					classificationHints: (item.classificationHints ??
						item.classification_hints ??
						[]) as string[],
					reasoning: (item.reasoning ?? "") as string,
					matchingDocuments: (item.matchingDocuments ??
						item.matching_documents ??
						[]) as string[],
				}));
				result = {
					recommendations: normalized,
					analysis:
						typeof parsed.analysis === "string"
							? parsed.analysis
							: "Analysis not provided by model",
				};
			} else {
				logger.error("Unexpected LLM response structure", {
					keys: Object.keys(parsed),
				});
				throw new Error(
					`LLM returned unexpected JSON structure. Top-level keys: ${Object.keys(parsed).join(", ")}`,
				);
			}
		}
	}

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
