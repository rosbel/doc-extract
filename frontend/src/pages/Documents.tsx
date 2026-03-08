import { useCallback, useEffect, useState } from "react";
import { api, type Document } from "../api";
import { FileUpload } from "../components/FileUpload";
import { StatusBadge } from "../components/StatusBadge";

interface Props {
	onSelectDocument: (id: string) => void;
}

export function Documents({ onSelectDocument }: Props) {
	const [docs, setDocs] = useState<Document[]>([]);
	const [total, setTotal] = useState(0);
	const [page, setPage] = useState(1);
	const [loading, setLoading] = useState(true);

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const result = await api.documents.list({ page: String(page) });
			setDocs(result.documents);
			setTotal(result.total);
		} finally {
			setLoading(false);
		}
	}, [page]);

	useEffect(() => {
		load();
	}, [load]);

	// Poll for status updates on in-progress documents
	useEffect(() => {
		const inProgress = docs.filter((d) =>
			["pending", "classifying", "extracting"].includes(d.status),
		);
		if (inProgress.length === 0) return;

		const interval = setInterval(load, 3000);
		return () => clearInterval(interval);
	}, [docs, load]);

	return (
		<div className="space-y-6">
			<h1 className="text-2xl font-bold">Documents</h1>
			<FileUpload onUploaded={load} />

			{loading && docs.length === 0 ? (
				<p className="text-gray-500">Loading...</p>
			) : (
				<>
					<table className="min-w-full divide-y divide-gray-200">
						<thead className="bg-gray-50">
							<tr>
								<th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Filename</th>
								<th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
								<th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
								<th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Confidence</th>
								<th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Uploaded</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-gray-200 bg-white">
							{docs.map((doc) => (
								<tr
									key={doc.id}
									onClick={() => onSelectDocument(doc.id)}
									className="cursor-pointer hover:bg-gray-50"
								>
									<td className="px-4 py-3 text-sm font-medium">{doc.filename}</td>
									<td className="px-4 py-3 text-sm text-gray-500">{doc.mimeType}</td>
									<td className="px-4 py-3">
										<StatusBadge status={doc.status} />
									</td>
									<td className="px-4 py-3 text-sm text-gray-500">
										{doc.extractionConfidence != null
											? `${(doc.extractionConfidence * 100).toFixed(0)}%`
											: "-"}
									</td>
									<td className="px-4 py-3 text-sm text-gray-500">
										{new Date(doc.createdAt).toLocaleDateString()}
									</td>
								</tr>
							))}
						</tbody>
					</table>
					{total > 20 && (
						<div className="flex gap-2 justify-center">
							<button
								onClick={() => setPage((p) => Math.max(1, p - 1))}
								disabled={page === 1}
								className="px-3 py-1 border rounded disabled:opacity-50"
							>
								Previous
							</button>
							<span className="px-3 py-1 text-sm text-gray-600">
								Page {page} of {Math.ceil(total / 20)}
							</span>
							<button
								onClick={() => setPage((p) => p + 1)}
								disabled={page * 20 >= total}
								className="px-3 py-1 border rounded disabled:opacity-50"
							>
								Next
							</button>
						</div>
					)}
				</>
			)}
		</div>
	);
}
