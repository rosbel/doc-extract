import type { RequestHandler } from "express";
import { config } from "../config.js";

type AdminAttemptState = {
	failedCount: number;
	firstFailedAt: number;
	lockedUntil: number;
};

const adminAttempts = new Map<string, AdminAttemptState>();

function getClientKey(req: Parameters<RequestHandler>[0]) {
	const forwardedFor = req.header("x-forwarded-for");
	if (forwardedFor) {
		return forwardedFor.split(",")[0]?.trim() || "unknown";
	}
	return req.ip || req.socket.remoteAddress || "unknown";
}

function clearExpiredAttempts(now: number) {
	for (const [key, state] of adminAttempts.entries()) {
		if (
			state.lockedUntil <= now &&
			now - state.firstFailedAt > config.adminSecurity.failureWindowMs
		) {
			adminAttempts.delete(key);
		}
	}
}

function registerFailedAttempt(clientKey: string, now: number) {
	const existing = adminAttempts.get(clientKey);
	if (
		!existing ||
		now - existing.firstFailedAt > config.adminSecurity.failureWindowMs
	) {
		const nextState: AdminAttemptState = {
			failedCount: 1,
			firstFailedAt: now,
			lockedUntil: 0,
		};
		adminAttempts.set(clientKey, nextState);
		return nextState;
	}

	existing.failedCount += 1;
	if (existing.failedCount >= config.adminSecurity.maxFailedAttempts) {
		existing.lockedUntil = now + config.adminSecurity.lockoutMs;
	}
	adminAttempts.set(clientKey, existing);
	return existing;
}

export function resetAdminSecurityState() {
	adminAttempts.clear();
}

export const requireAdminAccess: RequestHandler = (req, res, next) => {
	const now = Date.now();
	const clientKey = getClientKey(req);
	clearExpiredAttempts(now);

	if (!config.adminToken) {
		res.status(503).json({
			error: "Admin console is disabled",
			disabled: true,
		});
		return;
	}

	const existing = adminAttempts.get(clientKey);
	if (existing && existing.lockedUntil > now) {
		const retryAfterSeconds = Math.ceil((existing.lockedUntil - now) / 1000);
		res.setHeader("Retry-After", String(retryAfterSeconds));
		res.status(429).json({
			error: "Too many invalid admin token attempts. Try again later.",
			retryAfterSeconds,
		});
		return;
	}

	const token = req.header("x-admin-token");
	if (!token || token !== config.adminToken) {
		const updated = registerFailedAttempt(clientKey, now);
		if (updated.lockedUntil > now) {
			const retryAfterSeconds = Math.ceil((updated.lockedUntil - now) / 1000);
			res.setHeader("Retry-After", String(retryAfterSeconds));
			res.status(429).json({
				error: "Too many invalid admin token attempts. Try again later.",
				retryAfterSeconds,
			});
			return;
		}

		res.status(401).json({ error: "Unauthorized" });
		return;
	}

	adminAttempts.delete(clientKey);
	next();
};
