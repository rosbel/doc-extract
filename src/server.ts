import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import { pathToFileURL } from "node:url";
import { config } from "./config.js";
import { logger } from "./lib/logger.js";
import { errorHandler } from "./middleware/error-handler.js";
import { requestLogger } from "./middleware/request-logger.js";
import { adminRouter } from "./routes/admin.js";
import { documentsRouter } from "./routes/documents.js";
import { schemasRouter } from "./routes/schemas.js";
import { searchRouter } from "./routes/search.js";

function isDocumentReadRequest(path: string, method: string) {
	return method === "GET" && path.startsWith("/documents");
}

export function createApp() {
	const app = express();

	app.use(cors());
	app.use(express.json());
	app.use(requestLogger);

	const apiLimiter = rateLimit({
		windowMs: config.rateLimit.apiWindowMs,
		limit: config.rateLimit.apiRequestsPerWindow,
		standardHeaders: "draft-7",
		legacyHeaders: false,
		message: { error: "Too many requests, please try again later" },
		skip: (req) => isDocumentReadRequest(req.path, req.method),
	});
	app.use("/api", apiLimiter);

	app.get("/health", (_req, res) => {
		res.json({ status: "ok", timestamp: new Date().toISOString() });
	});

	app.use("/api/admin", adminRouter);
	app.use("/api/schemas", schemasRouter);
	app.use("/api/documents", documentsRouter);
	app.use("/api/search", searchRouter);

	app.use(errorHandler);

	return app;
}

const app = createApp();

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	app.listen(config.port, () => {
		logger.info(`Server running on port ${config.port}`);
	});
}

export default app;
