import { StrictMode, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import {
  createBrowserRouter,
  Navigate,
  RouterProvider,
} from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConvexQueryClient } from "@convex-dev/react-query";
import { ConvexReactClient } from "convex/react";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import "./app.css";
import GameShell from "./routes/game";
import { CONVEX_QUERY_GC_TIME } from "./lib/queryCache";
import { GAME_PATHS } from "./lib/gameRoutes";

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL);
const convexQueryClient = new ConvexQueryClient(convex);
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryKeyHashFn: convexQueryClient.hashFn(),
      queryFn: convexQueryClient.queryFn(),
      staleTime: Infinity,
      gcTime: CONVEX_QUERY_GC_TIME,
    },
  },
});
convexQueryClient.connect(queryClient);

/** Load a page's code when it's first visited, so nobody downloads the admin panel to play. */
function page(load: () => Promise<{ default: ComponentType }>) {
  return async () => ({ Component: (await load()).default });
}

const router = createBrowserRouter([
  {
    path: "/",
    Component: GameShell,
    children: [
      { index: true, lazy: page(() => import("./routes/home")) },
      { path: "combat", lazy: page(() => import("./routes/combat")) },
      { path: "skills", lazy: page(() => import("./routes/skills")) },
      { path: "skills/:skillId", lazy: page(() => import("./routes/skills")) },
      { path: "tree", lazy: page(() => import("./routes/tree")) },
      {
        path: "bazaar",
        Component: () => (
          <Navigate to={`${GAME_PATHS.bazaar}/browse`} replace />
        ),
      },
      { path: "bazaar/:view", lazy: page(() => import("./routes/bazaar")) },
      { path: "inventory", lazy: page(() => import("./routes/inventory")) },
      { path: "inventory/:tab", lazy: page(() => import("./routes/inventory")) },
      { path: "rebirth", lazy: page(() => import("./routes/rebirth")) },
      { path: "board", lazy: page(() => import("./routes/board")) },
      {
        path: "guild",
        Component: () => (
          <Navigate to={`${GAME_PATHS.guild}/hall`} replace />
        ),
      },
      { path: "guild/:view", lazy: page(() => import("./routes/guild")) },
      { path: "arena", lazy: page(() => import("./routes/arena")) },
      { path: "admin", lazy: page(() => import("./routes/admin")) },
      { path: "profile", lazy: page(() => import("./routes/profile")) },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ConvexAuthProvider client={convex}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ConvexAuthProvider>
  </StrictMode>
);
