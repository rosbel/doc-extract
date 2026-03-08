const SENSITIVE_FIELDS = new Set([
	"apiKey",
	"password",
	"secret",
	"token",
	"authorization",
]);

function redact(obj: Record<string, unknown>): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(obj)) {
		if (SENSITIVE_FIELDS.has(key.toLowerCase())) {
			result[key] = "[REDACTED]";
		} else if (typeof value === "object" && value !== null) {
			result[key] = redact(value as Record<string, unknown>);
		} else {
			result[key] = value;
		}
	}
	return result;
}

function formatMessage(
	level: string,
	message: string,
	meta?: Record<string, unknown>,
): string {
	const timestamp = new Date().toISOString();
	const base = { timestamp, level, message };
	const full = meta ? { ...base, ...redact(meta) } : base;
	return JSON.stringify(full);
}

export const logger = {
	info(message: string, meta?: Record<string, unknown>) {
		console.log(formatMessage("info", message, meta));
	},
	warn(message: string, meta?: Record<string, unknown>) {
		console.warn(formatMessage("warn", message, meta));
	},
	error(message: string, meta?: Record<string, unknown>) {
		console.error(formatMessage("error", message, meta));
	},
	debug(message: string, meta?: Record<string, unknown>) {
		if (process.env.NODE_ENV !== "production") {
			console.debug(formatMessage("debug", message, meta));
		}
	},
};
