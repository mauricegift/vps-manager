import { Route, Routes } from "react-router-dom";
import { ToastContainer } from "react-toastify";
import Layout from "@/components/layout/Layout";
import Dashboard from "@/pages/Dashboard";
import PM2Page from "@/pages/PM2";
import DockerPage from "@/pages/Docker";
import DatabasesPage from "@/pages/Databases";
import FileManagerPage from "@/pages/FileManager";
import TerminalPage from "@/pages/Terminal";
import ServersPage from "@/pages/Servers";
import ExtrasPage from "@/pages/Extras";

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
        <Route element={<Layout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/pm2" element={<PM2Page />} />
          <Route path="/docker" element={<DockerPage />} />
          <Route path="/databases" element={<DatabasesPage />} />
          <Route path="/files" element={<FileManagerPage />} />
          <Route path="/terminal" element={<TerminalPage />} />
          <Route path="/servers" element={<ServersPage />} />
          <Route path="/extras" element={<ExtrasPage />} />
        </Route>
      </Routes>
    </>
  );
}
