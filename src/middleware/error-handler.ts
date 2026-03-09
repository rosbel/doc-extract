import type { ErrorRequestHandler } from "express";
import multer from "multer";
import { ZodError } from "zod";
import { logger } from "../lib/logger.js";

const malformedMultipartPatterns = [
	/unexpected end of form/i,
	/multipart/i,
	/boundary/i,
	/malformed/i,
	/request aborted/i,
	/request closed/i,
];

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
	if (err instanceof ZodError) {
		res.status(400).json({
			error: "Validation error",
			details: err.errors.map((e) => ({
				path: e.path.join("."),
				message: e.message,
			})),
		});
		return;
	}

	if (err instanceof multer.MulterError) {
		const status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
		res.status(status).json({ error: err.message });
		return;
	}

	if (
		err instanceof Error &&
		malformedMultipartPatterns.some((pattern) => pattern.test(err.message))
	) {
		res.status(400).json({ error: err.message });
		return;
	}

	const status = err.status || err.statusCode || 500;
	const message = err.message || "Internal server error";

	if (status >= 500) {
		logger.error("Unhandled error", {
			error: message,
			stack: err.stack,
		});
	}

	res.status(status).json({ error: message });
};
