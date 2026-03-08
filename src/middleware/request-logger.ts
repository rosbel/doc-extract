import type { RequestHandler } from "express";
import { logger } from "../lib/logger.js";

export const requestLogger: RequestHandler = (req, _res, next) => {
	const start = Date.now();
	_res.on("finish", () => {
		logger.info("request", {
			method: req.method,
			url: req.originalUrl,
			status: _res.statusCode,
			duration: Date.now() - start,
		});
	});
	next();
};
