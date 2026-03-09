const STEPS = [
	{ key: "uploaded", label: "Uploaded" },
	{ key: "classifying", label: "Classifying" },
	{ key: "extracting", label: "Extracting" },
	{ key: "completed", label: "Complete" },
] as const;

type StepState = "completed" | "active" | "pending" | "failed" | "stalled";

interface ProcessingStepperProps {
	status: string;
	isStuck: boolean;
}

function getActiveIndex(status: string): number {
	switch (status) {
		case "pending":
			return 0;
		case "classifying":
			return 1;
		case "extracting":
			return 2;
		case "completed":
			return 3;
		case "failed":
		case "duplicate":
		default:
			return -1;
	}
}

function getStepStates(status: string, isStuck: boolean): StepState[] {
	if (status === "completed") {
		return ["completed", "completed", "completed", "completed"];
	}

	if (status === "duplicate") {
		return ["completed", "pending", "pending", "pending"];
	}

	const activeIndex = getActiveIndex(status);

	if (status === "failed") {
		// For failed, we don't know which step failed from status alone,
		// so show uploaded as done and the rest as failed/pending.
		// A more precise approach would use job data, but we mark step 1 as failed.
		return STEPS.map((_, i) => {
			if (i === 0) return "completed";
			if (i === 1) return "failed";
			return "pending";
		});
	}

	return STEPS.map((_, i) => {
		if (i < activeIndex) return "completed";
		if (i === activeIndex) return isStuck ? "stalled" : "active";
		return "pending";
	});
}

function StepIcon({ state }: { state: StepState }) {
	switch (state) {
		case "completed":
			return (
				<svg className="w-4 h-4 text-white" viewBox="0 0 20 20" fill="currentColor">
					<path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
				</svg>
			);
		case "failed":
			return (
				<svg className="w-4 h-4 text-white" viewBox="0 0 20 20" fill="currentColor">
					<path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
				</svg>
			);
		case "stalled":
			return (
				<svg className="w-4 h-4 text-white" viewBox="0 0 20 20" fill="currentColor">
					<path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
				</svg>
			);
		case "active":
			return <span className="w-2.5 h-2.5 rounded-full bg-white" />;
		case "pending":
			return <span className="w-2.5 h-2.5 rounded-full bg-gray-300" />;
	}
}

const circleClasses: Record<StepState, string> = {
	completed: "bg-green-500",
	active: "bg-blue-500 shadow-[0_0_0_4px_rgba(59,130,246,0.3)] animate-pulse",
	pending: "bg-gray-200",
	failed: "bg-red-500",
	stalled: "bg-amber-500",
};

const labelClasses: Record<StepState, string> = {
	completed: "text-green-700",
	active: "text-blue-700 font-medium",
	pending: "text-gray-400",
	failed: "text-red-700 font-medium",
	stalled: "text-amber-700 font-medium",
};

export function ProcessingStepper({ status, isStuck }: ProcessingStepperProps) {
	const stepStates = getStepStates(status, isStuck);

	const getLabelOverride = (index: number): string | null => {
		if (status === "duplicate" && index === 1) return "Duplicate";
		return null;
	};

	return (
		<div className="bg-white rounded-lg border p-4">
			<div className="flex items-center">
				{STEPS.map((step, i) => (
					<div key={step.key} className="flex items-center flex-1 last:flex-none">
						{/* Step circle + label */}
						<div className="flex flex-col items-center">
							<div
								className={`w-8 h-8 rounded-full flex items-center justify-center ${circleClasses[stepStates[i]]}`}
							>
								<StepIcon state={stepStates[i]} />
							</div>
							<span className={`text-xs mt-1.5 whitespace-nowrap ${labelClasses[stepStates[i]]}`}>
								{getLabelOverride(i) ?? step.label}
							</span>
						</div>
						{/* Connector line (not after last step) */}
						{i < STEPS.length - 1 && (
							<div className="flex-1 mx-2 self-start mt-4">
								{stepStates[i] === "completed" && stepStates[i + 1] !== "pending" ? (
									<div className="h-0.5 bg-green-500" />
								) : (
									<div className="border-t-2 border-dashed border-gray-300" />
								)}
							</div>
						)}
					</div>
				))}
			</div>
		</div>
	);
}
