import { useState, useEffect, useCallback, useRef } from "react";

export interface LifecycleEvent {
  event: string;
  timestamp: string;
  goal?: string;
  cost_summary?: { duration_ms: number; lifecycle_events: number };
  agent?: string;
  routing_confidence?: number;
  result_code?: number;
  result_reason?: string;
  governance?: {
    trust_tier?: string;
    approval_required?: boolean;
    supervision_required?: boolean;
    confidential_execution?: boolean;
  };
}

export interface SessionLifecycle {
  events: LifecycleEvent[];
  goal: string | null;
  costSummary: { duration_ms: number; lifecycle_events: number } | null;
  currentState: string;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

const POLL_INTERVAL_MS = 5000;

export function useSessionLifecycle(sessionId: string | null): SessionLifecycle {
  const [events, setEvents] = useState<LifecycleEvent[]>([]);
  const [goal, setGoal] = useState<string | null>(null);
  const [costSummary, setCostSummary] = useState<{ duration_ms: number; lifecycle_events: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    if (!sessionId) {
      setEvents([]);
      setGoal(null);
      setCostSummary(null);
      setLoading(false);
      return;
    }

    // Cancel any in-flight request
    abortRef.current?.abort();
    const controller = abortRef.current = new AbortController();

    setLoading(true);
    setError(null);

    try {
      const resp = await fetch("/api/mah/exec", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          args: ["sessions", "status", sessionId, "--json"],
        }),
        signal: controller.signal,
      });

      if (!controller.signal.aborted) {
        const data = await resp.json();
        if (data.ok) {
          // Parse JSON from stdout
          let parsed: any = {};
          try {
            parsed = JSON.parse(data.stdout || "{}");
          } catch {
            // fallback: try parsing line by line
            const lines = (data.stdout || "").trim().split("\n");
            for (const line of lines) {
              try {
                const l = JSON.parse(line);
                if (l.session_id === sessionId) { parsed = l; break; }
              } catch { /* skip */ }
            }
          }

          const evs: LifecycleEvent[] = parsed.events || [];
          setEvents(evs);

          // Extract goal from first event that has one
          const goalEvent = evs.find(e => e.goal);
          setGoal(goalEvent?.goal || null);

          // Extract cost_summary from last event
          const lastEvent = evs[evs.length - 1];
          setCostSummary(lastEvent?.cost_summary || null);
        } else {
          setError(data.stderr || "Failed to load session lifecycle");
        }
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        // Intentional abort — no-op
      } else {
        setError(String(e));
      }
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  }, [sessionId]);

  // Initial load
  useEffect(() => {
    void load();
  }, [load]);

  // Polling: stop when session is terminal
  useEffect(() => {
    const lastEvent = events[events.length - 1];
    const isTerminal = lastEvent?.event === "completed" || lastEvent?.event === "failed";

    if (!sessionId || isTerminal) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    intervalRef.current = setInterval(() => {
      void load();
    }, POLL_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [sessionId, events, load]);

  // Pause polling when tab hidden
  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden) {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      } else if (sessionId) {
        void load();
        intervalRef.current = setInterval(() => { void load(); }, POLL_INTERVAL_MS);
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [sessionId, load]);

  const currentState = events.length > 0 ? events[events.length - 1].event : "unknown";

  return { events, goal, costSummary, currentState, loading, error, reload: load };
}