import type { ChatCompletion } from "openai/resources/chat/completions";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";
import { getOpenRouterClient } from "../lib/openrouter.js";
import { parseLLMResponse } from "../lib/parse-llm-response.js";
import type { ExtractionSchema } from "../types/index.js";

const MAX_TEXT_LENGTH = 8000;

export interface AssistantDocumentInput {
	filename: string;
	text: string;
}

export interface SchemaAssistantProposal {
	name: string;
	description: string;
	jsonSchema: Record<string, unknown>;
	classificationHints: string[];
	reasoning: string;
	matchingDocuments: string[];
}

export interface SchemaDiffEntry {
	field: "name" | "description" | "classificationHints" | "jsonSchema";
	label: string;
	changed: boolean;
	before: unknown;
	after: unknown;
}

export interface CreateSchemaAssistResult {
	analysis: string;
	proposals: SchemaAssistantProposal[];
}

export interface EditSchemaAssistResult {
	analysis: string;
	proposal: SchemaAssistantProposal;
	diff: SchemaDiffEntry[];
}

interface ProposalNormalizationDefaults {
	name?: string;
	description?: string;
	jsonSchema?: Record<string, unknown>;
	classificationHints?: string[];
	reasoning?: string;
	matchingDocuments?: string[];
}

class SchemaAssistantOutputError extends Error {
	statusCode = 502;

	constructor(message: string) {
		super(message);
		this.name = "SchemaAssistantOutputError";
	}
}

function buildDocumentSummaries(documents: AssistantDocumentInput[]) {
	return documents
		.map(
			(document, index) =>
				`--- Document ${index + 1}: ${document.filename} ---\n${document.text.slice(0, MAX_TEXT_LENGTH)}`,
		)
		.join("\n\n");
}

function buildPromptContext(prompt?: string) {
	return prompt?.trim() ? `\n\nUser request:\n${prompt.trim()}` : "";
}

function buildExistingSchemaContext(existingSchemas: ExtractionSchema[]) {
	if (existingSchemas.length === 0) {
		return "";
	}

	return `\n\nExisting schemas (avoid duplicating these):\n${existingSchemas
		.map((schema) => `- ${schema.name}: ${schema.description}`)
		.join("\n")}`;
}

function summarizeKeys(value: unknown) {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return [];
	}

	return Object.keys(value as Record<string, unknown>).slice(0, 12);
}

function readProperty(
	record: Record<string, unknown>,
	keys: string[],
): { found: boolean; value: unknown } {
	for (const key of keys) {
		if (key in record) {
			return {
				found: true,
				value: record[key],
			};
		}
	}

	return {
		found: false,
		value: undefined,
	};
}

function normalizeJsonSchema(
	rawSchema: unknown,
	fallback?: Record<string, unknown>,
) {
	if (rawSchema === undefined) {
		if (fallback) {
			return fallback;
		}
		throw new Error("Proposal jsonSchema is missing");
	}

	if (typeof rawSchema === "string") {
		return JSON.parse(rawSchema) as Record<string, unknown>;
	}

	if (
		typeof rawSchema === "object" &&
		rawSchema !== null &&
		!Array.isArray(rawSchema)
	) {
		return rawSchema as Record<string, unknown>;
	}

	throw new Error(`Invalid jsonSchema payload: ${JSON.stringify(rawSchema)}`);
}

function normalizeProposal(
	item: Record<string, unknown>,
	defaults: ProposalNormalizationDefaults = {},
) {
	const nameValue = readProperty(item, ["name", "title"]);
	const descriptionValue = readProperty(item, ["description"]);
	const jsonSchemaValue = readProperty(item, [
		"jsonSchema",
		"json_schema",
		"schema",
	]);
	const classificationHintsValue = readProperty(item, [
		"classificationHints",
		"classification_hints",
	]);
	const reasoningValue = readProperty(item, ["reasoning", "rationale"]);
	const matchingDocumentsValue = readProperty(item, [
		"matchingDocuments",
		"matching_documents",
	]);

	return {
		name: nameValue.found
			? String(nameValue.value ?? "")
			: (defaults.name ?? ""),
		description: descriptionValue.found
			? String(descriptionValue.value ?? "")
			: (defaults.description ?? ""),
		jsonSchema: normalizeJsonSchema(jsonSchemaValue.value, defaults.jsonSchema),
		classificationHints: classificationHintsValue.found
			? Array.isArray(classificationHintsValue.value)
				? classificationHintsValue.value.map((value) => String(value))
				: []
			: (defaults.classificationHints ?? []),
		reasoning: reasoningValue.found
			? String(reasoningValue.value ?? "")
			: (defaults.reasoning ?? ""),
		matchingDocuments: matchingDocumentsValue.found
			? Array.isArray(matchingDocumentsValue.value)
				? matchingDocumentsValue.value.map((value) => String(value))
				: []
			: (defaults.matchingDocuments ?? []),
	} satisfies SchemaAssistantProposal;
}

