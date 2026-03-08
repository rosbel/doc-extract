import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import type {
	documents,
	extractionSchemas,
	processingJobs,
} from "../db/schema.js";

export type ExtractionSchema = InferSelectModel<typeof extractionSchemas>;
export type NewExtractionSchema = InferInsertModel<typeof extractionSchemas>;

export type Document = InferSelectModel<typeof documents>;
export type NewDocument = InferInsertModel<typeof documents>;

export type ProcessingJob = InferSelectModel<typeof processingJobs>;
export type NewProcessingJob = InferInsertModel<typeof processingJobs>;

export type DocumentWithRelations = Document & {
	schema: ExtractionSchema | null;
	jobs: ProcessingJob[];
};
