import { sql } from "drizzle-orm";
import {
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	real,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";

export const schemaStatusEnum = pgEnum("schema_status", ["active", "archived"]);
export const schemaRevisionSourceEnum = pgEnum("schema_revision_source", [
	"manual",
	"ai",
	"restore",
]);

export const documentStatusEnum = pgEnum("document_status", [
	"pending",
	"classifying",
	"extracting",
	"completed",
	"failed",
	"duplicate",
]);

export const jobTypeEnum = pgEnum("job_type", ["classification", "extraction"]);

export const jobStatusEnum = pgEnum("job_status", [
	"pending",
	"running",
	"completed",
	"failed",
]);

export const extractionSchemas = pgTable("extraction_schemas", {
	id: uuid("id").defaultRandom().primaryKey(),
	name: text("name").notNull(),
	description: text("description").notNull(),
	version: integer("version").notNull().default(1),
	jsonSchema: jsonb("json_schema").notNull(),
	classificationHints: text("classification_hints")
		.array()
		.notNull()
		.default([]),
	status: schemaStatusEnum("status").notNull().default("active"),
	createdAt: timestamp("created_at").defaultNow().notNull(),
	updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const schemaRevisions = pgTable("schema_revisions", {
	id: uuid("id").defaultRandom().primaryKey(),
	schemaId: uuid("schema_id")
		.references(() => extractionSchemas.id, { onDelete: "cascade" })
		.notNull(),
	version: integer("version").notNull(),
	name: text("name").notNull(),
	description: text("description").notNull(),
	jsonSchema: jsonb("json_schema").notNull(),
	classificationHints: text("classification_hints")
		.array()
		.notNull()
		.default([]),
	source: schemaRevisionSourceEnum("source").notNull().default("manual"),
	summary: text("summary"),
	createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const documents = pgTable(
	"documents",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		filename: text("filename").notNull(),
		mimeType: text("mime_type").notNull(),
		fileSize: integer("file_size").notNull(),
		contentHash: text("content_hash").notNull(),
		rawText: text("raw_text"),
		searchText: text("search_text"),
		storagePath: text("storage_path").notNull(),
		status: documentStatusEnum("status").notNull().default("pending"),
		schemaId: uuid("schema_id").references(() => extractionSchemas.id),
		schemaVersion: integer("schema_version"),
		schemaRevisionId: uuid("schema_revision_id").references(
			() => schemaRevisions.id,
		),
		extractedData: jsonb("extracted_data"),
		extractionConfidence: real("extraction_confidence"),
		errorMessage: text("error_message"),
		retryCount: integer("retry_count").notNull().default(0),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at").defaultNow().notNull(),
	},
	(table) => [
		uniqueIndex("content_hash_idx").on(table.contentHash),
		index("documents_search_text_tsv_idx").using(
			"gin",
			sql`to_tsvector('english', coalesce(${table.searchText}, ''))`,
		),
	],
);

export const processingJobs = pgTable("processing_jobs", {
	id: uuid("id").defaultRandom().primaryKey(),
	documentId: uuid("document_id")
		.references(() => documents.id, { onDelete: "cascade" })
		.notNull(),
	jobType: jobTypeEnum("job_type").notNull(),
	status: jobStatusEnum("status").notNull().default("pending"),
	attemptNumber: integer("attempt_number").notNull().default(1),
	errorMessage: text("error_message"),
	metadata: jsonb("metadata"),
	startedAt: timestamp("started_at"),
	completedAt: timestamp("completed_at"),
	createdAt: timestamp("created_at").defaultNow().notNull(),
});
