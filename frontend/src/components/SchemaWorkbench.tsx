import { useEffect, useState } from "react";
import {
	api,
	type Schema,
	type SchemaAssistCreateResponse,
	type SchemaAssistDiffEntry,
	type SchemaAssistEditResponse,
	type SchemaRecommendation,
	type SchemaRevision,
} from "../api";

interface Props {
	schema?: Schema | null;
	initialAssistantMode?: boolean;
	onSaved: () => void;
	onCancel: () => void;
}

function formatJson(value: unknown) {
	return JSON.stringify(value, null, 2);
}

function normalizeHints(value: string) {
	return value
		.split(",")
		.map((hint) => hint.trim())
		.filter(Boolean);
}

function buildInitialJsonSchema(schema?: Schema | null) {
	return schema
		? formatJson(schema.jsonSchema)
		: '{\n  "type": "object",\n  "properties": {\n    \n  }\n}';
}

function DraftPreview({
	label,
	value,
}: {
	label: string;
	value: unknown;
}) {
	const content =
		typeof value === "string"
			? value
			: Array.isArray(value)
				? value.join(", ")
				: formatJson(value);

	return (
		<div className="rounded-md border border-slate-200 bg-slate-50 p-3">
			<p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
				{label}
			</p>
			<pre className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-700">
				{content}
			</pre>
		</div>
	);
}

