import { logger } from "../lib/logger.js";
import { createWorker } from "./workers.js";

const worker = createWorker();

logger.info("Worker started, waiting for jobs...");

process.on("SIGTERM", async () => {
	logger.info("Shutting down worker...");
	await worker.close();
	process.exit(0);
});

process.on("SIGINT", async () => {
	logger.info("Shutting down worker...");
	await worker.close();
	process.exit(0);
});
