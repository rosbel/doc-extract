import { useEffect, useState } from "react";
import { api, type Schema } from "../api";
import { SchemaEditor } from "../components/SchemaEditor";

export function Schemas() {
	const [schemas, setSchemas] = useState<Schema[]>([]);
	const [editing, setEditing] = useState<Schema | null>(null);
	const [creating, setCreating] = useState(false);
	const [loading, setLoading] = useState(true);

	const load = async () => {
		setLoading(true);
		try {
			const data = await api.schemas.list();
			setSchemas(data);
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		load();
	}, []);

	if (creating || editing) {
		return (
			<div className="space-y-4">
				<h1 className="text-2xl font-bold">{editing ? "Edit Schema" : "Create Schema"}</h1>
				<SchemaEditor
					schema={editing}
					onSaved={() => {
						setCreating(false);
						setEditing(null);
						load();
					}}
					onCancel={() => {
						setCreating(false);
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
				<button
					onClick={() => setCreating(true)}
					className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
				>
					New Schema
				</button>
			</div>

			{loading ? (
				<p className="text-gray-500">Loading...</p>
			) : schemas.length === 0 ? (
				<p className="text-gray-500">No schemas yet. Create one to get started.</p>
			) : (
				<div className="grid gap-4">
					{schemas.map((schema) => (
						<div key={schema.id} className="bg-white rounded-lg border p-4 shadow-sm">
							<div className="flex justify-between items-start">
								<div>
									<h3 className="font-semibold text-lg">{schema.name}</h3>
									<p className="text-sm text-gray-600 mt-1">{schema.description}</p>
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
										onClick={async () => {
											await api.schemas.delete(schema.id);
											load();
										}}
										className="text-sm text-red-600 hover:text-red-800"
									>
										Archive
									</button>
								</div>
							</div>
							<details className="mt-3">
								<summary className="text-sm text-gray-500 cursor-pointer">JSON Schema</summary>
								<pre className="mt-2 text-xs bg-gray-50 p-3 rounded overflow-auto max-h-48">
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
