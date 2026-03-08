import { Queue } from "bullmq";
import { config } from "../config.js";

function parseRedisUrl(url: string) {
	const parsed = new URL(url);
	return {
		host: parsed.hostname,
		port: Number(parsed.port) || 6379,
		password: parsed.password || undefined,
		maxRetriesPerRequest: null,
	};
}

export const redisConnectionOpts = parseRedisUrl(config.redisUrl);

export const documentQueue = new Queue("document-processing", {
	connection: redisConnectionOpts,
	defaultJobOptions: {
		attempts: 3,
		backoff: {
			type: "exponential",
			delay: 5000,
		},
		removeOnComplete: { count: 1000 },
		removeOnFail: { count: 5000 },
	},
});
