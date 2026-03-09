type FlattenedField = {
	path: string;
	value: string;
};

type SearchCorpusInput = {
	filename: string;
	rawText?: string | null;
	extractedData?: unknown;
	schemaName?: string | null;
	schemaDescription?: string | null;
	schemaJsonSchema?: Record<string, unknown> | null;
};

export type SearchChunk = {
	idSuffix: string;
	chunkIndex: number;
	chunkType: "header" | "raw_text";
	text: string;
	preview: string;
};

const RAW_TEXT_CHUNK_SIZE = 1200;
const RAW_TEXT_CHUNK_OVERLAP = 200;
const PREVIEW_LENGTH = 220;

function normalizeWhitespace(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

function stringifyPrimitive(value: unknown): string {
	if (value == null) return "";
	if (typeof value === "string") return normalizeWhitespace(value);
	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}
	return "";
}

export function flattenExtractedData(
	value: unknown,
	path = "",
): FlattenedField[] {
	if (value == null) return [];

	if (
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean"
	) {
		const text = stringifyPrimitive(value);
		return text ? [{ path, value: text }] : [];
	}

	if (Array.isArray(value)) {
		return value.flatMap((item, index) =>
			flattenExtractedData(item, path ? `${path}[${index}]` : `[${index}]`),
		);
	}

	if (typeof value === "object") {
		return Object.entries(value as Record<string, unknown>).flatMap(
			([key, nestedValue]) =>
				flattenExtractedData(
					nestedValue,
					path ? `${path}.${key}` : key,
				),
		);
	}

	return [];
}

function collectSchemaFieldNames(
	schema: Record<string, unknown> | null | undefined,
	path = "",
): string[] {
	if (!schema || typeof schema !== "object") return [];

	const propertyEntries =
		"properties" in schema &&
		schema.properties &&
		typeof schema.properties === "object"
			? Object.entries(schema.properties as Record<string, unknown>)
			: [];

	const propertyPaths = propertyEntries.flatMap(([key, nested]) => {
		const nextPath = path ? `${path}.${key}` : key;
		return [nextPath, ...collectSchemaFieldNames(nested as Record<string, unknown>, nextPath)];
	});

	if ("items" in schema && schema.items && typeof schema.items === "object") {
		return [...propertyPaths, ...collectSchemaFieldNames(schema.items as Record<string, unknown>, `${path}[]`)];
	}

	return propertyPaths;
}

export function buildSearchCorpus(input: SearchCorpusInput): string {
	const sections: string[] = [`filename ${normalizeWhitespace(input.filename)}`];
	const flattenedFields = flattenExtractedData(input.extractedData ?? null);

	if (input.schemaName) {
		sections.push(`schema ${normalizeWhitespace(input.schemaName)}`);
	}

	if (input.schemaDescription) {
		sections.push(`schema description ${normalizeWhitespace(input.schemaDescription)}`);
	}

	const schemaFields = collectSchemaFieldNames(input.schemaJsonSchema ?? null);
	if (schemaFields.length > 0) {
		sections.push(`schema fields ${schemaFields.join(" ")}`);
	}

	if (flattenedFields.length > 0) {
		sections.push(
			flattenedFields.map(({ path, value }) => `${path} ${value}`).join(" "),
		);
	}

	if (input.rawText) {
		sections.push(normalizeWhitespace(input.rawText));
	}

	return normalizeWhitespace(sections.filter(Boolean).join("\n"));
}

function makePreview(text: string): string {
	return normalizeWhitespace(text).slice(0, PREVIEW_LENGTH);
}

export function buildSearchChunks(input: SearchCorpusInput): SearchChunk[] {
	const flattenedFields = flattenExtractedData(input.extractedData ?? null);
	const schemaFields = collectSchemaFieldNames(input.schemaJsonSchema ?? null);
	const headerParts = [
		`filename ${normalizeWhitespace(input.filename)}`,
		input.schemaName ? `schema ${normalizeWhitespace(input.schemaName)}` : "",
		input.schemaDescription
			? `schema description ${normalizeWhitespace(input.schemaDescription)}`
			: "",
		schemaFields.length > 0 ? `schema fields ${schemaFields.join(" ")}` : "",
		flattenedFields.length > 0
			? flattenedFields
					.map(({ path, value }) => `${path} ${value}`)
					.join(" ")
			: "",
	];

	const chunks: SearchChunk[] = [];
	const headerText = normalizeWhitespace(headerParts.filter(Boolean).join("\n"));

	if (headerText) {
		chunks.push({
			idSuffix: "header",
			chunkIndex: 0,
			chunkType: "header",
			text: headerText,
			preview: makePreview(headerText),
		});
	}

	const rawText = normalizeWhitespace(input.rawText ?? "");
	if (!rawText) {
		return chunks;
	}

	for (
		let start = 0, chunkIndex = 0;
		start < rawText.length;
		start += RAW_TEXT_CHUNK_SIZE - RAW_TEXT_CHUNK_OVERLAP, chunkIndex += 1
	) {
		const text = rawText.slice(start, start + RAW_TEXT_CHUNK_SIZE);
		if (!text) break;
		chunks.push({
			idSuffix: `raw-${chunkIndex}`,
			chunkIndex,
			chunkType: "raw_text",
			text,
			preview: makePreview(text),
		});
		if (start + RAW_TEXT_CHUNK_SIZE >= rawText.length) {
			break;
		}
	}

	return chunks;
}

export function buildSemanticQueryText(
	query: string,
	schema?: {
		name?: string | null;
		jsonSchema?: Record<string, unknown> | null;
	},
): string {
	if (!schema?.name && !schema?.jsonSchema) {
		return normalizeWhitespace(query);
	}

	const fieldNames = collectSchemaFieldNames(schema.jsonSchema ?? null);
	return normalizeWhitespace(
		[
			schema.name ? `schema ${schema.name}` : "",
			fieldNames.length > 0 ? `fields ${fieldNames.join(" ")}` : "",
			`query ${query}`,
		]
			.filter(Boolean)
			.join("\n"),
	);
}

export function extractMatchedFields(
	extractedData: unknown,
	query: string,
): string[] {
	const normalizedQuery = query.trim().toLowerCase();
	if (!normalizedQuery || !extractedData) return [];

	return flattenExtractedData(extractedData)
		.filter(
			({ path, value }) =>
				path.toLowerCase().includes(normalizedQuery) ||
				value.toLowerCase().includes(normalizedQuery),
		)
		.map(({ path }) => path)
		.filter((value, index, values) => values.indexOf(value) === index)
		.slice(0, 5);
}

export function findSnippet(text: string, query: string): string {
	const normalizedText = normalizeWhitespace(text);
	const normalizedQuery = normalizeWhitespace(query).toLowerCase();

	if (!normalizedText) return "No preview available";
	if (!normalizedQuery) return normalizedText.slice(0, PREVIEW_LENGTH);

	const matchIndex = normalizedText.toLowerCase().indexOf(normalizedQuery);
	if (matchIndex === -1) {
		return normalizedText.slice(0, PREVIEW_LENGTH);
	}

	const start = Math.max(0, matchIndex - 60);
	const end = Math.min(normalizedText.length, matchIndex + normalizedQuery.length + 120);
	return normalizedText.slice(start, end);
}
