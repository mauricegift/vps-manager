import { StrictMode, useEffect, Component, ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "react-toastify/dist/ReactToastify.css";
import App from "./App.tsx";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, useLocation } from "react-router-dom";
import AOS from "aos";
import "aos/dist/aos.css";
import { ThemeProvider } from "./context/ThemeContext";
import { RemoteServerProvider } from "./context/RemoteServerContext";
import { AuthProvider } from "./context/AuthContext";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 10_000 } },
});

// Refresh AOS on every route change so elements animate in correctly
function AOSRouteRefresh() {
  const { pathname } = useLocation();
  useEffect(() => {
    const t = setTimeout(() => AOS.refresh(), 80);
    return () => clearTimeout(t);
  }, [pathname]);
  return null;
}

// Error boundary — catches white pages from component errors
class ErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null };
  static getDerivedStateFromError(e: Error) { return { error: e.message }; }
  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-8 text-center">
          <div className="text-4xl">⚠️</div>
          <h1 className="text-lg font-bold">Something went wrong</h1>
          <p className="text-sm text-[var(--muted)] max-w-sm">{this.state.error}</p>
          <button
            onClick={() => { this.setState({ error: null }); window.location.href = "/"; }}
            className="px-5 py-2 rounded-xl bg-[var(--accent)] text-white text-sm"
          >
            Back to Dashboard
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function Root() {
  useEffect(() => {
    AOS.init({
      duration: 400,
      easing: "ease-out-cubic",
      once: true,
      offset: 20,
    });
  }, []);

  return (
    <ErrorBoundary>
      <AOSRouteRefresh />
      <App />
    </ErrorBoundary>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <BrowserRouter>
        <AuthProvider>
          <RemoteServerProvider>
            <QueryClientProvider client={queryClient}>
              <Root />
            </QueryClientProvider>
          </RemoteServerProvider>
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  </StrictMode>
);
