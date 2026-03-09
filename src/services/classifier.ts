import { config } from "../config.js";
import { logger } from "../lib/logger.js";
import { getOpenRouterClient } from "../lib/openrouter.js";
import { parseLLMResponse } from "../lib/parse-llm-response.js";
import type { ExtractionSchema } from "../types/index.js";

const MAX_TEXT_LENGTH = 8000;

export interface ClassificationResult {
	schemaId: string;
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
				content: `You are a document classifier. Given document text and a list of schemas, determine which schema best matches the document. Respond with the schema ID, a confidence score (0-1), and brief reasoning.

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
						schemaId: {
							type: "string",
							description: "The ID of the matching schema",
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
					required: ["schemaId", "confidence", "reasoning"],
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
