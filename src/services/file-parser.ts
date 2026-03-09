import { readFile } from "node:fs/promises";
import mammoth from "mammoth";
import pdfParse from "pdf-parse";
import { logger } from "../lib/logger.js";

const PARSERS: Record<string, (buffer: Buffer) => Promise<string>> = {
	"application/pdf": parsePdf,
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document":
		parseDocx,
	"text/plain": parseText,
	"text/csv": parseText,
	"text/markdown": parseText,
	"application/json": parseJson,
};

async function parsePdf(buffer: Buffer): Promise<string> {
	const result = await pdfParse(buffer);
	return result.text;
}

async function parseDocx(buffer: Buffer): Promise<string> {
	const result = await mammoth.extractRawText({ buffer });
	return result.value;
}

async function parseText(buffer: Buffer): Promise<string> {
	return buffer.toString("utf-8");
}

async function parseJson(buffer: Buffer): Promise<string> {
	const data = JSON.parse(buffer.toString("utf-8"));
	return JSON.stringify(data, null, 2);
}

export async function parseFile(
	filePath: string,
	mimeType: string,
): Promise<string> {
	const parser = PARSERS[mimeType];
	if (!parser) {
		logger.warn("Unsupported file type, attempting plain text", { mimeType });
		const buffer = await readFile(filePath);
		return buffer.toString("utf-8");
	}
	const buffer = await readFile(filePath);
	return parser(buffer);
}

export function isSupportedMimeType(mimeType: string): boolean {
	return mimeType in PARSERS;
}

// --- Resilient parsing for recommendations ---

export interface FileParseResult {
	text: string;
	quality: "good" | "low" | "empty" | "failed";
	warning?: string;
}

export function assessTextQuality(
	text: string,
): Pick<FileParseResult, "quality" | "warning"> {
	if (!text || text.trim().length === 0) {
		return { quality: "empty", warning: "File produced no extractable text" };
	}
	if (text.trim().length < 20) {
		return {
			quality: "low",
			warning: "File produced very little text (less than 20 characters)",
		};
	}
	// Check for high ratio of non-printable characters
	const nonPrintable = text.replace(/[\x20-\x7E\t\n\r]/g, "").length;
	if (nonPrintable / text.length > 0.3) {
		return {
			quality: "low",
			warning:
				"File text contains a high ratio of non-printable characters — extraction may be unreliable",
		};
	}
	return { quality: "good" };
}

const PDF_PARSE_TIMEOUT_MS = 10_000;

async function parsePdfWithTimeout(buffer: Buffer): Promise<string> {
	const result = await Promise.race([
		pdfParse(buffer),
		new Promise<never>((_, reject) =>
			setTimeout(
				() => reject(new Error("PDF parsing timed out after 10s")),
				PDF_PARSE_TIMEOUT_MS,
			),
		),
	]);
	return result.text;
}

export async function parseFileSafe(
	filePath: string,
	mimeType: string,
): Promise<FileParseResult> {
	try {
		const buffer = await readFile(filePath);

		let text: string;
		if (mimeType === "application/pdf") {
			text = await parsePdfWithTimeout(buffer);
		} else {
			const parser = PARSERS[mimeType];
			text = parser ? await parser(buffer) : buffer.toString("utf-8");
		}

		const { quality, warning } = assessTextQuality(text);
		return { text, quality, warning };
	} catch (err) {
		const message =
			err instanceof Error ? err.message : "Unknown parsing error";
		logger.warn("File parsing failed", { filePath, mimeType, error: message });
		return {
			text: "",
			quality: "failed",
			warning: `Failed to parse file: ${message}`,
		};
	}
}
