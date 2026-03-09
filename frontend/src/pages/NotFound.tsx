import { Link, useLocation } from "react-router-dom";

export function NotFound() {
	const location = useLocation();

	return (
		<section className="relative overflow-hidden rounded-[2rem] border border-slate-200 bg-white/90 px-6 py-12 shadow-xl shadow-slate-200/60 sm:px-10">
			<div className="absolute inset-y-0 right-0 hidden w-1/3 bg-[radial-gradient(circle_at_top,_rgba(14,165,233,0.16),_transparent_58%)] lg:block" />
			<div className="relative max-w-3xl">
				<p className="text-sm font-medium uppercase tracking-[0.24em] text-sky-700">
					Error 404
				</p>
				<h1 className="mt-4 text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
					This route does not exist.
				</h1>
				<p className="mt-4 max-w-2xl text-base leading-7 text-slate-600">
					We could not find <span className="font-semibold text-slate-900">{location.pathname}</span>.
					Try returning to the document workspace or the schema library.
				</p>
				<div className="mt-8 flex flex-wrap gap-3">
					<Link
						to="/documents"
						className="rounded-full bg-sky-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-sky-200 transition hover:bg-sky-700"
					>
						Go to Documents
					</Link>
					<Link
						to="/schemas"
						className="rounded-full border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-400 hover:bg-slate-50"
					>
						Browse Schemas
					</Link>
				</div>
				<div className="mt-10 rounded-2xl border border-slate-200 bg-slate-50/80 p-5">
					<p className="text-sm font-semibold text-slate-900">Possible causes</p>
					<p className="mt-2 text-sm leading-6 text-slate-600">
						The URL may be outdated, mistyped, or pointing to a page that has been removed.
					</p>
				</div>
			</div>
		</section>
	);
}