function collectRawCreateProposals(parsed: Record<string, unknown>) {
	if (Array.isArray(parsed.proposals)) {
		return parsed.proposals;
	}

	if (
		typeof parsed.proposal === "object" &&
		parsed.proposal !== null &&
		!Array.isArray(parsed.proposal)
	) {
		return [parsed.proposal];
	}

	if (
		("name" in parsed || "title" in parsed) &&
		("jsonSchema" in parsed || "json_schema" in parsed || "schema" in parsed)
	) {
		return [parsed];
	}

	return [];
}

function tryNormalizeProposal(
	item: unknown,
	context: "create" | "edit",
	index = 0,
	defaults?: ProposalNormalizationDefaults,
	meta?: Record<string, unknown>,
): SchemaAssistantProposal | null {
	if (!item || typeof item !== "object" || Array.isArray(item)) {
		logger.warn("Schema assistant returned an invalid proposal shape", {
			context,
			index,
			type: Array.isArray(item) ? "array" : typeof item,
			...meta,
		});
		return null;
	}

	try {
		const proposal = normalizeProposal(
			item as Record<string, unknown>,
			defaults,
		);
		if (!proposal.name.trim()) {
			throw new Error("Proposal name is empty");
		}
		if (!proposal.description.trim()) {
			throw new Error("Proposal description is empty");
		}
		if (
			typeof proposal.jsonSchema !== "object" ||
			proposal.jsonSchema === null ||
			Array.isArray(proposal.jsonSchema)
		) {
			throw new Error("Proposal jsonSchema is not an object");
		}
		return proposal;
	} catch (error) {
		logger.warn("Ignoring invalid schema assistant proposal", {
			context,
			index,
			error: error instanceof Error ? error.message : "Unknown error",
			candidateKeys: summarizeKeys(item),
			...meta,
		});
		return null;
	}
}

function collectRawEditProposal(parsed: Record<string, unknown>) {
	if (
		typeof parsed.proposal === "object" &&
		parsed.proposal !== null &&
		!Array.isArray(parsed.proposal)
	) {
		return {
			candidate: parsed.proposal,
			candidateShape: "proposal",
		};
	}

	if (Array.isArray(parsed.proposals) && parsed.proposals.length > 0) {
		return {
			candidate: parsed.proposals[0],
			candidateShape: "proposals[0]",
		};
	}

	if (
		("name" in parsed || "title" in parsed) &&
		("jsonSchema" in parsed || "json_schema" in parsed || "schema" in parsed)
	) {
		return {
			candidate: parsed,
			candidateShape: "top-level",
		};
	}

	return {
		candidate: undefined,
		candidateShape: "none",
	};
}

function stableValue(value: unknown): string {
	if (Array.isArray(value)) {
		return `[${value.map((item) => stableValue(item)).join(",")}]`;
	}

	if (value && typeof value === "object") {
		return `{${Object.entries(value as Record<string, unknown>)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, child]) => `${JSON.stringify(key)}:${stableValue(child)}`)
			.join(",")}}`;
	}

	return JSON.stringify(value);
}

export function computeSchemaDiff(
	current: Pick<
		SchemaAssistantProposal,
		"name" | "description" | "classificationHints" | "jsonSchema"
	>,
	proposal: Pick<
		SchemaAssistantProposal,
		"name" | "description" | "classificationHints" | "jsonSchema"
	>,
): SchemaDiffEntry[] {
	const fields = [
		["name", "Name"],
		["description", "Description"],
		["classificationHints", "Classification Hints"],
		["jsonSchema", "JSON Schema"],
	] as const;

	return fields.map(([field, label]) => {
		const before = current[field];
		const after = proposal[field];
		return {
			field,
			label,
			before,
			after,
			changed: stableValue(before) !== stableValue(after),
		};
	});
}

