import "dotenv/config";

export const config = {
	port: Number(process.env.PORT) || 3001,
	nodeEnv: process.env.NODE_ENV || "development",
	rateLimit: {
		apiWindowMs: Number(process.env.API_RATE_LIMIT_WINDOW_MS) || 60 * 1000,
		apiRequestsPerWindow:
			Number(process.env.API_RATE_LIMIT_REQUESTS_PER_WINDOW) || 100,
		documentUploadWindowMs:
			Number(process.env.DOCUMENT_UPLOAD_RATE_LIMIT_WINDOW_MS) || 60 * 1000,
		documentUploadsPerWindow:
			Number(process.env.DOCUMENT_UPLOAD_RATE_LIMIT_REQUESTS_PER_WINDOW) || 20,
	},
	adminToken: process.env.ADMIN_TOKEN || "",
	adminSecurity: {
		maxFailedAttempts: Number(process.env.ADMIN_MAX_FAILED_ATTEMPTS) || 5,
		lockoutMs: Number(process.env.ADMIN_LOCKOUT_MS) || 15 * 60 * 1000,
		failureWindowMs:
			Number(process.env.ADMIN_FAILURE_WINDOW_MS) || 10 * 60 * 1000,
	},
	databaseUrl:
		process.env.DATABASE_URL ||
		"postgresql://postgres:postgres@localhost:5432/extraction_service",
	redisUrl: process.env.REDIS_URL || "redis://localhost:6379",
	openrouter: {
		apiKey: process.env.OPENROUTER_API_KEY || "",
		model: process.env.OPENROUTER_MODEL || "anthropic/claude-sonnet-4",
	},
	pinecone: {
		apiKey: process.env.PINECONE_API_KEY || "",
		index: process.env.PINECONE_INDEX || "document-extraction",
	},
	upload: {
		dir: process.env.UPLOAD_DIR || "./uploads",
		maxFileSize: Number(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024,
		maxFilesPerBatch: Number(process.env.MAX_FILES_PER_UPLOAD_BATCH) || 10,
	},
} as const;
