import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConvexQueryClient } from "@convex-dev/react-query";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import "./app.css";
import Home from "./routes/home";
import Profile from "./routes/profile";
import { CONVEX_QUERY_GC_TIME } from "./lib/queryCache";

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
    Component: Home,
  },
  {
    path: "/profile",
    Component: Profile,
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
