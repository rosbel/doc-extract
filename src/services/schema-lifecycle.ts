import { and, desc, eq } from "drizzle-orm";
import type { Database } from "../db/index.js";
import { extractionSchemas, schemaRevisions } from "../db/schema.js";
import type {
	ExtractionSchema,
	SchemaRevision,
} from "../types/index.js";

type DatabaseLike = Pick<Database, "insert" | "update" | "select" | "query">;

export interface SchemaRevisionMetadata {
	source?: "manual" | "ai" | "restore";
	summary?: string;
}

export interface SchemaDraftInput {
	name: string;
	description: string;
	jsonSchema: Record<string, unknown>;
	classificationHints?: string[];
	revision?: SchemaRevisionMetadata;
}

export interface SchemaUpdateInput extends Partial<SchemaDraftInput> {}

export async function createSchemaWithRevision(
	db: DatabaseLike,
	input: SchemaDraftInput,
) {
	const [schema] = await db
		.insert(extractionSchemas)
		.values({
			name: input.name,
			description: input.description,
			jsonSchema: input.jsonSchema,
			classificationHints: input.classificationHints ?? [],
		})
		.returning();

	const [revision] = await db
		.insert(schemaRevisions)
		.values({
			schemaId: schema.id,
			version: schema.version,
			name: schema.name,
			description: schema.description,
			jsonSchema: schema.jsonSchema,
			classificationHints: schema.classificationHints,
			source: input.revision?.source ?? "manual",
			summary: input.revision?.summary,
		})
		.returning();

	return { schema, revision };
}

export async function updateSchemaWithRevision(
	db: DatabaseLike,
	schemaId: string,
	input: SchemaUpdateInput,
) {
	const current = await db.query.extractionSchemas.findFirst({
		where: eq(extractionSchemas.id, schemaId),
	});
	if (!current) {
		return null;
	}

	const nextVersion = current.version + 1;
	const nextState = {
		name: input.name ?? current.name,
		description: input.description ?? current.description,
		jsonSchema: input.jsonSchema ?? (current.jsonSchema as Record<string, unknown>),
		classificationHints:
			input.classificationHints ?? current.classificationHints,
	};

	const [updated] = await db
		.update(extractionSchemas)
		.set({
			...nextState,
			version: nextVersion,
			updatedAt: new Date(),
		})
		.where(eq(extractionSchemas.id, schemaId))
		.returning();

	const [revision] = await db
		.insert(schemaRevisions)
		.values({
			schemaId,
			version: nextVersion,
			...nextState,
			source: input.revision?.source ?? "manual",
			summary: input.revision?.summary,
		})
		.returning();

	return { schema: updated, revision };
}

export async function listSchemaRevisions(
	db: DatabaseLike,
	schemaId: string,
): Promise<SchemaRevision[]> {
	return db
		.select()
		.from(schemaRevisions)
		.where(eq(schemaRevisions.schemaId, schemaId))
		.orderBy(desc(schemaRevisions.version));
}

export async function getSchemaRevision(
	db: DatabaseLike,
	schemaId: string,
	revisionId: string,
) {
	return db.query.schemaRevisions.findFirst({
		where: and(
			eq(schemaRevisions.id, revisionId),
			eq(schemaRevisions.schemaId, schemaId),
		),
	});
}

export async function getLatestSchemaRevision(
	db: DatabaseLike,
	schemaId: string,
) {
	return db.query.schemaRevisions.findFirst({
		where: eq(schemaRevisions.schemaId, schemaId),
		orderBy: (revisions, { desc: orderDesc }) => [orderDesc(revisions.version)],
	});
}

export async function restoreSchemaRevision(
	db: DatabaseLike,
	schemaId: string,
	revisionId: string,
) {
	const revision = await getSchemaRevision(db, schemaId, revisionId);
	if (!revision) {
		return null;
	}

	return updateSchemaWithRevision(db, schemaId, {
		name: revision.name,
		description: revision.description,
		jsonSchema: revision.jsonSchema as Record<string, unknown>,
		classificationHints: revision.classificationHints,
		revision: {
			source: "restore",
			summary: `Restored from version ${revision.version}`,
		},
	});
}

export function toSchemaDraft(schema: ExtractionSchema | SchemaRevision) {
	return {
		name: schema.name,
		description: schema.description,
		jsonSchema: schema.jsonSchema as Record<string, unknown>,
		classificationHints: schema.classificationHints,
	};
}
