import IORedis from "ioredis";
import { config } from "../config.js";

const HEARTBEAT_TTL_SECONDS = 60;

export const WORKER_HEARTBEAT_KEY = "document-processing:worker-heartbeat";
export const MAINTENANCE_MODE_KEY = "document-processing:maintenance";

export const redisClient = new IORedis(config.redisUrl, {
	maxRetriesPerRequest: null,
});

export async function writeWorkerHeartbeat(status: "online" | "stopped") {
	await redisClient.set(
		WORKER_HEARTBEAT_KEY,
		JSON.stringify({
			status,
			timestamp: new Date().toISOString(),
		}),
		"EX",
		HEARTBEAT_TTL_SECONDS,
	);
}

export async function readWorkerHeartbeat(): Promise<{
	status: "online" | "stopped";
	timestamp: string;
} | null> {
	const raw = await redisClient.get(WORKER_HEARTBEAT_KEY);
	if (!raw) return null;

	try {
		const parsed = JSON.parse(raw) as {
			status?: "online" | "stopped";
			timestamp?: string;
		};
		if (!parsed.status || !parsed.timestamp) return null;
		return {
			status: parsed.status,
			timestamp: parsed.timestamp,
		};
	} catch {
		return null;
	}
}

export async function setMaintenanceMode(enabled: boolean) {
	if (enabled) {
		await redisClient.set(
			MAINTENANCE_MODE_KEY,
			JSON.stringify({
				enabled: true,
				timestamp: new Date().toISOString(),
			}),
		);
		return;
	}

	await redisClient.del(MAINTENANCE_MODE_KEY);
}

export async function isMaintenanceModeEnabled() {
	return (await redisClient.exists(MAINTENANCE_MODE_KEY)) > 0;
}
