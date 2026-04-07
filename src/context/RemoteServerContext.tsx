import { createContext, useContext, useState, useCallback } from "react";

export interface ActiveServer {
  id: number;
  name: string;
  ip: string;
  username: string;
}

interface RemoteServerCtx {
  activeServer: ActiveServer | null;
  connect: (server: ActiveServer) => void;
  disconnect: () => void;
}

const RemoteServerContext = createContext<RemoteServerCtx>({
  activeServer: null,
  connect: () => {},
  disconnect: () => {},
});

const STORAGE_KEY = "vpsm_active_server";

export function RemoteServerProvider({ children }: { children: React.ReactNode }) {
  const [activeServer, setActiveServer] = useState<ActiveServer | null>(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      return saved ? (JSON.parse(saved) as ActiveServer) : null;
    } catch {
      return null;
    }
  });

  const connect = useCallback((server: ActiveServer) => {
    setActiveServer(server);
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(server)); } catch {}
  }, []);

  const disconnect = useCallback(() => {
    setActiveServer(null);
    try { sessionStorage.removeItem(STORAGE_KEY); } catch {}
  }, []);

  return (
    <RemoteServerContext.Provider value={{ activeServer, connect, disconnect }}>
      {children}
    </RemoteServerContext.Provider>
  );
}

export const useRemoteServer = () => useContext(RemoteServerContext);
