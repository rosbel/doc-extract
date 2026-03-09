const STATUS_COLORS: Record<string, string> = {
	pending: "bg-yellow-100 text-yellow-800",
	classifying: "bg-blue-100 text-blue-800",
	extracting: "bg-indigo-100 text-indigo-800",
	completed: "bg-green-100 text-green-800",
	unclassified: "bg-amber-100 text-amber-800",
	failed: "bg-red-100 text-red-800",
	duplicate: "bg-gray-100 text-gray-800",
};

export function StatusBadge({ status }: { status: string }) {
	const color = STATUS_COLORS[status] || "bg-gray-100 text-gray-800";
	return (
		<span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${color}`}>
			{status}
		</span>
	);
}
