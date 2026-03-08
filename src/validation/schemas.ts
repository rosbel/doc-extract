import { z } from "zod";

export const createSchemaInput = z.object({
	name: z.string().min(1).max(255),
	description: z.string().min(1),
	jsonSchema: z.record(z.unknown()),
	classificationHints: z.array(z.string()).optional().default([]),
});

export const updateSchemaInput = z.object({
	name: z.string().min(1).max(255).optional(),
	description: z.string().min(1).optional(),
	jsonSchema: z.record(z.unknown()).optional(),
	classificationHints: z.array(z.string()).optional(),
});

export const documentQueryInput = z.object({
	status: z
		.enum([
			"pending",
			"classifying",
			"extracting",
			"completed",
			"failed",
			"duplicate",
		])
		.optional(),
	schemaId: z.string().uuid().optional(),
	page: z.coerce.number().int().min(1).optional().default(1),
	limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

export const searchInput = z.object({
	query: z.string().min(1),
	schemaId: z.string().uuid().optional(),
	mode: z.enum(["keyword", "semantic"]).optional().default("keyword"),
	limit: z.coerce.number().int().min(1).max(50).optional().default(10),
});
