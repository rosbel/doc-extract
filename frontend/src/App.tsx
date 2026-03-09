import { NavLink, Outlet } from "react-router-dom";

function navLinkClassName({ isActive }: { isActive: boolean }) {
	return `rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
		isActive
			? "bg-sky-100 text-sky-700"
			: "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
	}`;
}

export default function App() {
	return (
		<div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(14,165,233,0.08),_transparent_38%),linear-gradient(180deg,_#f8fafc_0%,_#eef2ff_100%)]">
			<nav className="border-b border-slate-200 bg-white/80 shadow-sm backdrop-blur">
				<div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4">
					<NavLink
						to="/documents"
						className="text-lg font-bold tracking-tight text-slate-900"
					>
						DocExtract
					</NavLink>
					<NavLink to="/documents" className={navLinkClassName}>
						Documents
					</NavLink>
					<NavLink to="/schemas" className={navLinkClassName}>
						Schemas
					</NavLink>
				</div>
			</nav>

			<main className="mx-auto max-w-6xl px-4 py-8">
				<Outlet />
			</main>
		</div>
	);
}
