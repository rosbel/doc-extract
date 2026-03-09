import { Router } from "express";
import { requireAdminAccess } from "../middleware/admin-auth.js";
import {
	clearPinecone,
	clearQueue,
	deleteAdminDocument,
	getAdminOverview,
	listAdminDocuments,
	pauseQueue,
	resetSystem,
	resumeQueue,
} from "../services/admin.js";
import {
	adminConfirmationInput,
	adminDocumentsQueryInput,
	adminQueueClearInput,
} from "../validation/schemas.js";

const DELETE_DOCUMENT_CONFIRMATION = "DELETE_DOCUMENT";
const CLEAR_QUEUE_CONFIRMATION = "CLEAR_QUEUE";
const CLEAR_PINECONE_CONFIRMATION = "CLEAR_PINECONE";
const RESET_SYSTEM_CONFIRMATION = "RESET_SYSTEM";

function requireConfirmation(value: string, expected: string) {
	if (value !== expected) {
		const error = new Error(`Confirmation must be ${expected}`) as Error & {
			status?: number;
		};
		error.status = 400;
		throw error;
	}
}

export const adminRouter = Router();

adminRouter.use(requireAdminAccess);

adminRouter.get("/overview", async (_req, res, next) => {
	try {
		res.json(await getAdminOverview());
	} catch (error) {
		next(error);
	}
});

adminRouter.get("/documents", async (req, res, next) => {
	try {
		const query = adminDocumentsQueryInput.parse(req.query);
		res.json(await listAdminDocuments(query));
	} catch (error) {
		next(error);
	}
});

adminRouter.delete("/documents/:id", async (req, res, next) => {
	try {
		const input = adminConfirmationInput.parse(req.body);
		requireConfirmation(input.confirmation, DELETE_DOCUMENT_CONFIRMATION);
		res.json(await deleteAdminDocument(req.params.id));
	} catch (error) {
		next(error);
	}
});

adminRouter.post("/queue/pause", async (_req, res, next) => {
	try {
		res.json(await pauseQueue());
	} catch (error) {
		next(error);
	}
});

adminRouter.post("/queue/resume", async (_req, res, next) => {
	try {
		res.json(await resumeQueue());
	} catch (error) {
		next(error);
	}
});

adminRouter.post("/queue/clear", async (req, res, next) => {
	try {
		const input = adminQueueClearInput.parse(req.body);
		requireConfirmation(input.confirmation, CLEAR_QUEUE_CONFIRMATION);
		res.json(await clearQueue(input.scope));
	} catch (error) {
		next(error);
	}
});

adminRouter.post("/pinecone/clear", async (req, res, next) => {
	try {
		const input = adminConfirmationInput.parse(req.body);
		requireConfirmation(input.confirmation, CLEAR_PINECONE_CONFIRMATION);
		res.json(await clearPinecone());
	} catch (error) {
		next(error);
	}
});

adminRouter.post("/reset", async (req, res, next) => {
	try {
		const input = adminConfirmationInput.parse(req.body);
		requireConfirmation(input.confirmation, RESET_SYSTEM_CONFIRMATION);
		res.json(await resetSystem());
	} catch (error) {
		next(error);
	}
});
