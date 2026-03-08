import { useCallback, useState } from "react";
import { api, type SchemaRecommendation, type RecommendationResponse } from "../api";

type State = "input" | "loading" | "results";

export function Recommendations() {
	const [state, setState] = useState<State>("input");
	const [files, setFiles] = useState<File[]>([]);
	const [dragging, setDragging] = useState(false);
	const [result, setResult] = useState<RecommendationResponse | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [accepted, setAccepted] = useState<Set<number>>(new Set());
	const [dismissed, setDismissed] = useState<Set<number>>(new Set());

	const handleFiles = useCallback((newFiles: FileList | File[]) => {
		const arr = Array.from(newFiles);
		setFiles((prev) => {
			const combined = [...prev, ...arr];
			return combined.slice(0, 10);
		});
	}, []);

	const onDrop = useCallback(
		(e: React.DragEvent) => {
			e.preventDefault();
			setDragging(false);
			if (e.dataTransfer.files.length > 0) {
				handleFiles(e.dataTransfer.files);
			}
		},
		[handleFiles],
	);

	const removeFile = (index: number) => {
		setFiles((prev) => prev.filter((_, i) => i !== index));
	};

	const analyze = async () => {
		if (files.length === 0) return;
		setState("loading");
		setError(null);
		try {
			const data = await api.recommendations.analyze(files);
			// Parse jsonSchema strings into objects for display
			data.recommendations = data.recommendations.map((rec) => {
				if (typeof rec.jsonSchema === "string") {
					try {
						return { ...rec, jsonSchema: JSON.parse(rec.jsonSchema as unknown as string) };
					} catch {
						return rec;
					}
				}
				return rec;
			});
			setResult(data);
			setState("results");
		} catch (err) {
			setError(err instanceof Error ? err.message : "Analysis failed");
			setState("input");
		}
	};

	const acceptRecommendation = async (rec: SchemaRecommendation, index: number) => {
		try {
			await api.schemas.create({
				name: rec.name,
				description: rec.description,
				jsonSchema: rec.jsonSchema,
				classificationHints: rec.classificationHints,
			});
			setAccepted((prev) => new Set(prev).add(index));
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to create schema");
		}
	};

	const dismissRecommendation = (index: number) => {
		setDismissed((prev) => new Set(prev).add(index));
	};

	const reset = () => {
		setFiles([]);
		setResult(null);
		setError(null);
		setAccepted(new Set());
		setDismissed(new Set());
		setState("input");
	};

	if (state === "loading") {
		return (
			<div className="space-y-6">
				<h1 className="text-2xl font-bold">Schema Recommendations</h1>
				<div className="flex flex-col items-center justify-center py-20">
					<div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600 mb-4" />
					<p className="text-gray-600">Analyzing {files.length} document{files.length > 1 ? "s" : ""}...</p>
					<p className="text-sm text-gray-400 mt-1">This may take 10-30 seconds</p>
				</div>
			</div>
		);
	}

	if (state === "results" && result) {
		const visibleRecs = result.recommendations.filter(
			(_, i) => !dismissed.has(i),
		);

		return (
			<div className="space-y-6">
				<div className="flex justify-between items-center">
					<h1 className="text-2xl font-bold">Schema Recommendations</h1>
					<button
						onClick={reset}
						className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
					>
						Start Over
					</button>
				</div>

				<div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
					<p className="text-sm text-blue-800">{result.analysis}</p>
				</div>

				{error && <p className="text-red-600 text-sm">{error}</p>}

				{visibleRecs.length === 0 ? (
					<p className="text-gray-500">All recommendations have been handled.</p>
				) : (
					<div className="grid gap-4">
						{result.recommendations.map((rec, i) => {
							if (dismissed.has(i)) return null;
							const isAccepted = accepted.has(i);

							return (
								<div
									key={i}
									className={`bg-white rounded-lg border p-4 shadow-sm ${isAccepted ? "border-green-300 bg-green-50" : ""}`}
								>
									<div className="flex justify-between items-start">
										<div className="flex-1">
											<h3 className="font-semibold text-lg">
												{rec.name}
												{isAccepted && (
													<span className="ml-2 text-sm text-green-600 font-normal">
														Created
													</span>
												)}
											</h3>
											<p className="text-sm text-gray-600 mt-1">
												{rec.description}
											</p>
										</div>
										{!isAccepted && (
											<div className="flex gap-2 ml-4">
												<button
													onClick={() => acceptRecommendation(rec, i)}
													className="rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700"
												>
													Accept
												</button>
												<button
													onClick={() => dismissRecommendation(i)}
													className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
												>
													Dismiss
												</button>
											</div>
										)}
									</div>

									<p className="text-sm text-gray-500 mt-2 italic">
										{rec.reasoning}
									</p>

									{rec.matchingDocuments.length > 0 && (
										<div className="mt-2">
											<span className="text-xs text-gray-500">
												Matching documents:{" "}
											</span>
											{rec.matchingDocuments.map((doc) => (
												<span
													key={doc}
													className="inline-flex items-center rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600 mr-1"
												>
													{doc}
												</span>
											))}
										</div>
									)}

									{rec.classificationHints.length > 0 && (
										<div className="flex gap-1 mt-2">
											{rec.classificationHints.map((hint) => (
												<span
													key={hint}
													className="inline-flex items-center rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-700"
												>
													{hint}
												</span>
											))}
										</div>
									)}

									<details className="mt-3">
										<summary className="text-sm text-gray-500 cursor-pointer">
											JSON Schema
										</summary>
										<pre className="mt-2 text-xs bg-gray-50 p-3 rounded overflow-auto max-h-48">
											{JSON.stringify(rec.jsonSchema, null, 2)}
										</pre>
									</details>
								</div>
							);
						})}
					</div>
				)}
			</div>
		);
	}

	// Input state
	return (
		<div className="space-y-6">
			<h1 className="text-2xl font-bold">Schema Recommendations</h1>
			<p className="text-gray-600">
				Upload documents and let AI analyze them to recommend extraction schemas.
			</p>

			<div
				onDragOver={(e) => {
					e.preventDefault();
					setDragging(true);
				}}
				onDragLeave={() => setDragging(false)}
				onDrop={onDrop}
				className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
					dragging
						? "border-blue-500 bg-blue-50"
						: "border-gray-300 hover:border-gray-400"
				}`}
			>
				<input
					type="file"
					id="rec-file-upload"
					className="hidden"
					multiple
					onChange={(e) => {
						if (e.target.files) handleFiles(e.target.files);
						e.target.value = "";
					}}
				/>
				<label htmlFor="rec-file-upload" className="cursor-pointer">
					<p className="text-gray-600">
						Drag & drop files here, or click to select
					</p>
					<p className="text-sm text-gray-400 mt-1">
						PDF, DOCX, TXT, CSV, JSON, MD (up to 10 files)
					</p>
				</label>
			</div>

			{files.length > 0 && (
				<div className="space-y-2">
					<h3 className="text-sm font-medium text-gray-700">
						Selected files ({files.length}/10)
					</h3>
					<div className="space-y-1">
						{files.map((file, i) => (
							<div
								key={`${file.name}-${i}`}
								className="flex items-center justify-between bg-gray-50 rounded px-3 py-2"
							>
								<span className="text-sm text-gray-700 truncate">
									{file.name}
								</span>
								<button
									onClick={() => removeFile(i)}
									className="text-sm text-red-500 hover:text-red-700 ml-2"
								>
									Remove
								</button>
							</div>
						))}
					</div>
				</div>
			)}

			{error && <p className="text-red-600 text-sm">{error}</p>}

			<button
				onClick={analyze}
				disabled={files.length === 0}
				className="rounded-md bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
			>
				Analyze Documents
			</button>
		</div>
	);
}
