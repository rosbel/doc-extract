import { logger } from "./logger.js";

/**
 * Robustly parse LLM response content as JSON.
 * Handles cases where the model ignores response_format and wraps JSON in text.
 */
export function parseLLMResponse<T>(content: string): T {
	let parsed: unknown;

	// Happy path: response is valid JSON
	try {
		parsed = JSON.parse(content);
	} catch {
		// Try extracting JSON from surrounding text
		const firstBrace = content.indexOf("{");
		const lastBrace = content.lastIndexOf("}");

		if (firstBrace !== -1 && lastBrace > firstBrace) {
			const jsonCandidate = content.slice(firstBrace, lastBrace + 1);
			try {
				parsed = JSON.parse(jsonCandidate);
				logger.warn(
					"LLM returned JSON wrapped in text, extracted successfully",
				);
			} catch {
				// Fall through to error
			}
		}
	}

	if (parsed === undefined) {
		const preview = content.slice(0, 200);
		throw new Error(
			`Failed to parse LLM response as JSON. Response starts with: ${preview}`,
		);
	}

	logger.debug("Parsed LLM response", {
		type: typeof parsed,
		keys:
			typeof parsed === "object" && parsed !== null
				? Object.keys(parsed)
				: undefined,
	});

	return parsed as T;
}
