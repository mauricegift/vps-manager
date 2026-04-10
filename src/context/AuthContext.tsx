import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import axios from "axios";

interface User {
  id: number;
  username: string;
  email: string;
  created_at: string;
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  loading: boolean;
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  register: (username: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshAccessToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const LS_ACCESS = "vpsm_access_token";
const LS_REFRESH = "vpsm_refresh_token";
const BASE = "/api/auth";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    accessToken: localStorage.getItem(LS_ACCESS),
    loading: true,
  });

  const setTokens = (access: string, refresh: string) => {
    localStorage.setItem(LS_ACCESS, access);
    localStorage.setItem(LS_REFRESH, refresh);
    setState(s => ({ ...s, accessToken: access }));
  };

  const clearTokens = useCallback(() => {
    localStorage.removeItem(LS_ACCESS);
    localStorage.removeItem(LS_REFRESH);
    setState({ user: null, accessToken: null, loading: false });
  }, []);

  const refreshAccessToken = useCallback(async (): Promise<string | null> => {
    const rt = localStorage.getItem(LS_REFRESH);
    if (!rt) return null;
    try {
      const { data } = await axios.post(`${BASE}/refresh`, { refreshToken: rt });
      if (data.success) {
        setTokens(data.data.accessToken, data.data.refreshToken);
        return data.data.accessToken;
      }
    } catch {
      clearTokens();
    }
    return null;
  }, [clearTokens]);

  // Listen for the api.ts interceptor signalling session expiry
  useEffect(() => {
    const handler = () => clearTokens();
    window.addEventListener("auth:session-expired", handler);
    return () => window.removeEventListener("auth:session-expired", handler);
  }, [clearTokens]);

  // On mount — validate stored access token, or try to refresh
  useEffect(() => {
    const at = localStorage.getItem(LS_ACCESS);
    if (!at) { setState(s => ({ ...s, loading: false })); return; }

    axios.get(`${BASE}/me`, { headers: { Authorization: `Bearer ${at}` } })
      .then(({ data }) => {
        if (data.success) setState({ user: data.data.user, accessToken: at, loading: false });
        else clearTokens();
      })
      .catch(async (err) => {
        if (err.response?.status === 401) {
          const newAt = await refreshAccessToken();
          if (newAt) {
            try {
              const { data } = await axios.get(`${BASE}/me`, { headers: { Authorization: `Bearer ${newAt}` } });
              if (data.success) setState({ user: data.data.user, accessToken: newAt, loading: false });
              else clearTokens();
            } catch { clearTokens(); }
          } else {
            // Refresh token also gone — clear and let router handle redirect
            clearTokens();
          }
        } else {
          clearTokens();
        }
      });
  }, [refreshAccessToken, clearTokens]);

  const login = async (email: string, password: string) => {
    const { data } = await axios.post(`${BASE}/login`, { email, password });
    if (!data.success) throw new Error(data.error || "Login failed");
    setTokens(data.data.accessToken, data.data.refreshToken);
    setState({ user: data.data.user, accessToken: data.data.accessToken, loading: false });
  };

  // Used for initial setup (first-ever user — no auth header needed)
  const register = async (username: string, email: string, password: string) => {
    const { data } = await axios.post(`${BASE}/register`, { username, email, password });
    if (!data.success) throw new Error(data.error || "Registration failed");
    setTokens(data.data.accessToken, data.data.refreshToken);
    setState({ user: data.data.user, accessToken: data.data.accessToken, loading: false });
  };

  const logout = async () => {
    const rt = localStorage.getItem(LS_REFRESH);
    await axios.post(`${BASE}/logout`, { refreshToken: rt }).catch(() => {});
    clearTokens();
  };

  return (
    <AuthContext.Provider value={{ ...state, login, register, logout, refreshAccessToken }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
