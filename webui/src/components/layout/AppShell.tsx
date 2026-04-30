import { useCallback, useEffect, useRef, useState } from "react";
import { Outlet, useLocation } from "react-router";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { HeaderBar } from "./HeaderBar";
import { Sidebar } from "./Sidebar";
import { Icon } from "../ui/Icon";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import { GLOBAL_CONSOLE_OPEN_EVENT, type GlobalConsoleOpenRequest } from "../../features/console/consoleBridge";
import { useAuth } from "../../features/auth/useAuth";
import "@xterm/xterm/css/xterm.css";

const routeToNavItem: Record<string, string> = {
  "/": "Overview",
  "/bootstrap": "Bootstrap",
  "/sessions": "Sessions",
  "/config": "Config",
  "/run": "Run",
  "/tasks": "Tasks",
  "/crews": "Crews",
  "/settings": "Settings",
  "/expertise": "Expertise",
  "/skills": "Skills",
  "/context": "Context",
  "/sync": "Sync",
};

export function AppShell() {
  const location = useLocation();
  const activeItem = routeToNavItem[location.pathname] ?? "Overview";
  const { workspace, loading } = useWorkspace();
  const { logout } = useAuth();
  const allowWithoutConfig = location.pathname === "/settings" || location.pathname === "/bootstrap";
  const showEmptyWorkspace = !loading && !allowWithoutConfig && workspace?.configExists === false;
  const [terminalRuntime, setTerminalRuntime] = useState("");
  const [terminalSessionId, setTerminalSessionId] = useState("");
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalMinimized, setTerminalMinimized] = useState(false);
  const [terminalId, setTerminalId] = useState("");
  const [terminalClosed, setTerminalClosed] = useState(false);
  const [terminalExitCode, setTerminalExitCode] = useState<number | null>(null);
  const terminalIdRef = useRef("");
  const eventSourceRef = useRef<EventSource | null>(null);
  const resizeDebounceRef = useRef<number | null>(null);
  const terminalHostRef = useRef<HTMLDivElement | null>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  const closeTerminalStream = useCallback(() => {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
  }, []);

  const sendTerminalResize = useCallback(async (cols: number, rows: number, currentTerminalId = terminalId) => {
    if (!currentTerminalId || cols <= 0 || rows <= 0) return;
    try {
      await fetch(`/api/mah/terminal/resize/${encodeURIComponent(currentTerminalId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cols, rows }),
      });
    } catch {
      // ignore transient resize errors
    }
  }, [terminalId]);

  const sendTerminalInput = useCallback(async (text: string, currentTerminalId = terminalId) => {
    if (!currentTerminalId || !text) return;
    try {
      await fetch(`/api/mah/terminal/input/${encodeURIComponent(currentTerminalId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: text }),
      });
    } catch {
      xtermRef.current?.writeln("\r\n[connection] failed to send input");
    }
  }, [terminalId]);

  useEffect(() => {
    terminalIdRef.current = terminalId;
  }, [terminalId]);

  const closeTerminalModal = useCallback((nextTerminalId?: string) => {
    const targetTerminalId = nextTerminalId ?? terminalIdRef.current;
    closeTerminalStream();
    if (targetTerminalId) {
      fetch(`/api/mah/terminal/close/${encodeURIComponent(targetTerminalId)}`, {
        method: "POST",
      }).catch(() => {
        // ignore close failures
      });
    }
    setTerminalOpen(false);
    setTerminalMinimized(false);
    setTerminalId("");
    setTerminalClosed(false);
    setTerminalExitCode(null);
    xtermRef.current?.dispose();
    xtermRef.current = null;
    fitAddonRef.current = null;
    if (resizeDebounceRef.current !== null) {
      window.clearTimeout(resizeDebounceRef.current);
      resizeDebounceRef.current = null;
    }
  }, [closeTerminalStream]);

  const openTerminal = useCallback(async (runtime: string, sessionId: string) => {
    const nextRuntime = `${runtime || ""}`.trim().toLowerCase();
    const nextSessionId = `${sessionId || ""}`.trim();
    if (!nextRuntime || !nextSessionId) throw new Error("runtime and sessionId are required");

    const previousTerminalId = terminalId;
    closeTerminalStream();
    if (previousTerminalId) {
      fetch(`/api/mah/terminal/close/${encodeURIComponent(previousTerminalId)}`, {
        method: "POST",
      }).catch(() => {});
    }

    const resp = await fetch("/api/mah/terminal/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runtime: nextRuntime, sessionId: nextSessionId }),
    });
    const data = await resp.json();
    if (!resp.ok || !data.ok || !data.terminalId) {
      const hint = resp.status === 404 ? " (dica: reinicie `npm run dev` do webui após mudar o vite.config.ts)" : "";
      throw new Error(`${data.error || `failed to open terminal (HTTP ${resp.status})`}${hint}`);
    }

    const nextTerminalId = `${data.terminalId}`;
    setTerminalRuntime(nextRuntime);
    setTerminalSessionId(nextSessionId);
    setTerminalId(nextTerminalId);
    setTerminalMinimized(false);
    setTerminalClosed(false);
    setTerminalExitCode(null);
    setTerminalOpen(true);
    localStorage.setItem("mah:last-console-target", JSON.stringify({ runtime: nextRuntime, sessionId: nextSessionId }));

    const source = new EventSource(`/api/mah/terminal/stream/${encodeURIComponent(nextTerminalId)}`);
    source.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data || "{}") as {
          type?: string;
          text?: string;
          code?: number | null;
          message?: string;
        };
        if (payload.type === "output" && typeof payload.text === "string") {
          xtermRef.current?.write(payload.text);
          return;
        }
        if (payload.type === "error" && payload.message) {
          xtermRef.current?.writeln(`\r\n[bridge error] ${payload.message}`);
          return;
        }
        if (payload.type === "exit") {
          setTerminalClosed(true);
          setTerminalExitCode(typeof payload.code === "number" ? payload.code : null);
          source.close();
          eventSourceRef.current = null;
        }
      } catch {
        // ignore malformed stream events
      }
    };
    source.onerror = () => {
      xtermRef.current?.writeln("\r\n[connection] stream interrupted");
    };
    eventSourceRef.current = source;
    window.setTimeout(() => {
      const terminal = xtermRef.current;
      if (!terminal) return;
      const cols = terminal.cols;
      const rows = terminal.rows;
      if (cols > 0 && rows > 0) {
        void sendTerminalResize(cols, rows, nextTerminalId);
      }
    }, 0);
  }, [closeTerminalStream, sendTerminalResize, terminalId]);

  const openWorkspaceShellTerminal = useCallback(async () => {
    const previousTerminalId = terminalId;
    closeTerminalStream();
    if (previousTerminalId) {
      fetch(`/api/mah/terminal/close/${encodeURIComponent(previousTerminalId)}`, {
        method: "POST",
      }).catch(() => {});
    }

    const resp = await fetch("/api/mah/terminal/open-shell", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const data = await resp.json();
    if (!resp.ok || !data.ok || !data.terminalId) {
      const hint = resp.status === 404 ? " (dica: reinicie `npm run dev` do webui após mudar o vite.config.ts)" : "";
      throw new Error(`${data.error || `failed to open terminal (HTTP ${resp.status})`}${hint}`);
    }

    const nextTerminalId = `${data.terminalId}`;
    setTerminalRuntime("shell");
    setTerminalSessionId("workspace");
    setTerminalId(nextTerminalId);
    setTerminalMinimized(false);
    setTerminalClosed(false);
    setTerminalExitCode(null);
    setTerminalOpen(true);

    const source = new EventSource(`/api/mah/terminal/stream/${encodeURIComponent(nextTerminalId)}`);
    source.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data || "{}") as {
          type?: string;
          text?: string;
          code?: number | null;
          message?: string;
        };
        if (payload.type === "output" && typeof payload.text === "string") {
          xtermRef.current?.write(payload.text);
          return;
        }
        if (payload.type === "error" && payload.message) {
          xtermRef.current?.writeln(`\r\n[bridge error] ${payload.message}`);
          return;
        }
        if (payload.type === "exit") {
          setTerminalClosed(true);
          setTerminalExitCode(typeof payload.code === "number" ? payload.code : null);
          source.close();
          eventSourceRef.current = null;
        }
      } catch {
        // ignore malformed stream events
      }
    };
    source.onerror = () => {
      xtermRef.current?.writeln("\r\n[connection] stream interrupted");
    };
    eventSourceRef.current = source;
    window.setTimeout(() => {
      const terminal = xtermRef.current;
      if (!terminal) return;
      const cols = terminal.cols;
      const rows = terminal.rows;
      if (cols > 0 && rows > 0) {
        void sendTerminalResize(cols, rows, nextTerminalId);
      }
    }, 0);
  }, [closeTerminalStream, sendTerminalResize, terminalId]);

  useEffect(() => {
    const onOpenRequest = (event: Event) => {
      const custom = event as CustomEvent<GlobalConsoleOpenRequest>;
      const detail = custom.detail;
      if (!detail) return;
      void openTerminal(detail.runtime, detail.sessionId)
        .then(() => detail.onSuccess?.())
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          detail.onError?.(message);
        });
    };
    window.addEventListener(GLOBAL_CONSOLE_OPEN_EVENT, onOpenRequest as EventListener);
    return () => {
      window.removeEventListener(GLOBAL_CONSOLE_OPEN_EVENT, onOpenRequest as EventListener);
    };
  }, [openTerminal]);

  useEffect(() => {
    if (!terminalOpen || !terminalHostRef.current) return;
    const terminal = new Terminal({
      convertEol: true,
      cursorBlink: true,
      fontSize: 12,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace",
      theme: { background: "#0b1220", foreground: "#e2e8f0" },
      scrollback: 2000,
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(terminalHostRef.current);
    fitAddon.fit();
    terminal.focus();
    xtermRef.current = terminal;
    fitAddonRef.current = fitAddon;
    terminal.attachCustomKeyEventHandler((event) => {
      const key = `${event.key || ""}`.toLowerCase();
      const wantsCopy = (event.ctrlKey || event.metaKey) && key === "c";
      if (!wantsCopy) return true;
      const selection = terminal.getSelection();
      if (!selection) return true;
      if (navigator?.clipboard?.writeText) {
        void navigator.clipboard.writeText(selection).catch(() => {});
      }
      return false;
    });
    const dataSubscription = terminal.onData((data) => {
      void sendTerminalInput(data);
    });
    const onResize = () => {
      requestAnimationFrame(() => {
        try {
          fitAddon.fit();
          if (resizeDebounceRef.current !== null) window.clearTimeout(resizeDebounceRef.current);
          resizeDebounceRef.current = window.setTimeout(() => {
            const cols = terminal.cols;
            const rows = terminal.rows;
            if (cols > 0 && rows > 0) void sendTerminalResize(cols, rows);
          }, 60);
        } catch {
          // ignore resize issues while terminal is closing
        }
      });
    };
    const resizeObserver = terminalHostRef.current ? new ResizeObserver(onResize) : null;
    if (resizeObserver && terminalHostRef.current) {
      resizeObserver.observe(terminalHostRef.current);
    }
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      resizeObserver?.disconnect();
      dataSubscription.dispose();
      terminal.dispose();
      if (xtermRef.current === terminal) xtermRef.current = null;
      if (fitAddonRef.current === fitAddon) fitAddonRef.current = null;
    };
  }, [sendTerminalInput, sendTerminalResize, terminalOpen]);

  useEffect(() => {
    if (!terminalOpen || terminalMinimized) return;
    const timer = setTimeout(() => {
      try {
        fitAddonRef.current?.fit();
      } catch {
        // ignore fit race during modal transitions
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [terminalOpen, terminalMinimized]);

  useEffect(() => () => closeTerminalModal(), [closeTerminalModal]);

  const handleHeaderConsoleClick = useCallback(() => {
    if (terminalOpen) {
      setTerminalMinimized((current) => !current);
      return;
    }
    const raw = localStorage.getItem("mah:last-console-target") || "";
    if (!raw) {
      void openWorkspaceShellTerminal().catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        alert(`Erro ao abrir console: ${message}`);
      });
      return;
    }
    try {
      const parsed = JSON.parse(raw) as { runtime?: string; sessionId?: string };
      if (!parsed?.runtime || !parsed?.sessionId) throw new Error("invalid cache");
      void openTerminal(parsed.runtime, parsed.sessionId).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        alert(`Erro ao abrir console: ${message}`);
      });
    } catch {
      void openWorkspaceShellTerminal().catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        alert(`Erro ao abrir console: ${message}`);
      });
    }
  }, [openTerminal, openWorkspaceShellTerminal, terminalOpen]);

  const handleHeaderLogoutClick = useCallback(() => {
    void logout();
  }, [logout]);

  return (
    <div className="app-shell">
      <HeaderBar
        onConsoleClick={handleHeaderConsoleClick}
        onLogoutClick={handleHeaderLogoutClick}
        consoleActive={terminalOpen}
      />
      <div className="app-shell__body">
        <Sidebar activeItem={activeItem} />
        {showEmptyWorkspace ? (
          <main className="overview-main">
            <div className="overview-proposals__empty" style={{ margin: 24, minHeight: 220 }}>
              <Icon name="folder_open" size={18} />
              Workspace sem `meta-agents.yaml`. Configure o caminho em Settings ou execute Bootstrap.
            </div>
          </main>
        ) : (
          <Outlet />
        )}
      </div>
      {terminalOpen && (
        <div className={`modal-overlay terminal-overlay ${terminalMinimized ? "is-hidden" : ""}`}>
          <div className="modal-box modal-box--terminal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Session Console · {terminalRuntime}</h3>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => setTerminalMinimized((current) => !current)}
                  title={terminalMinimized ? "Restore" : "Minimize"}
                >
                  —
                </button>
                <button type="button" className="icon-button" onClick={() => closeTerminalModal()}>
                  <Icon name="close" size={16} />
                </button>
              </div>
            </div>
            <div className="terminal-console__meta">
              <span>{terminalSessionId}</span>
              <span>{terminalClosed ? `finished (${terminalExitCode ?? "?"})` : "interactive"}</span>
            </div>
            <div
              className="terminal-console__output terminal-console__output--xterm"
              ref={terminalHostRef}
              onClick={() => xtermRef.current?.focus()}
            />
          </div>
        </div>
      )}
      {terminalOpen && terminalMinimized && (
        <div className="terminal-dock">
          <button type="button" className="sessions-action-btn" onClick={() => setTerminalMinimized(false)}>
            Restore Session Console
          </button>
          <button type="button" className="sessions-action-btn" onClick={() => closeTerminalModal()} title="Close Terminal">
            <Icon name="close" size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
