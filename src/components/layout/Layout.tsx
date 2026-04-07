import { useState } from "react";
import { Outlet } from "react-router-dom";
import Header from "./Header";
import Footer from "./Footer";
import MobileSidebar from "./MobileSidebar";
import Pattern from "@/components/ui/Pattern";
import { useRemoteServer } from "@/context/RemoteServerContext";

export default function Layout() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { activeServer } = useRemoteServer();

  return (
    <Pattern>
      <div className="flex flex-col min-h-screen">
        <Header onMenuToggle={() => setMenuOpen((o) => !o)} menuOpen={menuOpen} />
        <MobileSidebar open={menuOpen} onClose={() => setMenuOpen(false)} />
        <main className={`flex-1 pb-6 ${activeServer ? "pt-28 sm:pt-32" : "pt-20 sm:pt-24"}`}>
          <Outlet />
        </main>
        <Footer />
      </div>
    </Pattern>
  );
}
