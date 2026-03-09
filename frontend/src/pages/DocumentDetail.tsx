import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, type DocumentDetail as DocumentDetailType } from "../api";
import { ProcessingStepper } from "../components/ProcessingStepper";
import { StatusBadge } from "../components/StatusBadge";

const PROCESSING_STATUSES = ["pending", "classifying", "extracting"];

export function DocumentDetail() {
	const navigate = useNavigate();
	const { documentId } = useParams();
	const [doc, setDoc] = useState<DocumentDetailType | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [reprocessing, setReprocessing] = useState(false);
	const [reprocessError, setReprocessError] = useState<string | null>(null);
	const [deleting, setDeleting] = useState(false);
	const [deleteError, setDeleteError] = useState<string | null>(null);

	const load = useCallback(async () => {
		if (!documentId) {
			setError("Document not found");
			setLoading(false);
			return;
		}

		setLoading(true);
		try {
			const data = await api.documents.get(documentId);
			setDoc(data);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to load");
		} finally {
			setLoading(false);
		}
	}, [documentId]);

	useEffect(() => {
		load();
	}, [load]);

	// SSE streaming: subscribe to status changes while document is processing
	const docStatus = doc?.status;

	useEffect(() => {
		if (!documentId || !docStatus || !PROCESSING_STATUSES.includes(docStatus)) {
			return;
		}

		const eventSource = api.documents.stream(documentId, (data) => {
			if (data.type === "status") {
				load();
			}
		});

		return () => eventSource.close();
	}, [docStatus, documentId, load]);

	const isInProcessingState = doc
		? PROCESSING_STATUSES.includes(doc.status)
		: false;

	// Stuck = in processing state but no jobs are actively running or pending
	const hasActiveJob = doc?.jobs?.some(
		(j) => j.status === "running" || j.status === "pending"
	) ?? false;
	const isStuck = isInProcessingState && doc !== null && doc.jobs.length > 0 && !hasActiveJob;
	const isProcessing = isInProcessingState && !isStuck;

	const handleReprocess = useCallback(async () => {
		if (reprocessing || !doc) return;
		setReprocessing(true);
		setReprocessError(null);
		try {
			await api.documents.reprocess(doc.id);
			await load();
		} catch (err) {
			setReprocessError(
				err instanceof Error ? err.message : "Failed to reprocess",
			);
		} finally {
			setReprocessing(false);
		}
	}, [reprocessing, doc, load]);

	const handleDelete = useCallback(async () => {
		if (deleting || !doc) return;
		if (!window.confirm(`Delete "${doc.filename}"? This cannot be undone.`)) return;
		setDeleting(true);
		setDeleteError(null);
		try {
			await api.documents.delete(doc.id);
			navigate("/documents");
		} catch (err) {
			setDeleteError(err instanceof Error ? err.message : "Failed to delete");
			setDeleting(false);
		}
	}, [deleting, doc, navigate]);

	if (loading && !doc) return <p className="text-gray-500">Loading...</p>;
	if (error) return <p className="text-red-600">{error}</p>;
	if (!doc) return null;

	return (
		<div className="space-y-6">
			<Link
				to="/documents"
				className="inline-flex items-center gap-2 text-sm font-medium text-sky-700 hover:text-sky-900"
			>
				<span aria-hidden="true">&larr;</span>
				Back to Documents
			</Link>

			<div className="flex justify-between items-start">
				<div>
					<h1 className="text-2xl font-bold">{doc.filename}</h1>
					<p className="text-sm text-gray-500 mt-1">
						{doc.mimeType} &middot; {(doc.fileSize / 1024).toFixed(1)} KB &middot;{" "}
						{new Date(doc.createdAt).toLocaleString()}
					</p>
				</div>
				<div className="flex items-center gap-3">
					<StatusBadge status={doc.status} />
					<button
						onClick={handleReprocess}
						disabled={reprocessing}
						className="rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
					>
						{reprocessing && (
							<span className="h-3.5 w-3.5 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
						)}
						{reprocessing ? "Reprocessing..." : "Reprocess"}
					</button>
					<button
						onClick={handleDelete}
						disabled={deleting}
						className="rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
					>
						{deleting && (
							<span className="h-3.5 w-3.5 border-2 border-red-400 border-t-transparent rounded-full animate-spin" />
						)}
						{deleting ? "Deleting..." : "Delete"}
					</button>
				</div>
			</div>

			<ProcessingStepper status={doc.status} isStuck={isStuck} />

			{reprocessError && (
				<div className="bg-red-50 rounded-lg border border-red-200 p-4 flex justify-between items-start">
					<div>
						<h2 className="font-semibold text-sm text-red-600 uppercase">Reprocess Error</h2>
						<p className="mt-1 text-sm text-red-700">{reprocessError}</p>
					</div>
					<button
						onClick={() => setReprocessError(null)}
						className="text-red-400 hover:text-red-600 text-lg leading-none"
					>
						&times;
					</button>
				</div>
			)}

			{deleteError && (
				<div className="bg-red-50 rounded-lg border border-red-200 p-4 flex justify-between items-start">
					<div>
						<h2 className="font-semibold text-sm text-red-600 uppercase">Delete Error</h2>
						<p className="mt-1 text-sm text-red-700">{deleteError}</p>
					</div>
					<button
						onClick={() => setDeleteError(null)}
						className="text-red-400 hover:text-red-600 text-lg leading-none"
					>
						&times;
					</button>
				</div>
			)}

			{doc.schema && (
				<div className="bg-white rounded-lg border p-4">
					<h2 className="font-semibold text-sm text-gray-500 uppercase">Matched Schema</h2>
					<p className="mt-1 font-medium">{doc.schema.name}</p>
					<p className="text-sm text-gray-600">{doc.schema.description}</p>
				</div>
			)}

			{doc.extractedData && (
				<div className="bg-white rounded-lg border p-4">
					<h2 className="font-semibold text-sm text-gray-500 uppercase mb-2">
						Extracted Data
						{doc.extractionConfidence != null && (
							<span className="ml-2 text-green-600">
								({(doc.extractionConfidence * 100).toFixed(0)}% confidence)
							</span>
						)}
					</h2>
					<pre className="text-sm bg-gray-50 p-4 rounded overflow-auto max-h-96">
						{JSON.stringify(doc.extractedData, null, 2)}
					</pre>
				</div>
			)}

			{doc.errorMessage && (
				<div className="bg-red-50 rounded-lg border border-red-200 p-4">
					<h2 className="font-semibold text-sm text-red-600 uppercase">Error</h2>
					<p className="mt-1 text-sm text-red-700">{doc.errorMessage}</p>
				</div>
			)}

			<details>
				<summary className="cursor-pointer text-sm text-gray-500">Raw Text</summary>
				<pre className="mt-2 text-xs bg-gray-50 p-4 rounded overflow-auto max-h-96 whitespace-pre-wrap">
					{doc.rawText || "No text extracted"}
				</pre>
			</details>

			{doc.jobs.length > 0 && (
				<div>
					<h2 className="font-semibold text-sm text-gray-500 uppercase mb-2">Processing History</h2>
					<table className="min-w-full divide-y divide-gray-200 text-sm">
						<thead className="bg-gray-50">
							<tr>
								<th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
								<th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
								<th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Attempt</th>
								<th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Started</th>
								<th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Error</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-gray-200 bg-white">
							{doc.jobs.map((job) => (
								<tr key={job.id}>
									<td className="px-3 py-2">{job.jobType}</td>
									<td className="px-3 py-2">
										<StatusBadge status={job.status} />
									</td>
									<td className="px-3 py-2">{job.attemptNumber}</td>
									<td className="px-3 py-2 text-gray-500">
										{job.startedAt ? new Date(job.startedAt).toLocaleString() : "-"}
									</td>
									<td className="px-3 py-2 text-red-600 text-xs">{job.errorMessage || "-"}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</div>
	);
}
