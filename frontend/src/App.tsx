import { lazy, Suspense, useCallback, useState } from "react";

const Documents = lazy(() =>
	import("./pages/Documents").then((m) => ({ default: m.Documents })),
);
const Schemas = lazy(() =>
	import("./pages/Schemas").then((m) => ({ default: m.Schemas })),
);
const Recommendations = lazy(() =>
	import("./pages/Recommendations").then((m) => ({
		default: m.Recommendations,
	})),
);
const DocumentDetail = lazy(() =>
	import("./pages/DocumentDetail").then((m) => ({
		default: m.DocumentDetail,
	})),
);

type Page = "documents" | "schemas" | "recommendations" | "document-detail";

export default function App() {
	const [page, setPage] = useState<Page>("documents");
	const [selectedDocId, setSelectedDocId] = useState<string | null>(null);

	const onSelectDocument = useCallback((id: string) => {
		setSelectedDocId(id);
		setPage("document-detail");
	}, []);

	const onBack = useCallback(() => setPage("documents"), []);

	return (
		<div className="min-h-screen">
			<nav className="bg-white border-b shadow-sm">
				<div className="max-w-6xl mx-auto px-4 flex items-center h-14 gap-6">
					<span className="font-bold text-lg">DocExtract</span>
					<button
						onClick={() => setPage("documents")}
						className={`text-sm font-medium ${page === "documents" || page === "document-detail" ? "text-blue-600" : "text-gray-600 hover:text-gray-900"}`}
					>
						Documents
					</button>
					<button
						onClick={() => setPage("schemas")}
						className={`text-sm font-medium ${page === "schemas" ? "text-blue-600" : "text-gray-600 hover:text-gray-900"}`}
					>
						Schemas
					</button>
					<button
						onClick={() => setPage("recommendations")}
						className={`text-sm font-medium ${page === "recommendations" ? "text-blue-600" : "text-gray-600 hover:text-gray-900"}`}
					>
						Recommend
					</button>
				</div>
			</nav>

			<main className="max-w-6xl mx-auto px-4 py-8">
				<Suspense fallback={<p>Loading...</p>}>
					{page === "documents" && (
						<Documents onSelectDocument={onSelectDocument} />
					)}
					{page === "schemas" && <Schemas />}
					{page === "recommendations" && <Recommendations />}
					{page === "document-detail" && selectedDocId && (
						<DocumentDetail
							documentId={selectedDocId}
							onBack={onBack}
						/>
					)}
				</Suspense>
			</main>
		</div>
	);
}
