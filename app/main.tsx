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
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { ClerkProvider, useAuth } from "@clerk/react";
import "./app.css";
import GameShell from "./routes/game";
import { CONVEX_QUERY_GC_TIME } from "./lib/queryCache";
import { GAME_PATHS } from "./lib/gameRoutes";

const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
if (!clerkPublishableKey) {
  throw new Error(
    "VITE_CLERK_PUBLISHABLE_KEY is not set. Add the Clerk publishable key to the web app's environment."
  );
}

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
  // Public landing page, outside the game shell so visitors see it signed out.
  { path: "/", lazy: page(() => import("./routes/landing")) },
  {
    // Pathless layout: every game screen shares the player gate and frame.
    Component: GameShell,
    children: [
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
    <ClerkProvider publishableKey={clerkPublishableKey}>
      <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </ConvexProviderWithClerk>
    </ClerkProvider>
  </StrictMode>
);
