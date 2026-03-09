import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import { config } from "./config.js";
import { logger } from "./lib/logger.js";
import { errorHandler } from "./middleware/error-handler.js";
import { requestLogger } from "./middleware/request-logger.js";
import { adminRouter } from "./routes/admin.js";
import { documentsRouter } from "./routes/documents.js";
import { schemasRouter } from "./routes/schemas.js";
import { searchRouter } from "./routes/search.js";

const app = express();

app.use(cors());
app.use(express.json());
app.use(requestLogger);

// HTTP-level rate limiting
const apiLimiter = rateLimit({
	windowMs: 60 * 1000,
	limit: 100,
	standardHeaders: "draft-7",
	legacyHeaders: false,
	message: { error: "Too many requests, please try again later" },
});
const uploadLimiter = rateLimit({
	windowMs: 60 * 1000,
	limit: 20,
	standardHeaders: "draft-7",
	legacyHeaders: false,
	message: { error: "Too many uploads, please try again later" },
});
app.use("/api", apiLimiter);

// Health check
app.get("/health", (_req, res) => {
	res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Routes
app.use("/api/admin", adminRouter);
app.use("/api/schemas", schemasRouter);
app.use("/api/documents", uploadLimiter, documentsRouter);
app.use("/api/search", searchRouter);

app.use(errorHandler);

app.listen(config.port, () => {
	logger.info(`Server running on port ${config.port}`);
});

export default app;
