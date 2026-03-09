import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, type DocumentDetail, type Schema } from "../api";
import { SchemaWorkbench } from "../components/SchemaWorkbench";

interface Props {
	mode: "create" | "edit";
}

export function SchemaWorkbenchPage({ mode }: Props) {
	const navigate = useNavigate();
	const { schemaId } = useParams();
	const [searchParams] = useSearchParams();
	const [schema, setSchema] = useState<Schema | null>(null);
	const [sourceDocument, setSourceDocument] = useState<
		Pick<DocumentDetail, "id" | "filename"> | null
	>(null);
	const [loading, setLoading] = useState(mode === "edit");
	const [error, setError] = useState<string | null>(null);
	const [sourceDocumentError, setSourceDocumentError] = useState<string | null>(
		null,
	);
	const sourceDocumentId =
		mode === "create" ? searchParams.get("sourceDocumentId") : null;

	const loadSchema = useCallback(async () => {
		if (mode !== "edit" || !schemaId) {
			setSchema(null);
			setLoading(false);
			return;
		}

		setLoading(true);
		setError(null);
		try {
			const result = await api.schemas.get(schemaId);
			setSchema(result);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to load schema");
		} finally {
			setLoading(false);
		}
	}, [mode, schemaId]);

	useEffect(() => {
		void loadSchema();
	}, [loadSchema]);

	useEffect(() => {
		if (mode !== "create" || !sourceDocumentId) {
			setSourceDocument(null);
			setSourceDocumentError(null);
			return;
		}

		let cancelled = false;
		setSourceDocumentError(null);
		api.documents
			.get(sourceDocumentId)
			.then((document) => {
				if (!cancelled) {
					setSourceDocument({
						id: document.id,
						filename: document.filename,
					});
				}
			})
			.catch((err) => {
				if (!cancelled) {
					setSourceDocument(null);
					setSourceDocumentError(
						err instanceof Error
							? err.message
							: "Failed to load the selected document sample",
					);
				}
			});

		return () => {
			cancelled = true;
		};
	}, [mode, sourceDocumentId]);

	if (loading) {
		return <p className="text-slate-500">Loading schema...</p>;
	}

	if (error) {
		return <p className="text-rose-600">{error}</p>;
	}

	if (mode === "edit" && !schema) {
		return <p className="text-slate-500">Schema not found.</p>;
	}

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between">
				<div>
					<p className="text-sm font-medium uppercase tracking-[0.24em] text-sky-700">
						Schemas
					</p>
					<h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">
						{mode === "create" ? "New Schema" : `Edit ${schema?.name ?? "Schema"}`}
					</h1>
					<p className="mt-2 max-w-3xl text-sm text-slate-600">
						{mode === "create"
							? "Upload documents first. AI will infer schema drafts from those files, and you can add optional guidance if you need it to account for the full set."
							: "Review the current schema, apply AI-assisted edits if needed, and save a new revision when the draft is ready."}
					</p>
					{mode === "create" && sourceDocument && (
						<p className="mt-2 max-w-3xl text-sm text-amber-700">
							AI Assist is ready to use {sourceDocument.filename} as a sample as
							soon as you click Analyze Documents.
						</p>
					)}
					{mode === "create" && sourceDocumentError && (
						<p className="mt-2 max-w-3xl text-sm text-rose-600">
							{sourceDocumentError}
						</p>
					)}
				</div>
				<Link
					to="/schemas"
					className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:border-slate-400 hover:bg-slate-50"
				>
					Back to Schemas
				</Link>
			</div>

			<SchemaWorkbench
				schema={schema}
				assistantFirst={mode === "create"}
				sourceDocument={sourceDocument}
				onSaved={() => navigate("/schemas")}
				onCancel={() => navigate("/schemas")}
			/>
		</div>
	);
}
