import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import {
  createBrowserRouter,
  Navigate,
  RouterProvider,
} from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConvexQueryClient } from "@convex-dev/react-query";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import "./app.css";
import GameShell from "./routes/game";
import Home from "./routes/home";
import Profile from "./routes/profile";
import CombatPage from "./routes/combat";
import SkillsPage from "./routes/skills";
import TreePage from "./routes/tree";
import BazaarPage from "./routes/bazaar";
import InventoryPage from "./routes/inventory";
import RebirthPage from "./routes/rebirth";
import BoardPage from "./routes/board";
import AdminPage from "./routes/admin";
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

const router = createBrowserRouter([
  {
    path: "/",
    Component: GameShell,
    children: [
      { index: true, Component: Home },
      { path: "combat", Component: CombatPage },
      { path: "skills", Component: SkillsPage },
      { path: "skills/:skillId", Component: SkillsPage },
      { path: "tree", Component: TreePage },
      {
        path: "bazaar",
        Component: () => (
          <Navigate to={`${GAME_PATHS.bazaar}/browse`} replace />
        ),
      },
      { path: "bazaar/:view", Component: BazaarPage },
      { path: "inventory", Component: InventoryPage },
      { path: "inventory/:tab", Component: InventoryPage },
      { path: "rebirth", Component: RebirthPage },
      { path: "board", Component: BoardPage },
      { path: "admin", Component: AdminPage },
      { path: "profile", Component: Profile },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ConvexProvider client={convex}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ConvexProvider>
  </StrictMode>
);
