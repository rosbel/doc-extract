import { useCallback, useEffect, useState } from "react";
import { api, type Schema } from "../api";
import { SchemaWorkbench } from "../components/SchemaWorkbench";

export function Schemas() {
	const [schemas, setSchemas] = useState<Schema[]>([]);
	const [editing, setEditing] = useState<Schema | null>(null);
	const [creatingMode, setCreatingMode] = useState<"manual" | "ai" | null>(null);
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

	if (creatingMode || editing) {
		return (
			<div className="space-y-4">
				<h1 className="text-2xl font-bold">{editing ? "Edit Schema" : "Create Schema"}</h1>
				<SchemaWorkbench
					schema={editing}
					initialAssistantMode={creatingMode === "ai"}
					onSaved={() => {
						setCreatingMode(null);
						setEditing(null);
						load();
					}}
					onCancel={() => {
						setCreatingMode(null);
						setEditing(null);
					}}
				/>
			</div>
		);
	}

	return (
		<div className="space-y-6">
			<div className="flex justify-between items-center">
				<h1 className="text-2xl font-bold">Extraction Schemas</h1>
				<div className="flex gap-3">
					<button
						onClick={() => setCreatingMode("manual")}
						className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
					>
						New Schema
					</button>
					<button
						onClick={() => setCreatingMode("ai")}
						className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
					>
						Generate With AI
					</button>
				</div>
			</div>

			{loading ? (
				<p className="text-gray-500">Loading...</p>
			) : schemas.length === 0 ? (
				<div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
					<p className="text-slate-600">
						No schemas yet. Start manually or generate a draft with AI.
					</p>
					<div className="mt-4 flex justify-center gap-3">
						<button
							onClick={() => setCreatingMode("manual")}
							className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
						>
							New Schema
						</button>
						<button
							onClick={() => setCreatingMode("ai")}
							className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
						>
							Generate With AI
						</button>
					</div>
				</div>
			) : (
				<div className="grid gap-4">
					{schemas.map((schema) => (
						<div
							key={schema.id}
							className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
						>
							<div className="flex justify-between items-start">
								<div>
									<h3 className="font-semibold text-lg">{schema.name}</h3>
									<p className="text-sm text-gray-600 mt-1">{schema.description}</p>
									<p className="mt-2 text-xs uppercase tracking-wide text-slate-500">
										Version {schema.version}
									</p>
									{schema.classificationHints.length > 0 && (
										<div className="flex gap-1 mt-2">
											{schema.classificationHints.map((hint) => (
												<span
													key={hint}
													className="inline-flex items-center rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600"
												>
													{hint}
												</span>
											))}
										</div>
									)}
								</div>
								<div className="flex gap-2">
									<button
										onClick={() => setEditing(schema)}
										className="text-sm text-blue-600 hover:text-blue-800"
									>
										Edit
									</button>
									<button
										onClick={() => handleArchive(schema.id)}
										className="text-sm text-red-600 hover:text-red-800"
									>
										Archive
									</button>
								</div>
							</div>
							<details className="mt-3">
								<summary className="text-sm text-gray-500 cursor-pointer">JSON Schema</summary>
								<pre className="mt-2 max-h-48 overflow-auto rounded bg-gray-50 p-3 text-xs">
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
