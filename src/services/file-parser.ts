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
