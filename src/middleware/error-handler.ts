import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { logger } from "../lib/logger.js";

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
