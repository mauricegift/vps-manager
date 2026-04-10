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

import LoginPage from "@/pages/auth/Login";
import RegisterPage from "@/pages/auth/Register";
import LandingPage from "@/pages/public/Landing";
import AboutPage from "@/pages/public/About";
import TermsPage from "@/pages/public/Terms";
import PrivacyPage from "@/pages/public/Privacy";
import ContactPage from "@/pages/public/Contact";

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
        {/* ── Auth pages (standalone, redirect to / if already logged in) ── */}
        <Route
          path="/login"
          element={
            <GuestRoute>
              <LoginPage />
            </GuestRoute>
          }
        />

        {/* /register: only if setup required (no users yet) OR already logged in */}
        <Route
          path="/register"
          element={
            <SetupRoute>
              <RegisterPage />
            </SetupRoute>
          }
        />

        {/* ── Public pages (public header/footer) ──────────────────────── */}
        <Route element={<PublicWrapper />}>
          <Route path="/home" element={<LandingPage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="/terms" element={<TermsPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/contact" element={<ContactPage />} />
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
        </Route>
      </Routes>
    </>
  );
}
