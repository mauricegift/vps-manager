import { Route, Routes, Outlet } from "react-router-dom";
import { ToastContainer } from "react-toastify";
import Layout from "@/components/layout/Layout";
import PublicLayout from "@/components/layout/PublicLayout";
import ProtectedRoute from "@/components/ui/ProtectedRoute";
import GuestRoute from "@/components/ui/GuestRoute";
import SetupRoute from "@/components/ui/SetupRoute";

import Dashboard from "@/pages/Dashboard";
import PM2Page from "@/pages/PM2";
import DockerPage from "@/pages/Docker";
import DatabasesPage from "@/pages/Databases";
import FileManagerPage from "@/pages/FileManager";
import TerminalPage from "@/pages/Terminal";
import ServersPage from "@/pages/Servers";
import ExtrasPage from "@/pages/Extras";
import NginxPage from "@/pages/Nginx";
import NotFoundPage from "@/pages/NotFound";

import LoginPage from "@/pages/auth/Login";
import RegisterPage from "@/pages/auth/Register";
import ForgotPasswordPage from "@/pages/auth/ForgotPassword";
import ResetPasswordPage from "@/pages/auth/ResetPassword";
import SettingsPage from "@/pages/Settings";
import LandingPage from "@/pages/public/Landing";
import AboutPage from "@/pages/public/About";
import TermsPage from "@/pages/public/Terms";
import PrivacyPage from "@/pages/public/Privacy";
import ContactPage from "@/pages/public/Contact";

// All pages that share the public header/footer
function PublicWrapper() {
  return (
    <PublicLayout>
      <Outlet />
    </PublicLayout>
  );
}

export default function App() {
  return (
    <>
      <ToastContainer
        position="top-right"
        autoClose={3500}
        hideProgressBar={false}
        newestOnTop
        closeOnClick
        pauseOnHover
        draggable
        theme="dark"
      />
      <Routes>
        {/* ── Routes wrapped in PublicLayout (header + footer) ─────────── */}
        <Route element={<PublicWrapper />}>
          {/* Public info pages */}
          <Route path="/home" element={<LandingPage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="/terms" element={<TermsPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/contact" element={<ContactPage />} />

          {/* Auth pages — redirect to / if already logged in */}
          <Route
            path="/login"
            element={
              <GuestRoute>
                <LoginPage />
              </GuestRoute>
            }
          />

          {/* Register — only accessible during first-time setup (no users), else 404 */}
          <Route
            path="/register"
            element={
              <SetupRoute>
                <RegisterPage />
              </SetupRoute>
            }
          />

          {/* Auth helpers */}
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />

          {/* Catch-all 404 — any unknown URL */}
          <Route path="*" element={<NotFoundPage />} />
        </Route>

        {/* ── Protected pages (app layout, requires auth) ───────────────── */}
        <Route
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route path="/" element={<Dashboard />} />
          <Route path="/pm2" element={<PM2Page />} />
          <Route path="/docker" element={<DockerPage />} />
          <Route path="/databases" element={<DatabasesPage />} />
          <Route path="/files" element={<FileManagerPage />} />
          <Route path="/terminal" element={<TerminalPage />} />
          <Route path="/servers" element={<ServersPage />} />
          <Route path="/extras" element={<ExtrasPage />} />
          <Route path="/nginx" element={<NginxPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </>
  );
}
