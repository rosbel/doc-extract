type UploadStatus =
	| "pending"
	| "uploading"
	| "uploaded"
	| "duplicate"
	| "failed";

export interface SelectedUploadFile {
	id: string;
	file: File;
	status: UploadStatus;
	error: string | null;
	existingDocumentId?: string;
}

interface Props {
	files: SelectedUploadFile[];
	uploading: boolean;
	onContinue: () => void | Promise<void>;
	onClear: () => void;
	onRemove: (id: string) => void;
	summary?: {
		accepted: number;
		duplicate: number;
		failed: number;
		total: number;
	} | null;
}

const STATUS_STYLES: Record<UploadStatus, string> = {
	pending: "bg-slate-100 text-slate-700",
	uploading: "bg-blue-100 text-blue-700",
	uploaded: "bg-emerald-100 text-emerald-700",
	duplicate: "bg-amber-100 text-amber-700",
	failed: "bg-rose-100 text-rose-700",
};

function formatBytes(bytes: number) {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function SelectedFilesReview({
	files,
	uploading,
	onContinue,
	onClear,
	onRemove,
	summary = null,
}: Props) {
	const hasQueuedFiles = files.some(
		(file) => file.status === "pending" || file.status === "failed",
	);
	const hasCompletedUploads = files.some(
		(file) =>
			file.status === "uploaded" ||
			file.status === "duplicate" ||
			file.status === "failed",
	);

	return (
		<section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
			<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
				<div>
					<h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
						Selected Files
					</h2>
					<p className="mt-1 text-sm text-slate-600">
						Review the exact filenames below, remove anything you do not want to
						upload, then continue when the set looks right.
					</p>
				</div>
				<div className="flex gap-2">
					<button
						type="button"
						onClick={onClear}
						disabled={uploading}
						className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
					>
						{hasCompletedUploads ? "Clear Review" : "Clear Selection"}
					</button>
					<button
						type="button"
						onClick={onContinue}
						disabled={uploading || !hasQueuedFiles}
						className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
					>
						{uploading ? "Uploading..." : "Continue"}
					</button>
				</div>
			</div>

			{summary && (
				<div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
					<p className="font-medium text-slate-900">
						Processed {summary.total} file{summary.total === 1 ? "" : "s"}
					</p>
					<p className="mt-1">
						Accepted: {summary.accepted} · Duplicates: {summary.duplicate} ·
						Failed: {summary.failed}
					</p>
				</div>
			)}

			<div className="mt-4 space-y-3">
				{files.map((selectedFile) => {
					const canRemove =
						!uploading &&
						selectedFile.status !== "uploading" &&
						selectedFile.status !== "uploaded";
					return (
						<div
							key={selectedFile.id}
							className="rounded-lg border border-slate-200 bg-slate-50 p-3"
						>
							<div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
								<div className="min-w-0">
									<p className="truncate text-sm font-medium text-slate-900">
										{selectedFile.file.name}
									</p>
									<div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-500">
										<span>{selectedFile.file.type || "Unknown type"}</span>
										<span>{formatBytes(selectedFile.file.size)}</span>
									</div>
									{selectedFile.status === "duplicate" &&
										selectedFile.existingDocumentId && (
											<p className="mt-2 text-sm text-amber-700">
												Duplicate of {selectedFile.existingDocumentId}
											</p>
										)}
									{selectedFile.error && (
										<p className="mt-2 text-sm text-rose-600">
											{selectedFile.error}
										</p>
									)}
								</div>
								<div className="flex items-center gap-2">
									<span
										className={`rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-wide ${
											STATUS_STYLES[selectedFile.status]
										}`}
									>
										{selectedFile.status}
									</span>
									{canRemove && (
										<button
											type="button"
											onClick={() => onRemove(selectedFile.id)}
											className="rounded-md border border-rose-200 px-3 py-1.5 text-sm font-medium text-rose-700 hover:bg-rose-50"
											aria-label={`Decline ${selectedFile.file.name}`}
										>
											Decline
										</button>
									)}
								</div>
							</div>
						</div>
					);
				})}
			</div>
		</section>
	);
}
