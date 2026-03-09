import { documentQueue } from "./index.js";

export interface ClassifyJobData {
	type: "classify";
	documentId: string;
}

export interface ExtractJobData {
	type: "extract";
	documentId: string;
	schemaId: string;
}

export type JobData = ClassifyJobData | ExtractJobData;

export async function enqueueClassification(documentId: string) {
	const jobId = `classify-${documentId}`;
	// Remove stale job from previous run (failed/completed) to avoid BullMQ dedup
	try {
		const existing = await documentQueue.getJob(jobId);
		if (existing) {
			const state = await existing.getState();
			if (state === "completed" || state === "failed") {
				await existing.remove();
			}
		}
	} catch {
		// Job may be locked (active); the add() will correctly return existing
	}
	await documentQueue.add("classify", { type: "classify", documentId }, { jobId });
}

export async function enqueueExtraction(
	documentId: string,
	schemaId: string,
) {
	const jobId = `extract-${documentId}-${schemaId}`;
	// Remove stale job from previous run (failed/completed) to avoid BullMQ dedup
	try {
		const existing = await documentQueue.getJob(jobId);
		if (existing) {
			const state = await existing.getState();
			if (state === "completed" || state === "failed") {
				await existing.remove();
			}
		}
	} catch {
		// Job may be locked (active); the add() will correctly return existing
	}
	await documentQueue.add(
		"extract",
		{ type: "extract", documentId, schemaId },
		{ jobId },
	);
}