async function createStructuredCompletion(
	systemPrompt: string,
	userPrompt: string,
	responseSchema: Record<string, unknown>,
) {
	const client = getOpenRouterClient();

	let response: ChatCompletion;
	try {
		response = await client.chat.completions.create({
			model: config.openrouter.model,
			messages: [
				{ role: "system", content: systemPrompt },
				{ role: "user", content: userPrompt },
			],
			response_format: {
				type: "json_schema",
				json_schema: {
					name: "schema_assistant",
					strict: true,
					schema: responseSchema,
				},
			},
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : "Unknown error";
		logger.error("LLM call failed for schema assistant", { error: message });
		throw new Error(
			"Failed to analyze schema changes — the AI service is temporarily unavailable. Please try again.",
		);
	}

	const content = response.choices[0]?.message?.content;
	if (!content) {
		throw new Error("No response from LLM for schema assistant");
	}

	return parseLLMResponse<Record<string, unknown>>(content);
}

export async function assistSchemaCreation(
	documents: AssistantDocumentInput[],
	existingSchemas: ExtractionSchema[],
	prompt?: string,
): Promise<CreateSchemaAssistResult> {
	const parsed = await createStructuredCompletion(
		`You are a document analysis expert. Create extraction schema proposals for a schema-driven document extraction product.

Rules:
- Always return valid JSON only.
- Proposals must be reusable beyond a single sample document.
- Each proposal must have: name, description, jsonSchema, classificationHints, reasoning, matchingDocuments.
- jsonSchema must be a JSON object using draft-07 style with type "object" and a properties object.
- Every schema property must include a description.
- Use matchingDocuments to name any uploaded files that fit the proposal.
- Do not duplicate existing schemas if the request is already covered.`,
		`Create schema proposals based on the supplied materials.

${documents.length > 0 ? `Uploaded documents:\n${buildDocumentSummaries(documents)}` : "No documents were uploaded."}${buildPromptContext(prompt)}${buildExistingSchemaContext(existingSchemas)}`,
		{
			type: "object",
			properties: {
				analysis: { type: "string" },
				proposals: {
					type: "array",
					items: {
						type: "object",
						properties: {
							name: { type: "string" },
							description: { type: "string" },
							jsonSchema: {
								type: "object",
								additionalProperties: true,
							},
							classificationHints: {
								type: "array",
								items: { type: "string" },
							},
							reasoning: { type: "string" },
							matchingDocuments: {
								type: "array",
								items: { type: "string" },
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
			},
			required: ["analysis", "proposals"],
			additionalProperties: false,
		},
	);

	const rawProposals = collectRawCreateProposals(parsed);
	return {
		analysis: typeof parsed.analysis === "string" ? parsed.analysis : "",
		proposals: rawProposals
			.map((item, index) => tryNormalizeProposal(item, "create", index))
			.filter(
				(proposal): proposal is SchemaAssistantProposal => proposal !== null,
			),
	};
}

export async function assistSchemaEdit(
	currentSchema: ExtractionSchema,
	documents: AssistantDocumentInput[],
	prompt?: string,
): Promise<EditSchemaAssistResult> {
	const parsed = await createStructuredCompletion(
		`You are a schema design assistant. Improve an existing extraction schema while preserving the user's intent.

Rules:
- Always return valid JSON only.
- Return a single proposal with the full schema draft, not a patch.
- Keep the schema aligned to the same document type unless the user explicitly asks to repurpose it.
- classificationHints should help the classifier distinguish this schema from neighboring types.
- jsonSchema must stay a JSON object with type "object" and a properties object.
- Every schema property must include a description.`,
		`Refine the current schema using the supplied materials.

Current schema name: ${currentSchema.name}
Current description: ${currentSchema.description}
Current classification hints: ${currentSchema.classificationHints.join(", ")}
Current JSON Schema:
${JSON.stringify(currentSchema.jsonSchema, null, 2)}

${documents.length > 0 ? `Uploaded documents:\n${buildDocumentSummaries(documents)}` : "No documents were uploaded."}${buildPromptContext(prompt)}`,
		{
			type: "object",
			properties: {
				analysis: { type: "string" },
				proposal: {
					type: "object",
					properties: {
						name: { type: "string" },
						description: { type: "string" },
						jsonSchema: {
							type: "object",
							additionalProperties: true,
						},
						classificationHints: {
							type: "array",
							items: { type: "string" },
						},
						reasoning: { type: "string" },
						matchingDocuments: {
							type: "array",
							items: { type: "string" },
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
			required: ["analysis", "proposal"],
			additionalProperties: false,
		},
	);

	const { candidate, candidateShape } = collectRawEditProposal(parsed);
	const proposal = tryNormalizeProposal(
		candidate,
		"edit",
		0,
		{
			name: currentSchema.name,
			description: currentSchema.description,
			jsonSchema: currentSchema.jsonSchema as Record<string, unknown>,
			classificationHints: currentSchema.classificationHints,
		},
		{
			topLevelKeys: summarizeKeys(parsed),
			candidateShape,
		},
	);
	if (!proposal) {
		throw new SchemaAssistantOutputError(
			"AI returned an unusable schema revision. Please try again with more guidance or different files.",
		);
	}
	return {
		analysis: typeof parsed.analysis === "string" ? parsed.analysis : "",
		proposal,
		diff: computeSchemaDiff(
			{
				name: currentSchema.name,
				description: currentSchema.description,
				jsonSchema: currentSchema.jsonSchema as Record<string, unknown>,
				classificationHints: currentSchema.classificationHints,
			},
			proposal,
		),
	};
}
