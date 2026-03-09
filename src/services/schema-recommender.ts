import { config } from "../config.js";
import { logger } from "../lib/logger.js";
import { getOpenRouterClient } from "../lib/openrouter.js";
import { parseLLMResponse } from "../lib/parse-llm-response.js";
import type { ExtractionSchema } from "../types/index.js";

const MAX_TEXT_LENGTH = 8000;

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
	warnings?: Array<{ filename: string; warning: string }>;
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

	let response;
	try {
		response = await client.chat.completions.create({
		model: config.openrouter.model,
		messages: [
			{
				role: "system",
				content: `You are a document analysis expert. Analyze the provided documents and recommend JSON Schema definitions for structured data extraction.

Document categories you should recognize include (but are not limited to):
- Resumes / CVs
- Invoices and receipts
- Contracts and agreements
- Reports (financial, medical, technical)
- Forms (applications, registrations, surveys)
- Letters and correspondence
- Manuals and documentation

Schema design guidelines:
- Identify distinct document types among the uploaded documents
- Group similar documents together under one schema
- Use nested objects for logically grouped data (e.g., "contactInfo" with name, email, phone)
- Use arrays for repeated entries (e.g., "workExperience" array of objects with company, role, dates)
- Every property MUST include a "description" field explaining what it captures
- For date fields, specify the expected format in the description (e.g., "ISO 8601 date string YYYY-MM-DD")
- Use appropriate JSON Schema field types (string, number, boolean, array, object)
- Design schemas that generalize beyond the specific sample — capture the document TYPE, not just this one instance
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
	} catch (err) {
		const message =
			err instanceof Error ? err.message : "Unknown error";
		logger.error("LLM call failed for schema recommendation", {
			error: message,
		});
		throw new Error(
			"Failed to analyze documents — the AI service is temporarily unavailable. Please try again.",
		);
	}

	const content = response.choices[0]?.message?.content;
	if (!content) {
		throw new Error("No response from LLM for schema recommendation");
	}

	const parsed = parseLLMResponse<Record<string, unknown>>(content);

	logger.debug("Raw LLM response keys", { keys: Object.keys(parsed) });

	// --- Find the recommendations array (LLM uses inconsistent key names) ---
	let rawRecs: unknown[] | undefined;

	// 1) Try known key names at top level
	for (const key of Object.keys(parsed)) {
		const val = parsed[key];
		if (Array.isArray(val)) {
			rawRecs = val;
			break;
		}
	}

	// 2) Check if data is nested under a wrapper object
	if (!rawRecs) {
		for (const val of Object.values(parsed)) {
			if (typeof val === "object" && val !== null && !Array.isArray(val)) {
				const inner = val as Record<string, unknown>;
				const arr = Object.values(inner).find((v) => Array.isArray(v)) as unknown[] | undefined;
				if (arr) {
					rawRecs = arr;
					break;
				}
			}
		}
	}

	// 3) Top-level object is a single recommendation (flat object with schema-like keys)
	if (!rawRecs) {
		const hasSchemaKeys =
			("jsonSchema" in parsed || "json_schema" in parsed || "schema" in parsed) &&
			("description" in parsed || "name" in parsed || "category" in parsed || "documentType" in parsed);
		if (hasSchemaKeys) {
			rawRecs = [parsed];
			logger.warn("LLM returned a single recommendation object, wrapping it");
		}
	}

	// --- Find the analysis string ---
	let rawAnalysis: string | undefined;
	for (const [key, val] of Object.entries(parsed)) {
		if (typeof val === "string" && !Array.isArray(parsed[key]) && key !== "jsonSchema" && key !== "json_schema") {
			rawAnalysis = val;
			break;
		}
	}

	// Empty array is valid (LLM says no new schemas needed)
	if (rawRecs && rawRecs.length === 0) {
		return {
			recommendations: [],
			analysis: rawAnalysis ?? "No new schemas recommended — existing schemas already cover these documents.",
		};
	}

	if (!rawRecs) {
		logger.error("Unexpected LLM response structure", { keys: Object.keys(parsed) });
		throw new Error(
			`LLM returned unexpected JSON structure. Top-level keys: ${Object.keys(parsed).join(", ")}`,
		);
	}

	// --- Normalize each recommendation item ---
	const recommendations = (rawRecs as Record<string, unknown>[]).map((item) => {
		// jsonSchema may be a string or an already-parsed object
		let jsonSchemaStr: string;
		const rawSchema = item.jsonSchema ?? item.json_schema ?? item.schema;
		if (typeof rawSchema === "string") {
			jsonSchemaStr = rawSchema;
		} else if (typeof rawSchema === "object" && rawSchema !== null) {
			jsonSchemaStr = JSON.stringify(rawSchema);
		} else {
			jsonSchemaStr = "{}";
		}

		const name = ((item.name ?? item.documentType ?? item.document_type ?? item.category ?? item.title ?? "Untitled Schema") as string);
		const description = ((item.description ?? item.summary ?? "") as string) || `Extraction schema for ${name}`;

		return {
			name,
			description,
			jsonSchema: jsonSchemaStr,
			classificationHints: ((item.classificationHints ?? item.classification_hints ?? item.hints ?? item.keywords ?? []) as string[]),
			reasoning: ((item.reasoning ?? item.rationale ?? item.explanation ?? "") as string),
			matchingDocuments: ((item.matchingDocuments ?? item.matching_documents ?? item.matchingFiles ?? item.documents ?? []) as string[]),
		};
	});

	const result: SchemaRecommendationResult = {
		recommendations,
		analysis: rawAnalysis ?? "Document analysis complete.",
	};

	// Validate that each jsonSchema is valid JSON
	for (const rec of result.recommendations) {
		try {
			JSON.parse(rec.jsonSchema);
		} catch {
			logger.warn("Invalid JSON in recommended schema, attempting repair", { name: rec.name });
			rec.jsonSchema = "{}";
		}
	}

	// Filter out no-op recommendations (empty schema + empty description = LLM says "already exists")
	const noopRecs: RecommendedSchema[] = [];
	result.recommendations = result.recommendations.filter((rec) => {
		const schemaEmpty = rec.jsonSchema === "{}" || rec.jsonSchema === "";
		const descEmpty = !rec.description;
		if (schemaEmpty && descEmpty) {
			noopRecs.push(rec);
			return false;
		}
		return true;
	});

	// Incorporate no-op reasoning into the analysis
	if (noopRecs.length > 0) {
		const notes = noopRecs
			.filter((r) => r.reasoning)
			.map((r) => r.reasoning)
			.join(" ");
		if (notes) {
			result.analysis = result.analysis === "Document analysis complete."
				? notes
				: `${result.analysis} ${notes}`;
		}
	}

	logger.info("Schema recommendations generated", {
		count: result.recommendations.length,
		filteredCount: noopRecs.length,
		documentCount: documents.length,
	});

	return result;
}
