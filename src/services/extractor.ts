import { config } from "../config.js";
import { logger } from "../lib/logger.js";
import { getOpenRouterClient } from "../lib/openrouter.js";
import { parseLLMResponse } from "../lib/parse-llm-response.js";

export interface ExtractionResult {
	extractedData: Record<string, unknown>;
	confidence: number;
}

/**
 * Normalize a user-defined JSON Schema for OpenRouter structured output.
 * OpenRouter requires additionalProperties: false and all properties listed in required.
 */
function normalizeSchema(
	schema: Record<string, unknown>,
): Record<string, unknown> {
	const normalized = { ...schema };

	if (normalized.type === "object" && normalized.properties) {
		normalized.additionalProperties = false;
		const props = normalized.properties as Record<string, unknown>;
		normalized.required = Object.keys(props);

		// Recursively normalize nested objects
		for (const [key, value] of Object.entries(props)) {
			if (typeof value === "object" && value !== null) {
				const prop = value as Record<string, unknown>;
				if (prop.type === "object") {
					props[key] = normalizeSchema(prop);
				} else if (prop.type === "array" && typeof prop.items === "object") {
					prop.items = normalizeSchema(
						prop.items as Record<string, unknown>,
					);
				}
			}
		}
	}

	return normalized;
}

export async function extractDocument(
	documentText: string,
	userSchema: Record<string, unknown>,
	schemaName: string,
): Promise<ExtractionResult> {
	const client = getOpenRouterClient();
	const normalizedUserSchema = normalizeSchema(userSchema);

	// Wrap user schema in an envelope with confidence
	const envelopeSchema = {
		type: "object" as const,
		properties: {
			extractedData: normalizedUserSchema,
			confidence: {
				type: "number" as const,
				description: "Confidence score between 0 and 1",
			},
		},
		required: ["extractedData", "confidence"],
		additionalProperties: false,
	};

	const response = await client.chat.completions.create({
		model: config.openrouter.model,
		messages: [
			{
				role: "system",
				content: `You are a data extraction assistant. Extract structured data from the document according to the "${schemaName}" schema. Be precise and extract only what is present in the document. Set confidence based on how well the document matches the schema.

IMPORTANT: You MUST respond with ONLY valid JSON. No explanatory text before or after the JSON.`,
			},
			{
				role: "user",
				content: `Extract structured data from this document:\n\n${documentText}`,
			},
		],
		response_format: {
			type: "json_schema",
			json_schema: {
				name: "extraction_result",
				strict: true,
				schema: envelopeSchema,
			},
		},
	});

	const content = response.choices[0]?.message?.content;
	if (!content) {
		throw new Error("No response from LLM for extraction");
	}

	const result = parseLLMResponse<ExtractionResult>(content);

	// Handle snake_case variants from LLM
	const raw = result as unknown as Record<string, unknown>;
	if (!result.extractedData && raw.extracted_data) {
		result.extractedData = raw.extracted_data as Record<string, unknown>;
	}
	if (result.confidence === undefined && raw.confidence_score !== undefined) {
		result.confidence = raw.confidence_score as number;
	}

	// Handle LLM ignoring envelope: data fields returned flat at top level
	if (!result.extractedData && raw.confidence !== undefined) {
		const { confidence, ...dataFields } = raw;
		if (Object.keys(dataFields).length > 0) {
			logger.warn("LLM returned flat response without extractedData envelope, reconstructing");
			result.extractedData = dataFields as Record<string, unknown>;
			result.confidence = confidence as number;
		}
	}

	if (
		!result.extractedData ||
		typeof result.extractedData !== "object" ||
		Array.isArray(result.extractedData)
	) {
		throw new Error(
			`Extractor returned invalid extractedData: ${JSON.stringify(result.extractedData)}`,
		);
	}

	if (typeof result.confidence !== "number" || isNaN(result.confidence)) {
		throw new Error(
			`Extractor returned invalid confidence: ${JSON.stringify(result.confidence)}`,
		);
	}

	logger.info("Document extracted", {
		schemaName,
		confidence: result.confidence,
		fieldCount: Object.keys(result.extractedData).length,
	});
	return result;
}
