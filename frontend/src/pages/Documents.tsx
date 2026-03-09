import {
	startTransition,
	useCallback,
	useEffect,
	useRef,
	useState,
	type FormEvent,
} from "react";
import { useNavigate } from "react-router-dom";
import {
	api,
	type Document,
	type KeywordSearchResult,
	type Schema,
	type SearchMode,
	type SearchResponse,
	type SemanticSearchResult,
} from "../api";
import { FileUpload } from "../components/FileUpload";
import { StatusBadge } from "../components/StatusBadge";

const PROCESSING_STATUSES = ["pending", "classifying", "extracting"];
const SEARCH_LIMIT = 10;

function formatConfidence(value: number | null) {
	return value != null ? `${(value * 100).toFixed(0)}%` : "-";
}

function formatSchemaLabel(schemaId: string | null, schemas: Schema[]) {
	if (!schemaId) return "-";
	const schema = schemas.find((item) => item.id === schemaId);
	return schema ? `${schema.name} (${schemaId.slice(0, 8)})` : schemaId;
}

export function Documents() {
	const navigate = useNavigate();
	const [docs, setDocs] = useState<Document[]>([]);
	const [schemas, setSchemas] = useState<Schema[]>([]);
	const [total, setTotal] = useState(0);
	const [page, setPage] = useState(1);
	const [loading, setLoading] = useState(true);
	const [searchLoading, setSearchLoading] = useState(false);
	const [searchError, setSearchError] = useState<string | null>(null);
	const [searchQuery, setSearchQuery] = useState("");
	const [submittedQuery, setSubmittedQuery] = useState("");
	const [searchMode, setSearchMode] = useState<SearchMode>("keyword");
	const [selectedSchemaId, setSelectedSchemaId] = useState("");
	const [searchResponse, setSearchResponse] = useState<SearchResponse | null>(null);
	const docsRef = useRef(docs);
	docsRef.current = docs;

	const handleSelectDocument = useCallback(
		(id: string) => {
			navigate(`/documents/${id}`);
		},
		[navigate],
	);

	const loadDocuments = useCallback(async () => {
		setLoading(true);
		try {
			const result = await api.documents.list({ page: String(page) });
			setDocs(result.documents);
			setTotal(result.total);
		} finally {
			setLoading(false);
		}
	}, [page]);

	const loadSchemas = useCallback(async () => {
		const result = await api.schemas.list();
		setSchemas(result);
	}, []);

	useEffect(() => {
		void loadDocuments();
	}, [loadDocuments]);

	useEffect(() => {
		void loadSchemas();
	}, [loadSchemas]);

	const pollStatuses = useCallback(async () => {
		const currentDocs = docsRef.current;
		const inProgress = currentDocs.filter((d) =>
			PROCESSING_STATUSES.includes(d.status),
		);
		if (inProgress.length === 0) return;

		const statuses = await Promise.all(
			inProgress.map((d) => api.documents.status(d.id)),
		);

		let needsFullReload = false;
		setDocs((prev) =>
			prev.map((doc) => {
				const updated = statuses.find((s) => s.id === doc.id);
				if (!updated) return doc;
				if (updated.status !== doc.status) {
					if (!PROCESSING_STATUSES.includes(updated.status)) {
						needsFullReload = true;
					}
					return {
						...doc,
						status: updated.status,
						extractionConfidence: updated.extractionConfidence,
						errorMessage: updated.errorMessage,
					};
				}
				return doc;
			}),
		);

		if (needsFullReload) {
			void loadDocuments();
		}
	}, [loadDocuments]);

	useEffect(() => {
		const inProgress = docs.filter((d) =>
			PROCESSING_STATUSES.includes(d.status),
		);
		if (inProgress.length === 0) return;

		const interval = setInterval(() => {
			void pollStatuses();
		}, 3000);
		return () => clearInterval(interval);
	}, [docs, pollStatuses]);

	const handleSearch = useCallback(
		async (event: FormEvent<HTMLFormElement>) => {
			event.preventDefault();
			const query = searchQuery.trim();
			if (!query) {
				return;
			}

			setSearchLoading(true);
			setSearchError(null);

			try {
				const response = await api.search({
					query,
					mode: searchMode,
					limit: SEARCH_LIMIT,
					...(selectedSchemaId ? { schemaId: selectedSchemaId } : {}),
				});

				startTransition(() => {
					setSubmittedQuery(query);
					setSearchResponse(response);
				});
			} catch (err) {
				setSearchError(
					err instanceof Error ? err.message : "Search failed",
				);
				startTransition(() => {
					setSubmittedQuery(query);
					setSearchResponse(null);
				});
			} finally {
				setSearchLoading(false);
			}
		},
		[searchMode, searchQuery, selectedSchemaId],
	);

	const handleClearSearch = useCallback(() => {
		setSearchQuery("");
		setSubmittedQuery("");
		setSearchMode("keyword");
		setSelectedSchemaId("");
		setSearchError(null);
		setSearchResponse(null);
	}, []);

	const isSearchActive = submittedQuery.length > 0;
	const keywordResults =
		searchResponse?.mode === "keyword" ? searchResponse.results : [];
	const semanticResults =
		searchResponse?.mode === "semantic" ? searchResponse.results : [];

	return (
		<div className="space-y-6">
			<h1 className="text-2xl font-bold">Documents</h1>
			<FileUpload onUploaded={loadDocuments} />

			<section className="rounded-lg border bg-white p-4 shadow-sm space-y-4">
				<div>
					<h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
						Search Documents
					</h2>
					<p className="mt-1 text-sm text-gray-600">
						Search extracted documents by keyword or semantic similarity without
						leaving the Documents page.
					</p>
				</div>

				<form onSubmit={handleSearch} className="space-y-4">
					<div className="grid gap-4 md:grid-cols-[minmax(0,2fr)_auto]">
						<label className="space-y-1">
							<span className="text-sm font-medium text-gray-700">Query</span>
							<input
								value={searchQuery}
								onChange={(event) => setSearchQuery(event.target.value)}
								placeholder="Search invoices, vendors, totals, resumes..."
								className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
							/>
						</label>
						<label className="space-y-1">
							<span className="text-sm font-medium text-gray-700">Schema</span>
							<select
								value={selectedSchemaId}
								onChange={(event) => setSelectedSchemaId(event.target.value)}
								className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
							>
								<option value="">All schemas</option>
								{schemas.map((schema) => (
									<option key={schema.id} value={schema.id}>
										{schema.name}
									</option>
								))}
							</select>
						</label>
					</div>

					<div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
						<div className="space-y-2">
							<div className="text-sm font-medium text-gray-700">Mode</div>
							<div
								className="inline-flex rounded-md border border-gray-300 bg-gray-50 p-1"
								role="group"
								aria-label="Search mode"
							>
								<button
									type="button"
									onClick={() => setSearchMode("keyword")}
									className={`rounded px-3 py-1.5 text-sm ${
										searchMode === "keyword"
											? "bg-white text-blue-600 shadow-sm"
											: "text-gray-600 hover:text-gray-900"
									}`}
								>
									Keyword
								</button>
								<button
									type="button"
									onClick={() => setSearchMode("semantic")}
									className={`rounded px-3 py-1.5 text-sm ${
										searchMode === "semantic"
											? "bg-white text-blue-600 shadow-sm"
											: "text-gray-600 hover:text-gray-900"
									}`}
								>
									Semantic
								</button>
							</div>
							<p className="text-xs text-gray-500">
								Semantic search depends on Pinecone being configured on the
								backend.
							</p>
						</div>

						<div className="flex gap-2">
							<button
								type="submit"
								disabled={searchLoading}
								className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
							>
								{searchLoading ? "Searching..." : "Search"}
							</button>
							<button
								type="button"
								onClick={handleClearSearch}
								disabled={
									searchLoading &&
									!isSearchActive &&
									searchQuery.length === 0 &&
									selectedSchemaId.length === 0 &&
									searchMode === "keyword"
								}
								className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
							>
								Clear
							</button>
						</div>
					</div>
				</form>

				{searchError && (
					<div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
						{searchError}
					</div>
				)}
			</section>

			{isSearchActive ? (
				<section className="space-y-4">
					<div className="flex items-center justify-between">
						<p className="text-sm text-gray-600">
							Showing{" "}
							{searchResponse?.results.length ?? 0} {searchMode} result
							{(searchResponse?.results.length ?? 0) === 1 ? "" : "s"} for "
							{submittedQuery}"
						</p>
					</div>

					{searchLoading ? (
						<p className="text-gray-500">Searching...</p>
					) : searchResponse?.mode === "keyword" ? (
						keywordResults.length === 0 ? (
							<p className="rounded-lg border border-dashed bg-white p-6 text-sm text-gray-500">
								No keyword matches found.
							</p>
						) : (
							<KeywordResultsTable
								results={keywordResults}
								schemas={schemas}
								onSelectDocument={handleSelectDocument}
							/>
						)
					) : semanticResults.length === 0 ? (
						<p className="rounded-lg border border-dashed bg-white p-6 text-sm text-gray-500">
							No semantic matches found.
						</p>
					) : (
						<SemanticResultsTable
							results={semanticResults}
							onSelectDocument={handleSelectDocument}
						/>
					)}
				</section>
			) : loading && docs.length === 0 ? (
				<p className="text-gray-500">Loading...</p>
			) : (
				<>
					<table className="min-w-full divide-y divide-gray-200">
						<thead className="bg-gray-50">
							<tr>
								<th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
									Filename
								</th>
								<th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
									Type
								</th>
								<th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
									Status
								</th>
								<th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
									Confidence
								</th>
								<th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
									Uploaded
								</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-gray-200 bg-white">
							{docs.map((doc) => (
								<tr
									key={doc.id}
									onClick={() => handleSelectDocument(doc.id)}
									className="cursor-pointer hover:bg-gray-50"
								>
									<td className="px-4 py-3 text-sm font-medium">{doc.filename}</td>
									<td className="px-4 py-3 text-sm text-gray-500">{doc.mimeType}</td>
									<td className="px-4 py-3">
										<StatusBadge status={doc.status} />
									</td>
									<td className="px-4 py-3 text-sm text-gray-500">
										{formatConfidence(doc.extractionConfidence)}
									</td>
									<td className="px-4 py-3 text-sm text-gray-500">
										{new Date(doc.createdAt).toLocaleDateString()}
									</td>
								</tr>
							))}
						</tbody>
					</table>
					{total > 20 && (
						<div className="flex justify-center gap-2">
							<button
								onClick={() => setPage((currentPage) => Math.max(1, currentPage - 1))}
								disabled={page === 1}
								className="rounded border px-3 py-1 disabled:opacity-50"
							>
								Previous
							</button>
							<span className="px-3 py-1 text-sm text-gray-600">
								Page {page} of {Math.ceil(total / 20)}
							</span>
							<button
								onClick={() => setPage((currentPage) => currentPage + 1)}
								disabled={page * 20 >= total}
								className="rounded border px-3 py-1 disabled:opacity-50"
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

function KeywordResultsTable({
	results,
	schemas,
	onSelectDocument,
}: {
	results: KeywordSearchResult[];
	schemas: Schema[];
	onSelectDocument: (id: string) => void;
}) {
	return (
		<table className="min-w-full divide-y divide-gray-200">
			<thead className="bg-gray-50">
				<tr>
					<th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
						Filename
					</th>
					<th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
						Status
					</th>
					<th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
						Confidence
					</th>
					<th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
						Schema
					</th>
					<th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
						Uploaded
					</th>
				</tr>
			</thead>
			<tbody className="divide-y divide-gray-200 bg-white">
				{results.map((result) => (
					<tr
						key={result.id}
						onClick={() => onSelectDocument(result.id)}
						className="cursor-pointer hover:bg-gray-50"
					>
						<td className="px-4 py-3 text-sm font-medium">{result.filename}</td>
						<td className="px-4 py-3">
							<StatusBadge status={result.status} />
						</td>
						<td className="px-4 py-3 text-sm text-gray-500">
							{formatConfidence(result.extractionConfidence)}
						</td>
						<td className="px-4 py-3 text-sm text-gray-500">
							{formatSchemaLabel(result.schemaId, schemas)}
						</td>
						<td className="px-4 py-3 text-sm text-gray-500">
							{new Date(result.createdAt).toLocaleDateString()}
						</td>
					</tr>
				))}
			</tbody>
		</table>
	);
}

function SemanticResultsTable({
	results,
	onSelectDocument,
}: {
	results: SemanticSearchResult[];
	onSelectDocument: (id: string) => void;
}) {
	return (
		<table className="min-w-full divide-y divide-gray-200">
			<thead className="bg-gray-50">
				<tr>
					<th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
						Filename
					</th>
					<th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
						Similarity
					</th>
					<th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
						Summary
					</th>
				</tr>
			</thead>
			<tbody className="divide-y divide-gray-200 bg-white">
				{results.map((result) => (
					<tr
						key={result.id}
						onClick={() => onSelectDocument(result.id)}
						className="cursor-pointer hover:bg-gray-50"
					>
						<td className="px-4 py-3 text-sm font-medium">
							{result.metadata?.filename ?? result.id}
						</td>
						<td className="px-4 py-3 text-sm text-gray-500">
							{(result.score * 100).toFixed(1)}%
						</td>
						<td className="px-4 py-3 text-sm text-gray-500">
							<div className="line-clamp-3">
								{typeof result.metadata?.summary === "string"
									? result.metadata.summary
									: "No summary available"}
							</div>
						</td>
					</tr>
				))}
			</tbody>
		</table>
	);
}
