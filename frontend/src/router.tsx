import { lazy, Suspense, type ReactNode } from "react";
import {
	Navigate,
	type RouteObject,
	createBrowserRouter,
} from "react-router-dom";
import App from "./App";

const Documents = lazy(() =>
	import("./pages/Documents").then((m) => ({ default: m.Documents })),
);
const Schemas = lazy(() =>
	import("./pages/Schemas").then((m) => ({ default: m.Schemas })),
);
const DocumentDetail = lazy(() =>
	import("./pages/DocumentDetail").then((m) => ({
		default: m.DocumentDetail,
	})),
);
const SchemaWorkbenchPage = lazy(() =>
	import("./pages/SchemaWorkbenchPage").then((m) => ({
		default: m.SchemaWorkbenchPage,
	})),
);
const NotFound = lazy(() =>
	import("./pages/NotFound").then((m) => ({ default: m.NotFound })),
);

const Admin = lazy(() =>
	import("./pages/Admin").then((m) => ({ default: m.Admin })),
);

function withSuspense(node: ReactNode) {
	return <Suspense fallback={<p>Loading...</p>}>{node}</Suspense>;
}

export const appRoutes: RouteObject[] = [
	{
		path: "/",
		element: <App />,
		children: [
			{
				index: true,
				element: <Navigate to="/documents" replace />,
			},
			{
				path: "documents",
				element: withSuspense(<Documents />),
			},
			{
				path: "documents/:documentId",
				element: withSuspense(<DocumentDetail />),
			},
			{
				path: "schemas",
				element: withSuspense(<Schemas />),
			},
			{
				path: "schemas/new",
				element: withSuspense(<SchemaWorkbenchPage mode="create" />),
			},
			{
				path: "schemas/:schemaId/edit",
				element: withSuspense(<SchemaWorkbenchPage mode="edit" />),
			},
			{
				path: "admin",
				element: withSuspense(<Admin />),
			},
			{
				path: "*",
				element: withSuspense(<NotFound />),
			},
		],
	},
];

export function createAppRouter() {
	return createBrowserRouter(appRoutes);
}
