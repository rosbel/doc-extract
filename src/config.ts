import "dotenv/config";

export const config = {
	port: Number(process.env.PORT) || 3001,
	nodeEnv: process.env.NODE_ENV || "development",
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
	},
} as const;
