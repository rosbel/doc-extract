import {
	startTransition,
	useCallback,
	useEffect,
	useState,
	type FormEvent,
} from "react";
import {
	adminTokenStore,
	api,
	type AdminActionResult,
	type AdminDocumentRow,
	type AdminOverview,
} from "../api";

const DELETE_DOCUMENT_CONFIRMATION = "DELETE_DOCUMENT";
const CLEAR_QUEUE_CONFIRMATION = "CLEAR_QUEUE";
const CLEAR_PINECONE_CONFIRMATION = "CLEAR_PINECONE";
const RESET_SYSTEM_CONFIRMATION = "RESET_SYSTEM";
const PAGE_LIMIT = 20;
const SERVICE_GUIDES = [
	{
		name: "Pinecone",
		description:
			"Create an index, generate an API key, and set PINECONE_API_KEY plus PINECONE_INDEX in .env.",
		docsUrl: "https://docs.pinecone.io/guides/get-started/quickstart",
		consoleUrl: "https://app.pinecone.io/",
	},
	{
		name: "OpenRouter",
		description:
			"Create an API key, confirm your model access, and set OPENROUTER_API_KEY in .env.",
		docsUrl: "https://openrouter.ai/docs/quickstart",
		consoleUrl: "https://openrouter.ai/settings/keys",
	},
] as const;

function formatDate(value: string | null) {
	if (!value) return "-";
	return new Date(value).toLocaleString();
}

function getStatusClasses(status: string) {
	switch (status) {
		case "healthy":
		case "online":
		case "completed":
			return "bg-emerald-100 text-emerald-700";
		case "disabled":
			return "bg-slate-100 text-slate-600";
		case "stale":
		case "degraded":
		case "pending":
		case "classifying":
		case "extracting":
			return "bg-amber-100 text-amber-700";
		case "offline":
		case "failed":
			return "bg-rose-100 text-rose-700";
		default:
			return "bg-slate-100 text-slate-700";
	}
}

