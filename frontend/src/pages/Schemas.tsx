import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type Schema } from "../api";

export function Schemas() {
	const [schemas, setSchemas] = useState<Schema[]>([]);
	const [loading, setLoading] = useState(true);

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const data = await api.schemas.list();
			setSchemas(data);
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		load();
	}, [load]);

	const handleArchive = useCallback(async (schemaId: string) => {
		try {
			await api.schemas.delete(schemaId);
			load();
		} catch (err) {
			console.error("Failed to archive schema:", err);
		}
	}, [load]);

	return (
		<div className="space-y-8">
			<div className="flex justify-between items-center">
				<div>
					<p className="text-sm font-medium uppercase tracking-[0.24em] text-sky-700">
						Schema Library
					</p>
					<h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">
						Extraction Schemas
					</h1>
					<p className="mt-2 max-w-3xl text-sm text-slate-600">
						Create schemas from uploaded documents or refine the ones you already
						have. Every save becomes a revision, so editing stays safe.
					</p>
				</div>
				{schemas.length > 0 && (
					<Link
						to="/schemas/new"
						className="rounded-full bg-sky-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-sky-200 transition hover:bg-sky-700"
					>
						New Schema
					</Link>
				)}
			</div>

			{loading ? (
				<p className="text-gray-500">Loading...</p>
			) : schemas.length === 0 ? (
				<div className="rounded-2xl border border-dashed border-slate-300 bg-white/80 p-12 text-center shadow-sm">
					<p className="text-lg font-semibold text-slate-900">
						No schemas yet.
					</p>
					<p className="mt-2 text-sm text-slate-600">
						Start a new schema and let AI infer the structure from your
						documents first, then tune the draft manually.
					</p>
					<div className="mt-5">
						<Link
							to="/schemas/new"
							className="rounded-full bg-sky-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-sky-200 transition hover:bg-sky-700"
						>
							New Schema
						</Link>
					</div>
				</div>
			) : (
				<div className="grid gap-5">
					{schemas.map((schema) => (
						<div
							key={schema.id}
							className="rounded-2xl border border-slate-200 bg-white/90 p-5 shadow-sm shadow-slate-200/60 transition hover:-translate-y-0.5 hover:shadow-md"
						>
							<div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
								<div className="min-w-0 flex-1">
									<div className="flex flex-wrap items-center gap-2">
										<h3 className="text-xl font-semibold tracking-tight text-slate-900">
											{schema.name}
										</h3>
										<span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-600">
											v{schema.version}
										</span>
										<span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-emerald-700">
											{schema.status}
										</span>
									</div>
									<p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
										{schema.description}
									</p>
									{schema.classificationHints.length > 0 && (
										<div className="mt-4 flex flex-wrap gap-2">
											{schema.classificationHints.map((hint) => (
												<span
													key={hint}
													className="inline-flex items-center rounded-full bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700"
												>
													{hint}
												</span>
											))}
										</div>
									)}
								</div>
								<div className="flex shrink-0 items-center gap-2 self-start">
									<Link
										to={`/schemas/${schema.id}/edit`}
										aria-label={`Edit schema ${schema.name}`}
										className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-sky-300 hover:bg-sky-50 hover:text-sky-700"
									>
										<svg
											viewBox="0 0 20 20"
											fill="none"
											className="h-4 w-4"
											aria-hidden="true"
										>
											<path
												d="M13.75 3.75L16.25 6.25M5 15l2.3-.46a2 2 0 0 0 1.02-.55L15 7.31a1.77 1.77 0 0 0 0-2.5l-.81-.81a1.77 1.77 0 0 0-2.5 0L5 10.68a2 2 0 0 0-.55 1.02L4 14.99 5 15Z"
												stroke="currentColor"
												strokeWidth="1.5"
												strokeLinecap="round"
												strokeLinejoin="round"
											/>
										</svg>
										Edit
									</Link>
									<button
										onClick={() => handleArchive(schema.id)}
										aria-label={`Archive schema ${schema.name}`}
										className="inline-flex items-center gap-2 rounded-full border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 transition hover:border-rose-300 hover:bg-rose-100"
									>
										<svg
											viewBox="0 0 20 20"
											fill="none"
											className="h-4 w-4"
											aria-hidden="true"
										>
											<path
												d="M4.5 6.5h11m-9.5 0V5.75A1.75 1.75 0 0 1 7.75 4h4.5A1.75 1.75 0 0 1 14 5.75V6.5m-8.5 0 .5 8.25A1.75 1.75 0 0 0 7.75 16.5h4.5A1.75 1.75 0 0 0 14 14.75l.5-8.25m-5.75 3v3.5m2.5-3.5v3.5"
												stroke="currentColor"
												strokeWidth="1.5"
												strokeLinecap="round"
												strokeLinejoin="round"
											/>
										</svg>
										Archive
									</button>
								</div>
							</div>
							<details className="mt-4 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
								<summary className="cursor-pointer text-sm font-medium text-slate-600">
									View JSON Schema
								</summary>
								<pre className="mt-3 max-h-48 overflow-auto rounded-xl bg-slate-950 p-4 text-xs text-slate-100">
									{JSON.stringify(schema.jsonSchema, null, 2)}
								</pre>
							</details>
						</div>
					))}
				</div>
			)}
		</div>
	);
}
