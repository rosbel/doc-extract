import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import type {
	documents,
	extractionSchemas,
	processingJobs,
	schemaRevisions,
} from "../db/schema.js";

export type ExtractionSchema = InferSelectModel<typeof extractionSchemas>;
export type NewExtractionSchema = InferInsertModel<typeof extractionSchemas>;
export type SchemaRevision = InferSelectModel<typeof schemaRevisions>;
export type NewSchemaRevision = InferInsertModel<typeof schemaRevisions>;

export type Document = InferSelectModel<typeof documents>;
export type NewDocument = InferInsertModel<typeof documents>;

export type ProcessingJob = InferSelectModel<typeof processingJobs>;
export type NewProcessingJob = InferInsertModel<typeof processingJobs>;

export type DocumentWithRelations = Document & {
	schema: ExtractionSchema | null;
	schemaRevision: SchemaRevision | null;
	jobs: ProcessingJob[];
};

export type {
	AdminActionResult,
	AdminDocumentRow,
	AdminOverview,
	AdminQueueJobSummary,
	AdminQueueStatus,
	AdminServiceStatus,
} from "./admin.js";
