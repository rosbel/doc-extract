import { useCallback, useState } from "react";
import { api } from "../api";

export function FileUpload({ onUploaded }: { onUploaded: () => void }) {
	const [dragging, setDragging] = useState(false);
	const [uploading, setUploading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const handleFile = useCallback(
		async (file: File) => {
			setUploading(true);
			setError(null);
			try {
				await api.documents.upload(file);
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
			const file = e.dataTransfer.files[0];
			if (file) handleFile(file);
		},
		[handleFile],
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
				className="hidden"
				onChange={(e) => {
					const file = e.target.files?.[0];
					if (file) handleFile(file);
				}}
			/>
			<label htmlFor="file-upload" className="cursor-pointer">
				<p className="text-gray-600">
					{uploading ? "Uploading..." : "Drag & drop a file here, or click to select"}
				</p>
				<p className="text-sm text-gray-400 mt-1">PDF, DOCX, TXT, CSV, JSON, MD</p>
			</label>
			{error && <p className="text-red-600 text-sm mt-2">{error}</p>}
		</div>
	);
}
