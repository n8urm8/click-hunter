import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import "./app.css";
import Home from "./routes/home";

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL);
const queryClient = new QueryClient();

const router = createBrowserRouter([
  {
    path: "/",
    Component: Home,
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
