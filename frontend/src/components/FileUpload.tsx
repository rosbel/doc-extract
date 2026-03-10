import { useCallback, useRef, useState } from "react";
import {
	api,
	type DocumentBatchUploadResponse,
	type DocumentBatchUploadResult,
} from "../api";
import {
	SelectedFilesReview,
	type SelectedUploadFile,
} from "./SelectedFilesReview";

interface Props {
	onUploaded: () => void | Promise<void>;
}

function buildSelectedUploadFile(id: string, file: File): SelectedUploadFile {
	return {
		id,
		file,
		status: "pending",
		error: null,
		existingDocumentId: undefined,
	};
}

function mapUploadResultToSelectedFile(
	result: DocumentBatchUploadResult,
): Pick<SelectedUploadFile, "status" | "error" | "existingDocumentId"> {
	switch (result.status) {
		case "accepted":
			return {
				status: "uploaded",
				error: null,
				existingDocumentId: undefined,
			};
		case "duplicate":
			return {
				status: "duplicate",
				error: null,
				existingDocumentId: result.existingDocumentId,
			};
		case "failed":
			return {
				status: "failed",
				error: result.error ?? "Upload failed",
				existingDocumentId: undefined,
			};
	}
}

export function FileUpload({ onUploaded }: Props) {
	const [dragging, setDragging] = useState(false);
	const [uploading, setUploading] = useState(false);
	const [selectedFiles, setSelectedFiles] = useState<SelectedUploadFile[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [lastResult, setLastResult] = useState<DocumentBatchUploadResponse | null>(
		null,
	);
	const fileInputRef = useRef<HTMLInputElement | null>(null);
	const nextIdRef = useRef(0);

	const stageFiles = useCallback((files: File[]) => {
		if (files.length === 0) return;

		setError(null);
		setLastResult(null);
		setSelectedFiles((current) => [
			...current,
			...files.map((file) => {
				const id = `selected-file-${nextIdRef.current}`;
				nextIdRef.current += 1;
				return buildSelectedUploadFile(id, file);
			}),
		]);

		if (fileInputRef.current) {
			fileInputRef.current.value = "";
		}
	}, []);

	const handleContinue = useCallback(async () => {
		const filesToUpload = selectedFiles.filter(
			(file) => file.status === "pending" || file.status === "failed",
		);
		if (filesToUpload.length === 0) {
			return;
		}

		setUploading(true);
		setError(null);
		setLastResult(null);

		const queuedIds = new Set(filesToUpload.map((file) => file.id));
		setSelectedFiles((current) =>
			current.map((file) =>
				queuedIds.has(file.id)
					? {
							...file,
							status: "uploading",
							error: null,
							existingDocumentId: undefined,
						}
					: file,
			),
		);

		try {
			const result = await api.documents.uploadBatch(
				filesToUpload.map((file) => file.file),
			);
			setLastResult(result);

			const mappedResults = new Map<
				string,
				Pick<
					SelectedUploadFile,
					"status" | "error" | "existingDocumentId"
				>
			>();

			for (const [index, selectedFile] of filesToUpload.entries()) {
				const uploadResult = result.results[index];
				if (!uploadResult) {
					mappedResults.set(selectedFile.id, {
						status: "failed",
						error: "Upload response was incomplete for this file.",
						existingDocumentId: undefined,
					});
					continue;
				}

				mappedResults.set(
					selectedFile.id,
					mapUploadResultToSelectedFile(uploadResult),
				);
			}

			setSelectedFiles((current) =>
				current.map((file) => {
					const mappedResult = mappedResults.get(file.id);
					return mappedResult ? { ...file, ...mappedResult } : file;
				}),
			);

			if (result.summary.accepted > 0) {
				await onUploaded();
			}
		} catch (err) {
			const errorMessage =
				err instanceof Error ? err.message : "Upload failed";
			setError(errorMessage);
			setSelectedFiles((current) =>
				current.map((file) =>
					queuedIds.has(file.id)
						? {
								...file,
								status: "pending",
								error: null,
								existingDocumentId: undefined,
							}
						: file,
				),
			);
		} finally {
			setUploading(false);
		}
	}, [onUploaded, selectedFiles]);

	const onDrop = useCallback(
		(e: React.DragEvent) => {
			e.preventDefault();
			setDragging(false);
			if (uploading) return;
			stageFiles(Array.from(e.dataTransfer.files));
		},
		[stageFiles, uploading],
	);

	return (
		<div className="space-y-4">
			<div
				onDragOver={(e) => {
					e.preventDefault();
					if (!uploading) {
						setDragging(true);
					}
				}}
				onDragLeave={() => setDragging(false)}
				onDrop={onDrop}
				className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
					dragging
						? "border-blue-500 bg-blue-50"
						: "border-gray-300 hover:border-gray-400"
				} ${uploading ? "opacity-70" : ""}`}
			>
				<input
					ref={fileInputRef}
					type="file"
					id="file-upload"
					multiple
					aria-label="Select documents"
					className="hidden"
					disabled={uploading}
					onChange={(e) => {
						stageFiles(Array.from(e.target.files ?? []));
					}}
				/>
				<label htmlFor="file-upload" className="cursor-pointer">
					<p className="text-gray-600">
						{uploading
							? "Uploading selected files..."
							: "Drag & drop files here, or click to select"}
					</p>
					<p className="mt-1 text-sm text-gray-400">
						PDF, DOCX, TXT, CSV, JSON, MD
					</p>
					<p className="mt-3 text-xs text-gray-500">
						Files are staged for review first. Nothing uploads until you press
						Continue.
					</p>
				</label>
			</div>

			{error && <p className="text-red-600 text-sm">{error}</p>}

			{selectedFiles.length > 0 && (
				<SelectedFilesReview
					files={selectedFiles}
					uploading={uploading}
					onContinue={handleContinue}
					onClear={() => {
						setSelectedFiles([]);
						setLastResult(null);
						setError(null);
					}}
					onRemove={(id) =>
						setSelectedFiles((current) =>
							current.filter((file) => file.id !== id),
						)
					}
					summary={lastResult?.summary ?? null}
				/>
			)}
		</div>
	);
}
