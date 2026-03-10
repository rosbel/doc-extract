import { logger } from "../lib/logger.js";
import { writeWorkerHeartbeat } from "./redis.js";
import { createWorker } from "./workers.js";

const worker = createWorker();
let heartbeatTimer: NodeJS.Timeout | null = null;

logger.info("Worker started, waiting for jobs...");
void writeWorkerHeartbeat("online");
heartbeatTimer = setInterval(() => {
	void writeWorkerHeartbeat("online");
}, 15_000);

process.on("SIGTERM", async () => {
	logger.info("Shutting down worker...");
	if (heartbeatTimer) clearInterval(heartbeatTimer);
	await writeWorkerHeartbeat("stopped");
	await worker.close();
	process.exit(0);
});

process.on("SIGINT", async () => {
	logger.info("Shutting down worker...");
	if (heartbeatTimer) clearInterval(heartbeatTimer);
	await writeWorkerHeartbeat("stopped");
	await worker.close();
	process.exit(0);
});
