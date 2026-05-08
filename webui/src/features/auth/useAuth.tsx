import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

type AuthContextValue = {
  loading: boolean;
  authenticated: boolean;
  username: string;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

async function readJson(resp: Response): Promise<Record<string, unknown>> {
  const text = await resp.text();
  if (!text.trim()) return {};
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [username, setUsername] = useState("");

  const refresh = useCallback(async () => {
    const resp = await fetch("/api/mah/auth/status", { method: "GET", credentials: "include" });
    const data = await readJson(resp);
    if (!resp.ok || !data.ok) {
      setAuthenticated(false);
      setUsername("");
      return;
    }
    const nextAuthenticated = Boolean(data.authenticated);
    setAuthenticated(nextAuthenticated);
    setUsername(nextAuthenticated ? `${data.username || ""}` : "");
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await refresh();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const login = useCallback(async (nextUsername: string, password: string) => {
    const resp = await fetch("/api/mah/auth/login", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: nextUsername, password }),
    });
    const data = await readJson(resp);
    if (!resp.ok || !data.ok) {
      throw new Error(`${data.error || "login failed"}`);
    }
    await refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    await fetch("/api/mah/auth/logout", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    });
    setAuthenticated(false);
    setUsername("");
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    loading,
    authenticated,
    username,
    login,
    logout,
    refresh,
  }), [authenticated, loading, login, logout, refresh, username]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
