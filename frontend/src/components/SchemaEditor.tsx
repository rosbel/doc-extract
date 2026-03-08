import { useState } from "react";
import { api, type Schema } from "../api";

interface Props {
	schema?: Schema | null;
	onSaved: () => void;
	onCancel: () => void;
}

export function SchemaEditor({ schema, onSaved, onCancel }: Props) {
	const [name, setName] = useState(schema?.name || "");
	const [description, setDescription] = useState(schema?.description || "");
	const [jsonSchema, setJsonSchema] = useState(
		schema ? JSON.stringify(schema.jsonSchema, null, 2) : '{\n  "type": "object",\n  "properties": {\n    \n  }\n}',
	);
	const [hints, setHints] = useState(schema?.classificationHints.join(", ") || "");
	const [error, setError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setError(null);
		setSaving(true);

		try {
			const parsed = JSON.parse(jsonSchema);
			const data = {
				name,
				description,
				jsonSchema: parsed,
				classificationHints: hints
					.split(",")
					.map((h) => h.trim())
					.filter(Boolean),
			};

			if (schema) {
				await api.schemas.update(schema.id, data);
			} else {
				await api.schemas.create(data);
			}
			onSaved();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to save");
		} finally {
			setSaving(false);
		}
	};

	return (
		<form onSubmit={handleSubmit} className="space-y-4">
			<div>
				<label className="block text-sm font-medium text-gray-700">Name</label>
				<input
					type="text"
					value={name}
					onChange={(e) => setName(e.target.value)}
					className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
					required
				/>
			</div>
			<div>
				<label className="block text-sm font-medium text-gray-700">Description</label>
				<textarea
					value={description}
					onChange={(e) => setDescription(e.target.value)}
					className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
					rows={2}
					required
				/>
			</div>
			<div>
				<label className="block text-sm font-medium text-gray-700">JSON Schema</label>
				<textarea
					value={jsonSchema}
					onChange={(e) => setJsonSchema(e.target.value)}
					className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm font-mono text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
					rows={12}
					required
				/>
			</div>
			<div>
				<label className="block text-sm font-medium text-gray-700">
					Classification Hints (comma-separated)
				</label>
				<input
					type="text"
					value={hints}
					onChange={(e) => setHints(e.target.value)}
					className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
					placeholder="invoice, receipt, billing"
				/>
			</div>
			{error && <p className="text-red-600 text-sm">{error}</p>}
			<div className="flex gap-3">
				<button
					type="submit"
					disabled={saving}
					className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
				>
					{saving ? "Saving..." : schema ? "Update" : "Create"}
				</button>
				<button
					type="button"
					onClick={onCancel}
					className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
				>
					Cancel
				</button>
			</div>
		</form>
	);
}
