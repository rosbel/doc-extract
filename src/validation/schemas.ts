import { z } from "zod";

export const schemaRevisionMetadataInput = z.object({
	source: z.enum(["manual", "ai", "restore"]).optional().default("manual"),
	summary: z.string().trim().max(500).optional(),
});

export const createSchemaInput = z.object({
	name: z.string().min(1).max(255),
	description: z.string().min(1),
	jsonSchema: z.record(z.unknown()),
	classificationHints: z.array(z.string()).optional().default([]),
	revision: schemaRevisionMetadataInput.optional(),
});

export const updateSchemaInput = z.object({
	name: z.string().min(1).max(255).optional(),
	description: z.string().min(1).optional(),
	jsonSchema: z.record(z.unknown()).optional(),
	classificationHints: z.array(z.string()).optional(),
	revision: schemaRevisionMetadataInput.optional(),
});

export const schemaAssistRequestInput = z
	.object({
		mode: z.enum(["create", "edit"]),
		prompt: z.string().trim().optional(),
		schemaId: z.string().uuid().optional(),
		hasFiles: z.boolean().optional().default(false),
	})
	.superRefine((value, ctx) => {
		if (value.mode === "edit" && !value.schemaId) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["schemaId"],
				message: "schemaId is required in edit mode",
			});
		}

		if (!value.prompt?.trim() && !value.hasFiles) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["prompt"],
				message: "Provide a prompt, files, or both",
			});
		}
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
