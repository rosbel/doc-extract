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
	await documentQueue.add("classify", { type: "classify", documentId }, {
		jobId: `classify-${documentId}`,
	});
}

export async function enqueueExtraction(
	documentId: string,
	schemaId: string,
) {
	await documentQueue.add(
		"extract",
		{ type: "extract", documentId, schemaId },
		{ jobId: `extract-${documentId}-${schemaId}` },
	);
}
