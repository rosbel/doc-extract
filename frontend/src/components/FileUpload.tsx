import { useCallback, useState } from "react";
import { api, type DocumentBatchUploadResponse } from "../api";

export function FileUpload({ onUploaded }: { onUploaded: () => void }) {
	const [dragging, setDragging] = useState(false);
	const [uploading, setUploading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [lastResult, setLastResult] = useState<DocumentBatchUploadResponse | null>(
		null,
	);

	const handleFiles = useCallback(
		async (files: File[]) => {
			if (files.length === 0) return;
			setUploading(true);
			setError(null);
			setLastResult(null);
			try {
				const result = await api.documents.uploadBatch(files);
				setLastResult(result);
				onUploaded();
			} catch (err) {
				setError(err instanceof Error ? err.message : "Upload failed");
			} finally {
				setUploading(false);
			}
		},
		[onUploaded],
	);

	const onDrop = useCallback(
		(e: React.DragEvent) => {
			e.preventDefault();
			setDragging(false);
			const files = Array.from(e.dataTransfer.files);
			if (files.length > 0) {
				void handleFiles(files);
			}
		},
		[handleFiles],
	);

	return (
		<div
			onDragOver={(e) => {
				e.preventDefault();
				setDragging(true);
			}}
			onDragLeave={() => setDragging(false)}
			onDrop={onDrop}
			className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
				dragging ? "border-blue-500 bg-blue-50" : "border-gray-300 hover:border-gray-400"
			}`}
		>
			<input
				type="file"
				id="file-upload"
				multiple
				className="hidden"
				onChange={(e) => {
					const files = Array.from(e.target.files ?? []);
					if (files.length > 0) {
						void handleFiles(files);
					}
					e.target.value = "";
				}}
			/>
			<label htmlFor="file-upload" className="cursor-pointer">
				<p className="text-gray-600">
					{uploading
						? "Uploading files..."
						: "Drag & drop files here, or click to select"}
				</p>
				<p className="text-sm text-gray-400 mt-1">PDF, DOCX, TXT, CSV, JSON, MD</p>
			</label>
			{error && <p className="text-red-600 text-sm mt-2">{error}</p>}
			{lastResult && (
				<div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-left text-sm text-slate-700">
					<p className="font-medium text-slate-900">
						Processed {lastResult.summary.total} file
						{lastResult.summary.total === 1 ? "" : "s"}
					</p>
					<p className="mt-1 text-slate-600">
						Accepted: {lastResult.summary.accepted} · Duplicates:{" "}
						{lastResult.summary.duplicate} · Failed: {lastResult.summary.failed}
					</p>
					<ul className="mt-2 space-y-1">
						{lastResult.results
							.filter((result) => result.status !== "accepted")
							.map((result) => (
								<li key={`${result.filename}-${result.status}`}>
									{result.status === "duplicate"
										? `${result.filename}: duplicate${
												result.existingDocumentId
													? ` (${result.existingDocumentId})`
													: ""
											}`
										: `${result.filename}: ${result.error ?? "Upload failed"}`}
								</li>
							))}
					</ul>
				</div>
			)}
		</div>
	);
}
