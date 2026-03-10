import { config } from "../config.js";
import { logger } from "../lib/logger.js";
import { getOpenRouterClient } from "../lib/openrouter.js";
import { parseLLMResponse } from "../lib/parse-llm-response.js";
import type { ExtractionSchema } from "../types/index.js";

const MAX_TEXT_LENGTH = 8000;

export interface ClassificationResult {
	matched: boolean;
	schemaId: string | null;
	confidence: number;
	reasoning: string;
}

export async function classifyDocument(
	documentText: string,
	schemas: ExtractionSchema[],
): Promise<ClassificationResult> {
	const client = getOpenRouterClient();
	const truncatedText = documentText.slice(0, MAX_TEXT_LENGTH);

	const schemaDescriptions = schemas
		.map(
			(s) =>
				`- ID: ${s.id}\n  Name: ${s.name}\n  Description: ${s.description}\n  Hints: ${s.classificationHints.join(", ")}`,
		)
		.join("\n");

	const response = await client.chat.completions.create({
		model: config.openrouter.model,
		messages: [
			{
				role: "system",
				content: `You are a document classifier. Given document text and a list of schemas, determine which schema best matches the document. If none of the schemas are a reasonable fit, return matched=false and schemaId=null. Only return matched=true when the document clearly fits one of the provided schemas. Respond with matched, schemaId, a confidence score (0-1), and brief reasoning.

IMPORTANT: You MUST respond with ONLY valid JSON. No explanatory text before or after the JSON.`,
			},
			{
				role: "user",
				content: `Available schemas:\n${schemaDescriptions}\n\nDocument text:\n${truncatedText}`,
			},
		],
		response_format: {
			type: "json_schema",
			json_schema: {
				name: "classification_result",
				strict: true,
				schema: {
					type: "object",
					properties: {
						matched: {
							type: "boolean",
							description:
								"Whether the document matches one of the provided schemas",
						},
						schemaId: {
							type: ["string", "null"],
							description:
								"The ID of the matching schema, or null when no schema matches",
						},
						confidence: {
							type: "number",
							description: "Confidence score between 0 and 1",
						},
						reasoning: {
							type: "string",
							description: "Brief explanation of why this schema was chosen",
						},
					},
					required: ["matched", "schemaId", "confidence", "reasoning"],
					additionalProperties: false,
				},
			},
		},
	});

	const content = response.choices[0]?.message?.content;
	if (!content) {
		throw new Error("No response from LLM for classification");
	}

	const result = parseLLMResponse<ClassificationResult>(content);

	// Handle snake_case variant from LLM
	const raw = result as unknown as Record<string, unknown>;
	if (!result.schemaId && raw.schema_id) {
		result.schemaId = raw.schema_id as string;
	}
	if (typeof raw.matched === "boolean") {
		result.matched = raw.matched;
	}
	if (typeof result.matched !== "boolean") {
		result.matched = Boolean(result.schemaId);
	}

	const normalizedSchemaId =
		typeof result.schemaId === "string"
			? result.schemaId.trim()
			: result.schemaId;
	if (
		normalizedSchemaId &&
		["none", "null", "no_match", "unclassified"].includes(
			normalizedSchemaId.toLowerCase(),
		)
	) {
		result.matched = false;
		result.schemaId = null;
	}

	if (result.matched === false) {
		result.schemaId = null;
		logger.info("Document classified as unclassified", {
			confidence: result.confidence,
		});
		return result;
	}

	if (!result.schemaId || typeof result.schemaId !== "string") {
		throw new Error(
			`Classifier returned invalid schemaId: ${JSON.stringify(result.schemaId)}`,
		);
	}

	const validIds = new Set(schemas.map((s) => s.id));
	if (!validIds.has(result.schemaId)) {
		throw new Error(
			`Classifier returned unknown schemaId "${result.schemaId}". Valid IDs: ${[...validIds].join(", ")}`,
		);
	}

	logger.info("Document classified", {
		schemaId: result.schemaId,
		confidence: result.confidence,
	});
	return result;
}
