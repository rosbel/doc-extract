import { relations } from "drizzle-orm";
import {
	documents,
	extractionSchemas,
	processingJobs,
	schemaRevisions,
} from "./schema.js";

export const extractionSchemasRelations = relations(
	extractionSchemas,
	({ many }) => ({
		documents: many(documents),
		revisions: many(schemaRevisions),
	}),
);

export const documentsRelations = relations(documents, ({ one, many }) => ({
	schema: one(extractionSchemas, {
		fields: [documents.schemaId],
		references: [extractionSchemas.id],
	}),
	schemaRevision: one(schemaRevisions, {
		fields: [documents.schemaRevisionId],
		references: [schemaRevisions.id],
	}),
	jobs: many(processingJobs),
}));

export const processingJobsRelations = relations(processingJobs, ({ one }) => ({
	document: one(documents, {
		fields: [processingJobs.documentId],
		references: [documents.id],
	}),
}));

export const schemaRevisionsRelations = relations(
	schemaRevisions,
	({ one, many }) => ({
		schema: one(extractionSchemas, {
			fields: [schemaRevisions.schemaId],
			references: [extractionSchemas.id],
		}),
		documents: many(documents),
	}),
);