export function SchemaWorkbench({
	schema,
	initialAssistantMode = false,
	onSaved,
	onCancel,
}: Props) {
	const [name, setName] = useState(schema?.name ?? "");
	const [description, setDescription] = useState(schema?.description ?? "");
	const [jsonSchema, setJsonSchema] = useState(buildInitialJsonSchema(schema));
	const [hints, setHints] = useState(
		schema?.classificationHints.join(", ") ?? "",
	);
	const [error, setError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const [assistantPrompt, setAssistantPrompt] = useState("");
	const [assistantFiles, setAssistantFiles] = useState<File[]>([]);
	const [assistantError, setAssistantError] = useState<string | null>(null);
	const [assistantBusy, setAssistantBusy] = useState(false);
	const [assistantAnalysis, setAssistantAnalysis] = useState<string | null>(null);
	const [assistantWarnings, setAssistantWarnings] = useState<
		Array<{ filename: string; warning: string }>
	>([]);
	const [createProposals, setCreateProposals] = useState<SchemaRecommendation[]>(
		[],
	);
	const [editProposal, setEditProposal] = useState<SchemaRecommendation | null>(
		null,
	);
	const [diffEntries, setDiffEntries] = useState<SchemaAssistDiffEntry[]>([]);
	const [useAiRevision, setUseAiRevision] = useState(initialAssistantMode);
	const [revisionSummary, setRevisionSummary] = useState<string | undefined>();
	const [revisions, setRevisions] = useState<SchemaRevision[]>([]);
	const [loadingRevisions, setLoadingRevisions] = useState(false);
	const [restoringRevisionId, setRestoringRevisionId] = useState<string | null>(
		null,
	);

	useEffect(() => {
		setName(schema?.name ?? "");
		setDescription(schema?.description ?? "");
		setJsonSchema(buildInitialJsonSchema(schema));
		setHints(schema?.classificationHints.join(", ") ?? "");
		setError(null);
		setAssistantError(null);
		setAssistantAnalysis(null);
		setAssistantWarnings([]);
		setCreateProposals([]);
		setEditProposal(null);
		setDiffEntries([]);
		setUseAiRevision(initialAssistantMode);
		setRevisionSummary(undefined);
		setAssistantPrompt("");
		setAssistantFiles([]);
	}, [schema, initialAssistantMode]);

	useEffect(() => {
		if (!schema) {
			setRevisions([]);
			return;
		}

		let cancelled = false;
		setLoadingRevisions(true);
		api.schemas
			.revisions(schema.id)
			.then((result) => {
				if (!cancelled) {
					setRevisions(result);
				}
			})
			.catch((err) => {
				if (!cancelled) {
					setAssistantError(
						err instanceof Error ? err.message : "Failed to load revisions",
					);
				}
			})
			.finally(() => {
				if (!cancelled) {
					setLoadingRevisions(false);
				}
			});

		return () => {
			cancelled = true;
		};
	}, [schema]);

	const applyProposalToEditor = (
		proposal: SchemaRecommendation,
		fields?: SchemaAssistDiffEntry["field"][],
	) => {
		const fieldSet = fields ? new Set(fields) : null;
		if (!fieldSet || fieldSet.has("name")) {
			setName(proposal.name);
		}
		if (!fieldSet || fieldSet.has("description")) {
			setDescription(proposal.description);
		}
		if (!fieldSet || fieldSet.has("classificationHints")) {
			setHints(proposal.classificationHints.join(", "));
		}
		if (!fieldSet || fieldSet.has("jsonSchema")) {
			setJsonSchema(formatJson(proposal.jsonSchema));
		}
		setUseAiRevision(true);
		setRevisionSummary(proposal.reasoning);
	};

	const runAssistant = async () => {
		if (!assistantPrompt.trim() && assistantFiles.length === 0) {
			setAssistantError("Add a prompt, files, or both before running AI assist.");
			return;
		}

		setAssistantBusy(true);
		setAssistantError(null);
		setAssistantAnalysis(null);
		setAssistantWarnings([]);

		try {
			const response = await api.schemas.assist({
				mode: schema ? "edit" : "create",
				prompt: assistantPrompt,
				schemaId: schema?.id,
				files: assistantFiles,
			});

			setAssistantAnalysis(response.analysis);
			setAssistantWarnings(response.warnings ?? []);

			if ("proposals" in response) {
				const createResponse = response as SchemaAssistCreateResponse;
				setCreateProposals(createResponse.proposals);
				setEditProposal(null);
				setDiffEntries([]);
			} else {
				const editResponse = response as SchemaAssistEditResponse;
				setEditProposal(editResponse.proposal);
				setDiffEntries(editResponse.diff);
				setCreateProposals([]);
			}
		} catch (err) {
			setAssistantError(
				err instanceof Error ? err.message : "Schema assist failed",
			);
		} finally {
			setAssistantBusy(false);
		}
	};

	const handleSubmit = async (event: React.FormEvent) => {
		event.preventDefault();
		setError(null);
		setSaving(true);

		try {
			const parsedSchema = JSON.parse(jsonSchema);
			const payload = {
				name,
				description,
				jsonSchema: parsedSchema,
				classificationHints: normalizeHints(hints),
				revision: {
					source: useAiRevision ? "ai" : "manual",
					...(revisionSummary ? { summary: revisionSummary } : {}),
				},
			} as const;

			if (schema) {
				await api.schemas.update(schema.id, payload);
			} else {
				await api.schemas.create(payload);
			}

			onSaved();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to save schema");
		} finally {
			setSaving(false);
		}
	};

	const handleRestore = async (revision: SchemaRevision) => {
		if (!schema) {
			return;
		}

		const confirmed = window.confirm(
			`Restore version ${revision.version} as a new current revision?`,
		);
		if (!confirmed) {
			return;
		}

		setRestoringRevisionId(revision.id);
		setAssistantError(null);
		try {
			await api.schemas.restoreRevision(schema.id, revision.id);
			onSaved();
		} catch (err) {
			setAssistantError(
				err instanceof Error ? err.message : "Failed to restore revision",
			);
		} finally {
			setRestoringRevisionId(null);
		}
	};

	return (
		<div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.9fr)]">
			<form onSubmit={handleSubmit} className="space-y-5">
				<div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
					<div className="flex items-center justify-between">
						<div>
							<h2 className="text-lg font-semibold text-slate-900">
								{schema ? "Schema Draft" : "New Schema"}
							</h2>
							<p className="mt-1 text-sm text-slate-500">
								Manual edits are always available. AI suggestions stay optional
								until you apply them.
							</p>
						</div>
						{schema && (
							<div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
								Current version {schema.version}
							</div>
						)}
					</div>

					<div className="mt-5 grid gap-4">
						<div>
							<label
								htmlFor="schema-name"
								className="block text-sm font-medium text-slate-700"
							>
								Name
							</label>
							<input
								id="schema-name"
								type="text"
								value={name}
								onChange={(event) => setName(event.target.value)}
								className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
								required
							/>
						</div>

						<div>
							<label
								htmlFor="schema-description"
								className="block text-sm font-medium text-slate-700"
							>
								Description
							</label>
							<textarea
								id="schema-description"
								value={description}
								onChange={(event) => setDescription(event.target.value)}
								className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
								rows={3}
								required
							/>
						</div>

						<div>
							<label
								htmlFor="schema-hints"
								className="block text-sm font-medium text-slate-700"
							>
								Classification Hints
							</label>
							<input
								id="schema-hints"
								type="text"
								value={hints}
								onChange={(event) => setHints(event.target.value)}
								className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
								placeholder="invoice, billing statement, total due"
							/>
						</div>

						<div>
							<label
								htmlFor="schema-json"
								className="block text-sm font-medium text-slate-700"
							>
								JSON Schema
							</label>
							<textarea
								id="schema-json"
								value={jsonSchema}
								onChange={(event) => setJsonSchema(event.target.value)}
								className="mt-1 block min-h-[22rem] w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
								required
							/>
						</div>
					</div>

					{error && <p className="mt-4 text-sm text-rose-600">{error}</p>}

					<div className="mt-5 flex gap-3">
						<button
							type="submit"
							disabled={saving}
							className="rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50"
						>
							{saving ? "Saving..." : schema ? "Save Revision" : "Create Schema"}
						</button>
						<button
							type="button"
							onClick={onCancel}
							className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
						>
							Cancel
						</button>
					</div>
				</div>

				{schema && (
					<div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
						<div className="flex items-center justify-between">
							<div>
								<h2 className="text-lg font-semibold text-slate-900">
									Revision History
								</h2>
								<p className="mt-1 text-sm text-slate-500">
									Restoring creates a new current revision from a prior snapshot.
								</p>
							</div>
						</div>

						{loadingRevisions ? (
							<p className="mt-4 text-sm text-slate-500">Loading revisions...</p>
						) : (
							<div className="mt-4 space-y-3">
								{revisions.map((revision) => (
									<div
										key={revision.id}
										className="rounded-lg border border-slate-200 p-3"
									>
										<div className="flex items-start justify-between gap-3">
											<div>
												<p className="text-sm font-semibold text-slate-800">
													Version {revision.version}
												</p>
												<p className="mt-1 text-xs uppercase tracking-wide text-slate-500">
													{revision.source}
												</p>
												<p className="mt-1 text-sm text-slate-500">
													{new Date(revision.createdAt).toLocaleString()}
												</p>
												{revision.summary && (
													<p className="mt-2 text-sm text-slate-600">
														{revision.summary}
													</p>
												)}
											</div>
											<button
												type="button"
												onClick={() => handleRestore(revision)}
												disabled={restoringRevisionId === revision.id}
												className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
											>
												{restoringRevisionId === revision.id
													? "Restoring..."
													: "Restore"}
											</button>
										</div>
									</div>
								))}
							</div>
						)}
					</div>
				)}
			</form>

			<div className="space-y-5">
				<div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
					<div>
						<h2 className="text-lg font-semibold text-slate-900">
							AI Assistant
						</h2>
						<p className="mt-1 text-sm text-slate-500">
							{schema
								? "Suggest refinements, then review the diff before applying any changes."
								: "Generate draft schemas from a prompt, sample documents, or both."}
						</p>
					</div>

					<div className="mt-4 space-y-4">
						<div>
							<label
								htmlFor="assistant-prompt"
								className="block text-sm font-medium text-slate-700"
							>
								Prompt
							</label>
							<textarea
								id="assistant-prompt"
								value={assistantPrompt}
								onChange={(event) => setAssistantPrompt(event.target.value)}
								className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
								rows={4}
								placeholder={
									schema
										? "Describe how this schema should improve."
										: "Describe the document type and the fields you want extracted."
								}
							/>
						</div>

						<div>
							<label
								htmlFor="assistant-files"
								className="block text-sm font-medium text-slate-700"
							>
								Sample Files
							</label>
							<input
								id="assistant-files"
								type="file"
								multiple
								onChange={(event) => {
									setAssistantFiles(Array.from(event.target.files ?? []));
								}}
								className="mt-1 block w-full text-sm text-slate-600"
							/>
							{assistantFiles.length > 0 && (
								<div className="mt-2 space-y-1">
									{assistantFiles.map((file) => (
										<div
											key={`${file.name}-${file.lastModified}`}
											className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600"
										>
											{file.name}
										</div>
									))}
								</div>
							)}
						</div>

						<button
							type="button"
							onClick={runAssistant}
							disabled={assistantBusy}
							className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
						>
							{assistantBusy ? "Thinking..." : schema ? "Suggest Edits" : "Generate Drafts"}
						</button>
					</div>

					{assistantError && (
						<p className="mt-4 text-sm text-rose-600">{assistantError}</p>
					)}
					{assistantAnalysis && (
						<div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
							{assistantAnalysis}
						</div>
					)}
					{assistantWarnings.length > 0 && (
						<div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
							<p className="text-sm font-medium text-amber-800">
								Some files had parsing issues
							</p>
							<ul className="mt-2 space-y-1 text-sm text-amber-700">
								{assistantWarnings.map((warning) => (
									<li key={`${warning.filename}-${warning.warning}`}>
										{warning.filename}: {warning.warning}
									</li>
								))}
							</ul>
						</div>
					)}
				</div>

				{!schema && createProposals.length > 0 && (
					<div className="space-y-4">
						{createProposals.map((proposal, index) => (
							<div
								key={`${proposal.name}-${index}`}
								className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
							>
								<div className="flex items-start justify-between gap-4">
									<div>
										<h3 className="text-lg font-semibold text-slate-900">
											{proposal.name}
										</h3>
										<p className="mt-1 text-sm text-slate-500">
											{proposal.description}
										</p>
									</div>
									<button
										type="button"
										onClick={() => applyProposalToEditor(proposal)}
										className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700"
									>
										Load Draft
									</button>
								</div>

								<p className="mt-3 text-sm italic text-slate-500">
									{proposal.reasoning}
								</p>

								{proposal.classificationHints.length > 0 && (
									<div className="mt-3 flex flex-wrap gap-2">
										{proposal.classificationHints.map((hint) => (
											<span
												key={hint}
												className="rounded-full bg-sky-100 px-2.5 py-1 text-xs font-medium text-sky-700"
											>
												{hint}
											</span>
										))}
									</div>
								)}

								{proposal.matchingDocuments.length > 0 && (
									<p className="mt-3 text-sm text-slate-500">
										Matches: {proposal.matchingDocuments.join(", ")}
									</p>
								)}

								<details className="mt-4">
									<summary className="cursor-pointer text-sm font-medium text-slate-600">
										View JSON Schema
									</summary>
									<pre className="mt-3 overflow-auto rounded-md bg-slate-950 p-3 text-xs text-slate-100">
										{formatJson(proposal.jsonSchema)}
									</pre>
								</details>
							</div>
						))}
					</div>
				)}

				{schema && editProposal && (
					<div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
						<div className="flex items-start justify-between gap-4">
							<div>
								<h3 className="text-lg font-semibold text-slate-900">
									Proposed Revision
								</h3>
								<p className="mt-1 text-sm text-slate-500">
									{editProposal.reasoning}
								</p>
							</div>
							<div className="flex gap-2">
								<button
									type="button"
									onClick={() => applyProposalToEditor(editProposal)}
									className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700"
								>
									Apply All
								</button>
								<button
									type="button"
									onClick={() => {
										setEditProposal(null);
										setDiffEntries([]);
									}}
									className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
								>
									Discard
								</button>
							</div>
						</div>

						<div className="mt-4 space-y-4">
							{diffEntries
								.filter((entry) => entry.changed)
								.map((entry) => (
									<div
										key={entry.field}
										className="rounded-lg border border-slate-200 p-4"
									>
										<div className="flex items-center justify-between">
											<h4 className="text-sm font-semibold text-slate-800">
												{entry.label}
											</h4>
											<button
												type="button"
												onClick={() =>
													applyProposalToEditor(editProposal, [entry.field])
												}
												className="rounded-md border border-slate-300 px-3 py-1 text-sm font-medium text-slate-700 hover:bg-slate-50"
											>
												Apply Field
											</button>
										</div>

										<div className="mt-3 grid gap-3 md:grid-cols-2">
											<DraftPreview label="Current" value={entry.before} />
											<DraftPreview label="Suggested" value={entry.after} />
										</div>
									</div>
								))}
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
