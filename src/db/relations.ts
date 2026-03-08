import { relations } from "drizzle-orm";
import { documents, extractionSchemas, processingJobs } from "./schema.js";

export const extractionSchemasRelations = relations(
	extractionSchemas,
	({ many }) => ({
		documents: many(documents),
	}),
);

export const documentsRelations = relations(documents, ({ one, many }) => ({
	schema: one(extractionSchemas, {
		fields: [documents.schemaId],
		references: [extractionSchemas.id],
	}),
	jobs: many(processingJobs),
}));

export const processingJobsRelations = relations(processingJobs, ({ one }) => ({
	document: one(documents, {
		fields: [processingJobs.documentId],
		references: [documents.id],
	}),
}));