function statusBadge(status: string) {
	return (
		<span
			className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold uppercase tracking-wide ${getStatusClasses(
				status,
			)}`}
		>
			{status}
		</span>
	);
}

function buildActionSummary(result: AdminActionResult) {
	if (result.warnings.length === 0) return result.message;
	return `${result.message} Warnings: ${result.warnings.join(" | ")}`;
}

function MetricCard(props: {
	title: string;
	value: string;
	status?: string;
	detail: string;
}) {
	return (
		<div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
			<div className="flex items-center justify-between gap-3">
				<p className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">
					{props.title}
				</p>
				{props.status ? statusBadge(props.status) : null}
			</div>
			<p className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">
				{props.value}
			</p>
			<p className="mt-2 text-sm text-slate-600">{props.detail}</p>
		</div>
	);
}

export function Admin() {
	const [token, setToken] = useState(() => adminTokenStore.get());
	const [tokenInput, setTokenInput] = useState(() => adminTokenStore.get());
	const [overview, setOverview] = useState<AdminOverview | null>(null);
	const [documents, setDocuments] = useState<AdminDocumentRow[]>([]);
	const [page, setPage] = useState(1);
	const [total, setTotal] = useState(0);
	const [statusFilter, setStatusFilter] = useState("");
	const [loading, setLoading] = useState(false);
	const [documentsLoading, setDocumentsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [actionMessage, setActionMessage] = useState<string | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);
	const [resetConfirmation, setResetConfirmation] = useState("");

	const handleAdminError = useCallback((err: unknown) => {
		const resetToLockedState = (message: string) => {
			adminTokenStore.clear();
			setToken("");
			setTokenInput("");
			setOverview(null);
			setDocuments([]);
			setTotal(0);
			return message;
		};

		if (
			err &&
			typeof err === "object" &&
			"status" in err &&
			(err as { status?: number }).status === 401
		) {
			return resetToLockedState("Admin token rejected. Enter it again.");
		}

		if (
			err &&
			typeof err === "object" &&
			"status" in err &&
			(err as { status?: number }).status === 503
		) {
			return resetToLockedState(
				err instanceof Error ? err.message : "Admin console is disabled",
			);
		}

		return err instanceof Error ? err.message : "Admin request failed";
	}, []);

	const loadOverview = useCallback(async () => {
		if (!token) return;
		setLoading(true);
		setError(null);
		try {
			const result = await api.admin.overview();
			startTransition(() => {
				setOverview(result);
			});
		} catch (err) {
			setError(handleAdminError(err));
		} finally {
			setLoading(false);
		}
	}, [handleAdminError, token]);

	const loadDocuments = useCallback(async () => {
		if (!token) return;
		setDocumentsLoading(true);
		setError(null);
		try {
			const result = await api.admin.documents({
				page: String(page),
				limit: String(PAGE_LIMIT),
				...(statusFilter ? { status: statusFilter } : {}),
			});
			startTransition(() => {
				setDocuments(result.documents);
				setTotal(result.total);
			});
		} catch (err) {
			setError(handleAdminError(err));
		} finally {
			setDocumentsLoading(false);
		}
	}, [handleAdminError, page, statusFilter, token]);

	useEffect(() => {
		if (!token) return;
		void Promise.all([loadOverview(), loadDocuments()]);
	}, [loadDocuments, loadOverview, token]);

	const runAction = useCallback(
		async (
			action: () => Promise<AdminActionResult>,
			options?: { refreshOverview?: boolean; refreshDocuments?: boolean },
		) => {
			setActionMessage(null);
			setActionError(null);
			try {
				const result = await action();
				setActionMessage(buildActionSummary(result));
				await Promise.all([
					options?.refreshOverview === false ? Promise.resolve() : loadOverview(),
					options?.refreshDocuments ? loadDocuments() : Promise.resolve(),
				]);
			} catch (err) {
				setActionError(handleAdminError(err));
			}
		},
		[handleAdminError, loadDocuments, loadOverview],
	);

	const handleTokenSubmit = useCallback(
		(event: FormEvent<HTMLFormElement>) => {
			event.preventDefault();
			const trimmed = tokenInput.trim();
			if (!trimmed) return;
			adminTokenStore.set(trimmed);
			setToken(trimmed);
			setActionMessage(null);
			setActionError(null);
		},
		[tokenInput],
	);

	const handleLogout = useCallback(() => {
		adminTokenStore.clear();
		setToken("");
		setTokenInput("");
		setOverview(null);
		setDocuments([]);
		setActionMessage(null);
		setActionError(null);
		setError(null);
	}, []);

	const handleDeleteDocument = useCallback(
		(documentId: string) => {
			const confirmation = window.prompt(
				`Type ${DELETE_DOCUMENT_CONFIRMATION} to permanently delete this document.`,
			);
			if (confirmation !== DELETE_DOCUMENT_CONFIRMATION) return;
			void runAction(
				() => api.admin.deleteDocument(documentId, confirmation),
				{ refreshDocuments: true },
			);
		},
		[runAction],
	);

	const totalPages = Math.max(1, Math.ceil(total / PAGE_LIMIT));

	if (!token) {
		return (
			<section className="mx-auto max-w-2xl rounded-[28px] border border-slate-200 bg-white p-8 shadow-sm">
				<div className="space-y-3">
					<p className="text-sm font-semibold uppercase tracking-[0.24em] text-sky-700">
						Admin Console
					</p>
					<h1 className="text-3xl font-semibold tracking-tight text-slate-900">
						Protected operations dashboard
					</h1>
					<p className="text-sm leading-6 text-slate-600">
						Enter the shared admin token to inspect queue health, storage state,
						and destructive maintenance controls.
						</p>
					</div>

					{error ? (
						<div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
							{error}
						</div>
					) : null}

					<form className="mt-8 space-y-4" onSubmit={handleTokenSubmit}>
						<label className="block space-y-2">
							<span className="text-sm font-medium text-slate-700">
							Admin token
						</span>
						<input
							type="password"
							value={tokenInput}
							onChange={(event) => setTokenInput(event.target.value)}
							className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm shadow-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
						/>
					</label>
					<button
						type="submit"
						className="rounded-full bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-700"
					>
						Unlock Admin
					</button>
				</form>
			</section>
		);
	}

	const documentTotal = Object.values(overview?.postgres.documentCounts ?? {}).reduce(
		(sum, value) => sum + value,
		0,
	);
	const queueBacklog =
		(overview?.queue.counts.waiting ?? 0) + (overview?.queue.counts.delayed ?? 0);
	const failedJobs = overview?.postgres.jobCounts.failed ?? 0;

	return (
		<div className="space-y-8">
			<section className="rounded-[28px] border border-slate-200 bg-[linear-gradient(135deg,_rgba(14,165,233,0.08),_rgba(255,255,255,0.95)_35%,_rgba(15,23,42,0.03))] p-6 shadow-sm">
				<div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
					<div className="space-y-2">
						<p className="text-sm font-semibold uppercase tracking-[0.24em] text-sky-700">
							Admin Overview
						</p>
						<h1 className="text-3xl font-semibold tracking-tight text-slate-900">
							Operations console
						</h1>
						<p className="max-w-3xl text-sm leading-6 text-slate-600">
							Inspect system health across Postgres, Redis, BullMQ, Pinecone,
							uploads, and OpenRouter. Destructive actions require explicit
							confirmation and refresh only the affected panels.
						</p>
					</div>
					<div className="flex gap-3">
						<button
							type="button"
							onClick={() => void Promise.all([loadOverview(), loadDocuments()])}
							className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
						>
							Refresh
						</button>
						<button
							type="button"
							onClick={handleLogout}
							className="rounded-full border border-rose-200 px-4 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-50"
						>
							Log out
						</button>
					</div>
				</div>
			</section>

			{error ? (
				<div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
					{error}
				</div>
			) : null}
			{actionMessage ? (
				<div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
					{actionMessage}
				</div>
			) : null}
			{actionError ? (
				<div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
					{actionError}
				</div>
			) : null}

			<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
				<MetricCard
					title="Documents"
					value={String(documentTotal)}
					status={loading ? "pending" : "healthy"}
					detail={`${overview?.postgres.documentCounts.failed ?? 0} failed, ${overview?.postgres.documentCounts.completed ?? 0} completed`}
				/>
				<MetricCard
					title="Queue"
					value={String(queueBacklog)}
					status={
						overview?.queue.worker.status === "online"
							? overview.queue.paused
								? "stale"
								: "healthy"
							: overview?.queue.worker.status ?? "offline"
					}
					detail={`active ${overview?.queue.counts.active ?? 0}, failed ${failedJobs}, worker ${overview?.queue.worker.status ?? "offline"}`}
				/>
				<MetricCard
					title="Pinecone"
					value={String(overview?.pinecone.totalRecordCount ?? 0)}
					status={overview?.pinecone.status ?? "disabled"}
					detail={overview?.pinecone.message ?? "Pinecone status"}
				/>
				<MetricCard
					title="OpenRouter"
					value={overview?.openrouter.model ?? "-"}
					status={overview?.openrouter.status ?? "disabled"}
					detail={overview?.openrouter.message ?? "OpenRouter status"}
				/>
				<MetricCard
					title="Uploads"
					value={String(overview?.uploads.fileCount ?? 0)}
					status={overview?.uploads.exists === false ? "stale" : "healthy"}
					detail={`${overview?.uploads.totalBytes ?? 0} bytes in ${overview?.uploads.path ?? "-"}`}
				/>
				<MetricCard
					title="Maintenance"
					value={overview?.queue.maintenanceMode ? "ON" : "OFF"}
					status={overview?.queue.maintenanceMode ? "stale" : "healthy"}
					detail={
						overview?.queue.worker.lastHeartbeatAt
							? `last heartbeat ${formatDate(overview.queue.worker.lastHeartbeatAt)}`
							: "No worker heartbeat yet"
					}
				/>
			</div>

			<section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
				<div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
					<div>
						<p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">
							Service Setup
						</p>
						<h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-900">
							Third-party integrations
						</h2>
						<p className="mt-1 text-sm text-slate-600">
							Use these official guides when Pinecone or OpenRouter is missing,
							disabled, or returning errors.
						</p>
					</div>
				</div>

				<div className="mt-5 grid gap-4 md:grid-cols-2">
					{SERVICE_GUIDES.map((service) => {
						const status =
							service.name === "Pinecone"
								? overview?.pinecone.status ?? "disabled"
								: overview?.openrouter.status ?? "disabled";
						const configured =
							service.name === "Pinecone"
								? overview?.pinecone.configured ?? false
								: overview?.openrouter.configured ?? false;
						const message =
							service.name === "Pinecone"
								? overview?.pinecone.message
								: overview?.openrouter.message;

						return (
							<div
								key={service.name}
								className="rounded-[24px] border border-slate-200 bg-[linear-gradient(180deg,_rgba(248,250,252,0.9),_rgba(255,255,255,1))] p-5"
							>
								<div className="flex items-center justify-between gap-3">
									<h3 className="text-lg font-semibold text-slate-900">
										{service.name}
									</h3>
									{statusBadge(status)}
								</div>
								<p className="mt-3 text-sm leading-6 text-slate-600">
									{service.description}
								</p>
								<p className="mt-3 text-xs uppercase tracking-wide text-slate-500">
									{configured ? "Configured" : "Not configured"}
								</p>
								<p className="mt-1 text-sm text-slate-700">
									{message || "No provider status available yet."}
								</p>
								<div className="mt-4 flex flex-wrap gap-3">
									<a
										href={service.docsUrl}
										target="_blank"
										rel="noreferrer"
										className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700"
									>
										Open docs
									</a>
									<a
										href={service.consoleUrl}
										target="_blank"
										rel="noreferrer"
										className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
									>
										Open console
									</a>
								</div>
							</div>
						);
					})}
				</div>
			</section>

			<div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
				<section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
					<div className="flex items-center justify-between gap-3">
						<div>
							<h2 className="text-xl font-semibold tracking-tight text-slate-900">
								Recent issues
							</h2>
							<p className="mt-1 text-sm text-slate-600">
								Latest failed documents and processing jobs.
							</p>
						</div>
					</div>
					<div className="mt-6 grid gap-6 md:grid-cols-2">
						<div>
							<h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
								Failed documents
							</h3>
							<ul className="mt-3 space-y-3">
								{overview?.postgres.recentFailedDocuments.length ? (
									overview.postgres.recentFailedDocuments.map((doc) => (
										<li
											key={doc.id}
											className="rounded-2xl border border-rose-100 bg-rose-50/60 p-3"
										>
											<p className="text-sm font-semibold text-slate-900">
												{doc.filename}
											</p>
											<p className="mt-1 text-xs text-slate-600">
												{doc.errorMessage || "No error message"}
											</p>
											<p className="mt-2 text-xs text-slate-500">
												Updated {formatDate(doc.updatedAt)}
											</p>
										</li>
									))
								) : (
									<li className="text-sm text-slate-500">
										No failed documents.
									</li>
								)}
							</ul>
						</div>

						<div>
							<h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
								Failed jobs
							</h3>
							<ul className="mt-3 space-y-3">
								{overview?.postgres.recentFailedJobs.length ? (
									overview.postgres.recentFailedJobs.map((job) => (
										<li
											key={job.id}
											className="rounded-2xl border border-amber-100 bg-amber-50/70 p-3"
										>
											<div className="flex items-center justify-between gap-3">
												<p className="text-sm font-semibold text-slate-900">
													{job.jobType}
												</p>
												{statusBadge("failed")}
											</div>
											<p className="mt-1 text-xs text-slate-600">
												{job.errorMessage || "No error message"}
											</p>
											<p className="mt-2 text-xs text-slate-500">
												Document {job.documentId.slice(0, 8)} •{" "}
												{formatDate(job.completedAt || job.createdAt)}
											</p>
										</li>
									))
								) : (
									<li className="text-sm text-slate-500">No failed jobs.</li>
								)}
							</ul>
						</div>
					</div>
				</section>

				<section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
					<h2 className="text-xl font-semibold tracking-tight text-slate-900">
						Queue controls
					</h2>
					<p className="mt-1 text-sm text-slate-600">
						Pause processing, clear stale queue state, and inspect worker
						activity.
					</p>

					<div className="mt-5 flex flex-wrap gap-3">
						<button
							type="button"
							onClick={() => void runAction(() => api.admin.pauseQueue())}
							className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700"
						>
							Pause queue
						</button>
						<button
							type="button"
							onClick={() => void runAction(() => api.admin.resumeQueue())}
							className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
						>
							Resume queue
						</button>
						<button
							type="button"
							onClick={() => {
								const confirmation = window.prompt(
									`Type ${CLEAR_QUEUE_CONFIRMATION} to clear completed queue jobs.`,
								);
								if (confirmation !== CLEAR_QUEUE_CONFIRMATION) return;
								void runAction(() =>
									api.admin.clearQueue("completed", confirmation),
								);
							}}
							className="rounded-full border border-amber-300 px-4 py-2 text-sm font-semibold text-amber-700 transition hover:bg-amber-50"
						>
							Clear completed
						</button>
						<button
							type="button"
							onClick={() => {
								const confirmation = window.prompt(
									`Type ${CLEAR_QUEUE_CONFIRMATION} to clear failed queue jobs.`,
								);
								if (confirmation !== CLEAR_QUEUE_CONFIRMATION) return;
								void runAction(() =>
									api.admin.clearQueue("failed", confirmation),
								);
							}}
							className="rounded-full border border-amber-300 px-4 py-2 text-sm font-semibold text-amber-700 transition hover:bg-amber-50"
						>
							Clear failed
						</button>
						<button
							type="button"
							onClick={() => {
								const confirmation = window.prompt(
									`Type ${CLEAR_QUEUE_CONFIRMATION} to clear waiting and delayed queue jobs.`,
								);
								if (confirmation !== CLEAR_QUEUE_CONFIRMATION) return;
								void runAction(() =>
									api.admin.clearQueue("waiting_delayed", confirmation),
								);
							}}
							className="rounded-full border border-amber-300 px-4 py-2 text-sm font-semibold text-amber-700 transition hover:bg-amber-50"
						>
							Clear waiting/delayed
						</button>
					</div>

					<div className="mt-6 space-y-3">
						<div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
							<span className="text-sm font-medium text-slate-700">Worker</span>
							{statusBadge(overview?.queue.worker.status ?? "offline")}
						</div>
						<div className="rounded-2xl border border-slate-200 p-4">
							<p className="text-sm font-semibold text-slate-900">
								Recent BullMQ jobs
							</p>
							<ul className="mt-3 space-y-2 text-sm text-slate-600">
								{overview?.queue.recentJobs.length ? (
									overview.queue.recentJobs.map((job) => (
										<li
											key={job.id}
											className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2"
										>
											<span>
												{job.name} {job.documentId ? `• ${job.documentId.slice(0, 8)}` : ""}
											</span>
											{statusBadge(job.state)}
										</li>
									))
								) : (
									<li>No queue jobs recorded.</li>
								)}
							</ul>
						</div>
					</div>
				</section>
			</div>

			<section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
				<div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
					<div>
						<h2 className="text-xl font-semibold tracking-tight text-slate-900">
							Document inventory
						</h2>
						<p className="mt-1 text-sm text-slate-600">
							Inspect persisted files, retry state, and hard-delete individual
							documents.
						</p>
					</div>
					<label className="space-y-2 text-sm text-slate-700">
						<span className="font-medium">Status filter</span>
						<select
							value={statusFilter}
							onChange={(event) => {
								setPage(1);
								setStatusFilter(event.target.value);
							}}
							className="rounded-xl border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
						>
							<option value="">All statuses</option>
							<option value="pending">pending</option>
							<option value="classifying">classifying</option>
							<option value="extracting">extracting</option>
							<option value="completed">completed</option>
							<option value="failed">failed</option>
							<option value="duplicate">duplicate</option>
						</select>
					</label>
				</div>

				<div className="mt-6 overflow-x-auto">
					<table className="min-w-full divide-y divide-slate-200 text-left">
						<thead>
							<tr className="text-xs uppercase tracking-wide text-slate-500">
								<th className="px-3 py-3">Document</th>
								<th className="px-3 py-3">Schema</th>
								<th className="px-3 py-3">Status</th>
								<th className="px-3 py-3">Retry</th>
								<th className="px-3 py-3">Storage</th>
								<th className="px-3 py-3">Action</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-slate-100">
							{documents.length ? (
								documents.map((doc) => (
									<tr key={doc.id} className="align-top text-sm text-slate-700">
										<td className="px-3 py-4">
											<p className="font-semibold text-slate-900">
												{doc.filename}
											</p>
											<p className="mt-1 text-xs text-slate-500">
												{doc.errorMessage || formatDate(doc.updatedAt)}
											</p>
										</td>
										<td className="px-3 py-4">{doc.schemaName || "-"}</td>
										<td className="px-3 py-4">{statusBadge(doc.status)}</td>
										<td className="px-3 py-4">{doc.retryCount}</td>
										<td className="px-3 py-4">
											<span className="font-mono text-xs text-slate-500">
												{doc.storagePath}
											</span>
										</td>
										<td className="px-3 py-4">
											<button
												type="button"
												onClick={() => handleDeleteDocument(doc.id)}
												className="rounded-full border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-50"
											>
												Delete
											</button>
										</td>
									</tr>
								))
							) : (
								<tr>
									<td
										colSpan={6}
										className="px-3 py-6 text-center text-sm text-slate-500"
									>
										{documentsLoading ? "Loading documents..." : "No documents found."}
									</td>
								</tr>
							)}
						</tbody>
					</table>
				</div>

				<div className="mt-4 flex items-center justify-between text-sm text-slate-600">
					<span>
						Page {page} of {totalPages}
					</span>
					<div className="flex gap-2">
						<button
							type="button"
							onClick={() => setPage((current) => Math.max(1, current - 1))}
							disabled={page === 1}
							className="rounded-full border border-slate-300 px-3 py-1.5 font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
						>
							Previous
						</button>
						<button
							type="button"
							onClick={() =>
								setPage((current) => Math.min(totalPages, current + 1))
							}
							disabled={page >= totalPages}
							className="rounded-full border border-slate-300 px-3 py-1.5 font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
						>
							Next
						</button>
					</div>
				</div>
			</section>

			<div className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
				<section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
					<h2 className="text-xl font-semibold tracking-tight text-slate-900">
						Pinecone
					</h2>
					<p className="mt-1 text-sm text-slate-600">
						Index visibility and destructive vector cleanup.
					</p>
					<div className="mt-5 space-y-3 text-sm text-slate-700">
						<div className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3">
							<span>Index</span>
							<span className="font-semibold text-slate-900">
								{overview?.pinecone.index || "-"}
							</span>
						</div>
						<div className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3">
							<span>Status</span>
							{statusBadge(overview?.pinecone.status ?? "disabled")}
						</div>
						<div className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3">
							<span>Total records</span>
							<span className="font-semibold text-slate-900">
								{overview?.pinecone.totalRecordCount ?? 0}
							</span>
						</div>
					</div>
					<button
						type="button"
						onClick={() => {
							const confirmation = window.prompt(
								`Type ${CLEAR_PINECONE_CONFIRMATION} to clear the Pinecone index namespace.`,
							);
							if (confirmation !== CLEAR_PINECONE_CONFIRMATION) return;
							void runAction(() => api.admin.clearPinecone(confirmation));
						}}
						className="mt-5 rounded-full border border-amber-300 px-4 py-2 text-sm font-semibold text-amber-700 transition hover:bg-amber-50"
					>
						Clear Pinecone
					</button>
				</section>

				<section className="rounded-[28px] border border-rose-200 bg-[linear-gradient(180deg,_rgba(255,241,242,0.8),_rgba(255,255,255,1))] p-6 shadow-sm">
					<p className="text-sm font-semibold uppercase tracking-[0.2em] text-rose-700">
						Danger zone
					</p>
					<h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">
						Global reset
					</h2>
					<p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
						Reset removes documents, schemas, processing history, uploaded
						files, queue state, and Pinecone vectors. Active jobs block the
						reset until the queue becomes idle.
					</p>

					<form
						className="mt-6 flex flex-col gap-3 md:flex-row md:items-end"
						onSubmit={(event) => {
							event.preventDefault();
							if (resetConfirmation !== RESET_SYSTEM_CONFIRMATION) return;
							void runAction(
								() => api.admin.reset(resetConfirmation),
								{ refreshDocuments: true },
							);
							setResetConfirmation("");
						}}
					>
						<label className="flex-1 space-y-2">
							<span className="text-sm font-medium text-slate-700">
								Type {RESET_SYSTEM_CONFIRMATION} to confirm
							</span>
							<input
								value={resetConfirmation}
								onChange={(event) => setResetConfirmation(event.target.value)}
								className="w-full rounded-xl border border-rose-200 bg-white px-4 py-3 text-sm shadow-sm focus:border-rose-400 focus:outline-none focus:ring-2 focus:ring-rose-200"
							/>
						</label>
						<button
							type="submit"
							disabled={resetConfirmation !== RESET_SYSTEM_CONFIRMATION}
							className="rounded-full bg-rose-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-50"
						>
							Reset system
						</button>
					</form>
				</section>
			</div>
		</div>
	);
}
