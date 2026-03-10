import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
	api,
	type Schema,
	type SchemaAssistCreateResponse,
	type SchemaAssistDiffEntry,
	type SchemaAssistEditResponse,
	type SchemaRecommendation,
	type SchemaRevision,
} from "../api";
import { useUnsavedChangesPrompt } from "../hooks/useUnsavedChangesPrompt";

interface Props {
	schema?: Schema | null;
	assistantFirst?: boolean;
	sourceDocument?: {
		id: string;
		filename: string;
	} | null;
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

function stableValue(value: unknown): string {
	if (Array.isArray(value)) {
		return `[${value.map((item) => stableValue(item)).join(",")}]`;
	}

	if (value && typeof value === "object") {
		return `{${Object.entries(value as Record<string, unknown>)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, child]) => `${JSON.stringify(key)}:${stableValue(child)}`)
			.join(",")}}`;
	}

	return JSON.stringify(value);
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
		<div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
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
	assistantFirst = false,
	sourceDocument = null,
	onSaved,
	onCancel,
}: Props) {
	const isCreateMode = !schema;
	const formCardRef = useRef<HTMLDivElement | null>(null);
	const highlightTimeoutRef = useRef<number | null>(null);
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
	const [assistantNotice, setAssistantNotice] = useState<string | null>(null);
	const [assistantBusy, setAssistantBusy] = useState(false);
	const [assistantAnalysis, setAssistantAnalysis] = useState<string | null>(null);
	const [assistantWarnings, setAssistantWarnings] = useState<
		Array<{ filename: string; warning: string }>
	>([]);
	const [createProposals, setCreateProposals] = useState<SchemaRecommendation[]>(
		[],
	);
	const [createAssistantView, setCreateAssistantView] = useState<
		"assistant-input" | "draft-review"
	>("assistant-input");
	const [activeCreateProposalIndex, setActiveCreateProposalIndex] = useState(0);
	const [appliedCreateProposalIndex, setAppliedCreateProposalIndex] = useState<
		number | null
	>(null);
	const [editProposal, setEditProposal] = useState<SchemaRecommendation | null>(
		null,
	);
	const [diffEntries, setDiffEntries] = useState<SchemaAssistDiffEntry[]>([]);
	const [useAiRevision, setUseAiRevision] = useState(false);
	const [revisionSummary, setRevisionSummary] = useState<string | undefined>();
	const [revisions, setRevisions] = useState<SchemaRevision[]>([]);
	const [loadingRevisions, setLoadingRevisions] = useState(false);
	const [restoringRevisionId, setRestoringRevisionId] = useState<string | null>(
		null,
	);
	const [navigationUnlocked, setNavigationUnlocked] = useState(false);
	const [editorHighlighted, setEditorHighlighted] = useState(false);

	const initialDraftFingerprint = useMemo(
		() =>
			stableValue({
				name: schema?.name ?? "",
				description: schema?.description ?? "",
				jsonSchema: buildInitialJsonSchema(schema),
				classificationHints: schema?.classificationHints ?? [],
			}),
		[schema],
	);

	const currentDraftFingerprint = useMemo(
		() =>
			stableValue({
				name: name.trim(),
				description: description.trim(),
				jsonSchema,
				classificationHints: normalizeHints(hints),
			}),
		[name, description, jsonSchema, hints],
	);

	const hasAssistantState =
		assistantPrompt.trim().length > 0 ||
		assistantFiles.length > 0 ||
		Boolean(assistantAnalysis) ||
		createProposals.length > 0 ||
		Boolean(editProposal) ||
		diffEntries.length > 0;

	const isDirty =
		!navigationUnlocked &&
		(currentDraftFingerprint !== initialDraftFingerprint || hasAssistantState);

	useUnsavedChangesPrompt(isDirty);

	useEffect(() => {
		setName(schema?.name ?? "");
		setDescription(schema?.description ?? "");
		setJsonSchema(buildInitialJsonSchema(schema));
		setHints(schema?.classificationHints.join(", ") ?? "");
		setError(null);
		setAssistantError(null);
		setAssistantNotice(null);
		setAssistantAnalysis(null);
		setAssistantWarnings([]);
		setCreateProposals([]);
		setCreateAssistantView("assistant-input");
		setActiveCreateProposalIndex(0);
		setAppliedCreateProposalIndex(null);
		setEditProposal(null);
		setDiffEntries([]);
		setUseAiRevision(false);
		setRevisionSummary(undefined);
		setAssistantPrompt("");
		setAssistantFiles([]);
		setNavigationUnlocked(false);
	}, [schema, assistantFirst, sourceDocument?.id]);

	useEffect(() => {
		return () => {
			if (highlightTimeoutRef.current !== null) {
				window.clearTimeout(highlightTimeoutRef.current);
			}
		};
	}, []);

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
		const selectedFields = fields ? new Set(fields) : null;
		if (!selectedFields || selectedFields.has("name")) {
			setName(proposal.name);
		}
		if (!selectedFields || selectedFields.has("description")) {
			setDescription(proposal.description);
		}
		if (!selectedFields || selectedFields.has("classificationHints")) {
			setHints(proposal.classificationHints.join(", "));
		}
		if (!selectedFields || selectedFields.has("jsonSchema")) {
			setJsonSchema(formatJson(proposal.jsonSchema));
		}
		setUseAiRevision(true);
		setRevisionSummary(proposal.reasoning);
	};

	const pulseEditor = () => {
		setEditorHighlighted(true);
		if (highlightTimeoutRef.current !== null) {
			window.clearTimeout(highlightTimeoutRef.current);
		}
		highlightTimeoutRef.current = window.setTimeout(() => {
			setEditorHighlighted(false);
			highlightTimeoutRef.current = null;
		}, 1800);
	};

	const focusAppliedDraft = () => {
		pulseEditor();

		if (
			typeof window !== "undefined" &&
			typeof window.matchMedia === "function" &&
			window.matchMedia("(max-width: 1023px)").matches
		) {
			formCardRef.current?.scrollIntoView({
				behavior: "smooth",
				block: "start",
			});
		}
	};

	const activeCreateProposal = createProposals[activeCreateProposalIndex] ?? null;
	const hasAppliedCreateDraft =
		isCreateMode && appliedCreateProposalIndex !== null && createProposals.length > 0;
	const changedDiffEntries = diffEntries.filter((entry) => entry.changed);
	const hasChangedEditDiffs = changedDiffEntries.length > 0;

	const createActionLabel =
		assistantFiles.length > 0 || sourceDocument ? "Analyze Documents" : "Generate Drafts";
	const editActionLabel =
		assistantFiles.length > 0 ? "Analyze Schema Changes" : "Suggest Edits";

	const runAssistant = async () => {
		if (
			!assistantPrompt.trim() &&
			assistantFiles.length === 0 &&
			!sourceDocument
		) {
			setAssistantError(
				"Upload documents, use the loaded sample, add optional guidance, or combine them before running AI assist.",
			);
			return;
		}

		setAssistantBusy(true);
		setAssistantError(null);
		setAssistantNotice(null);
		setAssistantAnalysis(null);
		setAssistantWarnings([]);

		try {
			const response = await api.schemas.assist({
				mode: schema ? "edit" : "create",
				prompt: assistantPrompt,
				schemaId: schema?.id,
				files: assistantFiles,
				documentIds: sourceDocument ? [sourceDocument.id] : [],
			});

			setAssistantAnalysis(response.analysis);
			setAssistantWarnings(response.warnings ?? []);

			if ("proposals" in response) {
				const createResponse = response as SchemaAssistCreateResponse;
				setCreateProposals(createResponse.proposals);
				setActiveCreateProposalIndex(0);
				setAppliedCreateProposalIndex(null);
				setEditProposal(null);
				setDiffEntries([]);
				if (createResponse.proposals.length === 0) {
					setCreateAssistantView("assistant-input");
					setAssistantNotice(
						"AI could not detect a reusable schema draft from those documents yet. Add optional guidance or upload more representative files.",
					);
				} else {
					setCreateAssistantView("draft-review");
				}
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

	const handleUseCreateDraft = () => {
		if (!activeCreateProposal) {
			return;
		}

		applyProposalToEditor(activeCreateProposal);
		setAppliedCreateProposalIndex(activeCreateProposalIndex);
		focusAppliedDraft();
	};

	const handleAnalyzeAgain = () => {
		setCreateAssistantView("assistant-input");
		setAppliedCreateProposalIndex(null);
	};

	const handleSubmit = async (event: React.FormEvent) => {
		event.preventDefault();
		setError(null);
		setSaving(true);

		try {
			const parsedSchema = JSON.parse(jsonSchema);
			const payload = {
				name: name.trim(),
				description: description.trim(),
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

			flushSync(() => {
				setNavigationUnlocked(true);
			});
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
			flushSync(() => {
				setNavigationUnlocked(true);
			});
			onSaved();
		} catch (err) {
			setAssistantError(
				err instanceof Error ? err.message : "Failed to restore revision",
			);
		} finally {
			setRestoringRevisionId(null);
		}
	};

	const assistantInputPanel = (
		<div className="space-y-5">
			<div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
				<div>
					<p className="text-sm font-medium uppercase tracking-[0.24em] text-emerald-700">
						AI Assistant
					</p>
					<h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-900">
						{isCreateMode
							? "Detect schema drafts from uploaded documents"
							: "Refine this schema with AI"}
					</h2>
					<p className="mt-2 text-sm leading-6 text-slate-600">
						{isCreateMode
							? "Upload one or more documents first. AI will infer schema drafts from the files automatically, and you can add optional guidance if you want it to weigh the uploaded set a certain way."
							: "Upload documents that reveal gaps in the current schema, then add optional guidance if you want AI to emphasize certain fields or patterns."}
					</p>
				</div>

				<div className="mt-5 space-y-4">
					<div>
						<label
							htmlFor="assistant-files"
							className="block text-sm font-medium text-slate-700"
						>
							Documents for AI Detection
						</label>
						<p className="mt-1 text-xs leading-5 text-slate-500">
							{isCreateMode
								? "These files are the primary signal. AI will detect the schema shape that best explains each uploaded document and the group as a whole."
								: "These files give AI concrete evidence for how the existing schema should evolve."}
						</p>
						{sourceDocument && isCreateMode && (
							<div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
								<p className="font-medium">Loaded sample document</p>
								<p className="mt-1">
									{sourceDocument.filename} will be included when you click
									Analyze Documents.
								</p>
							</div>
						)}
						<input
							id="assistant-files"
							type="file"
							multiple
							onChange={(event) => {
								setAssistantFiles(Array.from(event.target.files ?? []));
							}}
							className="mt-3 block w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-3 text-sm text-slate-600 shadow-sm file:mr-4 file:rounded-full file:border-0 file:bg-sky-100 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-sky-700 hover:file:bg-sky-200"
						/>
						{assistantFiles.length > 0 && (
							<div className="mt-3 space-y-2">
								{assistantFiles.map((file) => (
									<div
										key={`${file.name}-${file.lastModified}`}
										className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
									>
										{file.name}
									</div>
								))}
							</div>
						)}
					</div>

					<div>
						<label
							htmlFor="assistant-prompt"
							className="block text-sm font-medium text-slate-700"
						>
							Optional Guidance
						</label>
						<p className="mt-1 text-xs leading-5 text-slate-500">
							Use this to tell AI how to interpret the uploaded files together,
							which fields to prioritize, or how to resolve edge cases across
							multiple documents.
						</p>
						<textarea
							id="assistant-prompt"
							value={assistantPrompt}
							onChange={(event) => setAssistantPrompt(event.target.value)}
							className="mt-3 block w-full rounded-xl border border-slate-300 px-3 py-3 shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
							rows={4}
							placeholder={
								isCreateMode
									? "Optional: explain how these uploaded documents relate, or call out fields that should matter across the set."
									: "Optional: explain what this revision should capture more accurately."
							}
						/>
					</div>

					<button
						type="button"
						onClick={runAssistant}
						disabled={assistantBusy}
						className="rounded-full bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-emerald-200 transition hover:bg-emerald-700 disabled:opacity-50"
					>
						{assistantBusy
							? "Thinking..."
							: isCreateMode
								? createActionLabel
								: editActionLabel}
					</button>
				</div>

				{assistantError && (
					<p className="mt-4 text-sm text-rose-600">{assistantError}</p>
				)}
				{assistantAnalysis && (
				<div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
						{assistantAnalysis}
					</div>
				)}
				{assistantNotice && (
					<div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
						{assistantNotice}
					</div>
				)}
				{assistantWarnings.length > 0 && (
					<div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
						<p className="text-sm font-medium text-amber-800">
							Some uploaded files had parsing issues
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

			{schema && editProposal && (
				<div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
					<div className="flex items-start justify-between gap-4">
						<div>
							<h3 className="text-lg font-semibold text-slate-900">
								{hasChangedEditDiffs ? "Proposed Revision" : "No Changes Suggested"}
							</h3>
							<p className="mt-1 text-sm text-slate-500">
								{editProposal.reasoning}
							</p>
						</div>
						{hasChangedEditDiffs && (
							<div className="flex gap-2">
								<button
									type="button"
									onClick={() => applyProposalToEditor(editProposal)}
									className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
								>
									Apply All
								</button>
								<button
									type="button"
									onClick={() => {
										setEditProposal(null);
										setDiffEntries([]);
									}}
									className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
								>
									Discard
								</button>
							</div>
						)}
					</div>

					{hasChangedEditDiffs ? (
						<div className="mt-4 space-y-4">
							{changedDiffEntries.map((entry) => (
								<div
									key={entry.field}
									className="rounded-xl border border-slate-200 p-4"
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
											className="rounded-full border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
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
					) : (
						<div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
							AI reviewed the current schema and did not suggest any changes.
						</div>
					)}
				</div>
			)}
		</div>
	);

	const createDraftReviewPanel =
		isCreateMode && activeCreateProposal ? (
			<div className="space-y-5">
				<div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
					<div className="flex flex-wrap items-start justify-between gap-4">
						<div>
							<p className="text-sm font-medium uppercase tracking-[0.24em] text-sky-700">
								Draft Review
							</p>
							<h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-900">
								Review the detected schema draft
							</h2>
							<p className="mt-2 text-sm leading-6 text-slate-600">
								AI has analyzed the uploaded documents. Review the suggested
								draft here, then use it to populate the editor.
							</p>
						</div>
						{hasAppliedCreateDraft && appliedCreateProposalIndex === activeCreateProposalIndex && (
							<div className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-emerald-700">
								Draft loaded into editor
							</div>
						)}
					</div>

					{assistantAnalysis && (
						<div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
							{assistantAnalysis}
						</div>
					)}
					{assistantWarnings.length > 0 && (
						<div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
							<p className="text-sm font-medium text-amber-800">
								Some uploaded files had parsing issues
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

					{createProposals.length > 1 && (
						<div className="mt-5 flex flex-wrap gap-2" aria-label="Detected drafts">
							{createProposals.map((proposal, index) => {
								const isActive = index === activeCreateProposalIndex;
								return (
									<button
										key={`${proposal.name}-${index}`}
										type="button"
										onClick={() => setActiveCreateProposalIndex(index)}
										className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
											isActive
												? "bg-sky-600 text-white shadow-sm shadow-sky-200"
												: "bg-slate-100 text-slate-700 hover:bg-slate-200"
										}`}
									>
										{proposal.name}
									</button>
								);
							})}
						</div>
					)}

					<div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50/80 p-5">
						<div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
							<div>
								<h3 className="text-lg font-semibold text-slate-900">
									{activeCreateProposal.name}
								</h3>
								<p className="mt-1 text-sm leading-6 text-slate-600">
									{activeCreateProposal.description}
								</p>
							</div>
							<div className="flex shrink-0 flex-wrap gap-2">
								<button
									type="button"
									onClick={handleUseCreateDraft}
									className="rounded-full bg-sky-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-sky-200 transition hover:bg-sky-700"
								>
									Use Draft
								</button>
								<button
									type="button"
									onClick={handleAnalyzeAgain}
									className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
								>
									Analyze Again
								</button>
							</div>
						</div>

						<p className="mt-4 text-sm italic text-slate-500">
							{activeCreateProposal.reasoning}
						</p>

						{activeCreateProposal.classificationHints.length > 0 && (
							<div className="mt-4 flex flex-wrap gap-2">
								{activeCreateProposal.classificationHints.map((hint) => (
									<span
										key={hint}
										className="rounded-full bg-sky-100 px-2.5 py-1 text-xs font-medium text-sky-700"
									>
										{hint}
									</span>
								))}
							</div>
						)}

						{activeCreateProposal.matchingDocuments.length > 0 && (
							<p className="mt-4 text-sm text-slate-500">
								Matches: {activeCreateProposal.matchingDocuments.join(", ")}
							</p>
						)}

						<div className="mt-5 overflow-hidden rounded-2xl border border-slate-900 bg-slate-950">
							<div className="border-b border-slate-800 px-4 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
								JSON Schema
							</div>
							<pre className="max-h-[26rem] overflow-auto p-4 text-xs text-slate-100">
								{formatJson(activeCreateProposal.jsonSchema)}
							</pre>
						</div>
					</div>
				</div>
			</div>
		) : null;

	const assistantPanel =
		isCreateMode && createAssistantView === "draft-review"
			? createDraftReviewPanel
			: assistantInputPanel;

	const formPanel = (
		<form onSubmit={handleSubmit} className="space-y-5">
			<div
				ref={formCardRef}
				className={`rounded-2xl border bg-white p-5 shadow-sm transition-all duration-300 ${
					editorHighlighted
						? "border-sky-300 shadow-lg shadow-sky-100 ring-4 ring-sky-100"
						: "border-slate-200"
				}`}
			>
				<div className="flex items-center justify-between">
					<div>
						<p className="text-sm font-medium uppercase tracking-[0.24em] text-sky-700">
							{isCreateMode ? "Manual Draft" : "Schema Draft"}
						</p>
						<h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-900">
							{isCreateMode
								? "Review or refine the schema manually"
								: "Edit the current schema revision"}
						</h2>
						<p className="mt-2 text-sm leading-6 text-slate-600">
							{isCreateMode
								? "AI is optional. You can still define the full schema yourself here if that is faster."
								: "Manual edits and AI-assisted edits both save as a new revision."}
						</p>
					</div>
					{schema && (
						<div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
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
							className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-2.5 shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
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
							className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-2.5 shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
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
							className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-2.5 shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
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
							className="mt-1 block min-h-[22rem] w-full rounded-xl border border-slate-300 px-3 py-2.5 font-mono text-sm shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
							required
						/>
					</div>
				</div>

				{error && <p className="mt-4 text-sm text-rose-600">{error}</p>}

				<div className="mt-5 flex gap-3">
					<button
						type="submit"
						disabled={saving}
						className="rounded-full bg-sky-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-sky-200 transition hover:bg-sky-700 disabled:opacity-50"
					>
						{saving
							? "Saving..."
							: schema
								? "Save Revision"
								: "Create Schema"}
					</button>
					<button
						type="button"
						onClick={onCancel}
						className="rounded-full border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
					>
						Cancel
					</button>
				</div>
			</div>

			{schema && (
				<div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
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
									className="rounded-xl border border-slate-200 p-4"
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
											className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
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
	);

	return (
		<div
			className={`grid gap-6 ${
				assistantFirst
					? "lg:grid-cols-[minmax(320px,0.95fr)_minmax(0,1.25fr)]"
					: "lg:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.95fr)]"
			}`}
		>
			{assistantFirst ? (
				<>
					<div className="transition-all duration-300 ease-out motion-reduce:transition-none">
						{assistantPanel}
					</div>
					{formPanel}
				</>
			) : (
				<>
					{formPanel}
					<div className="transition-all duration-300 ease-out motion-reduce:transition-none">
						{assistantPanel}
					</div>
				</>
			)}
		</div>
	);
}
