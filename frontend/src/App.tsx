import { useState } from "react";
import { DocumentDetail } from "./pages/DocumentDetail";
import { Documents } from "./pages/Documents";
import { Schemas } from "./pages/Schemas";

type Page = "documents" | "schemas" | "document-detail";

export default function App() {
	const [page, setPage] = useState<Page>("documents");
	const [selectedDocId, setSelectedDocId] = useState<string | null>(null);

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
				</div>
			</nav>

			<main className="max-w-6xl mx-auto px-4 py-8">
				{page === "documents" && (
					<Documents
						onSelectDocument={(id) => {
							setSelectedDocId(id);
							setPage("document-detail");
						}}
					/>
				)}
				{page === "schemas" && <Schemas />}
				{page === "document-detail" && selectedDocId && (
					<DocumentDetail
						documentId={selectedDocId}
						onBack={() => setPage("documents")}
					/>
				)}
			</main>
		</div>
	);
}
