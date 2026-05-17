import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Icon } from "../../components/ui/Icon";
import { StatusBadge } from "../../components/ui/StatusBadge";
import { ConfigProvider, useConfig } from "../config/useConfigStore";
import { HermesMarkdown } from "./HermesMarkdown";
import "./hermes-gateway.css";

type GatewayStatus = "idle" | "checking" | "online" | "offline";

type ChatRole = "user" | "assistant";

type ChatToolCall = {
  id?: string;
  type?: string;
  name: string;
  arguments?: string;
};

type ChatActivity = {
  thinking?: string[];
  toolCalls?: ChatToolCall[];
  endpoint?: string;
  usage?: unknown;
};

type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  at: string;
  model?: string;
  activity?: ChatActivity;
};

type GatewaySettings = {
  MAH_HERMES_GATEWAY_URL: string;
  MAH_HERMES_GATEWAY_API_KEY: string;
  MAH_HERMES_GATEWAY_MODEL: string;
};

type HealthPayload = {
  ok: boolean;
  status?: number;
  endpoint?: string;
  message?: string;
};

const DEFAULT_SETTINGS: GatewaySettings = {
  MAH_HERMES_GATEWAY_URL: "http://127.0.0.1:8642",
  MAH_HERMES_GATEWAY_API_KEY: "",
  MAH_HERMES_GATEWAY_MODEL: "",
};

const DEFAULT_SYSTEM_PROMPT = [
  "You are Hermes Gateway acting as the MAH orchestrator.",
  "Coordinate across crews and produce execution-ready outputs.",
  "When useful, include: selected crew, runtime assumptions, and next command/action.",
].join(" ");

const HERMES_GATEWAY_SESSION_STORAGE_KEY = "mah:hermes-gateway:session:v1";

type PersistedGatewaySession = {
  version: 1;
  gatewayUrl?: string;
  selectedModel?: string;
  selectedCrew?: string;
  selectedRuntime?: string;
  routingScope?: "active_crew" | "full_crews";
  includeMahContext?: boolean;
  systemPrompt?: string;
  temperature?: string;
  maxTokens?: string;
  draft?: string;
  messages?: ChatMessage[];
  generationExpanded?: boolean;
};

function nowTime() {
  return new Date().toLocaleTimeString([], { hour12: false });
}

function toNumber(value: string, fallback: number): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isChatRole(value: unknown): value is ChatRole {
  return value === "user" || value === "assistant";
}

function normalizeToolCalls(value: unknown): ChatToolCall[] {
  if (!Array.isArray(value)) return [];
  return value.reduce<ChatToolCall[]>((acc, item) => {
    const row = (item && typeof item === "object") ? (item as Record<string, unknown>) : null;
    const name = `${row?.name || ""}`.trim();
    if (!name) return acc;
    acc.push({
      id: typeof row?.id === "string" ? row.id : undefined,
      type: typeof row?.type === "string" ? row.type : undefined,
      name,
      arguments: typeof row?.arguments === "string" ? row.arguments : undefined,
    });
    return acc;
  }, []);
}

function normalizeChatActivity(value: unknown): ChatActivity | undefined {
  const row = (value && typeof value === "object") ? (value as Record<string, unknown>) : null;
  if (!row) return undefined;
  const thinking = Array.isArray(row.thinking)
    ? row.thinking.map((item) => `${item || ""}`.trim()).filter(Boolean)
    : [];
  const toolCalls = normalizeToolCalls(row.toolCalls);
  const endpoint = typeof row.endpoint === "string" ? row.endpoint : undefined;
  const usage = row.usage ?? undefined;
  if (thinking.length === 0 && toolCalls.length === 0 && !endpoint && !usage) {
    return undefined;
  }
  return {
    thinking: thinking.length > 0 ? thinking : undefined,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    endpoint,
    usage,
  };
}

function formatUsage(usage: unknown): string {
  const row = (usage && typeof usage === "object") ? (usage as Record<string, unknown>) : null;
  if (!row) return "";
  const total = Number(row.total_tokens);
  const prompt = Number(row.prompt_tokens);
  const completion = Number(row.completion_tokens);
  if (Number.isFinite(total)) {
    const parts = [`${Math.floor(total)} tok`];
    if (Number.isFinite(prompt)) parts.push(`p:${Math.floor(prompt)}`);
    if (Number.isFinite(completion)) parts.push(`c:${Math.floor(completion)}`);
    return parts.join(" · ");
  }
  return "";
}

function coerceThinkingText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value
      .map((item) => coerceThinkingText(item))
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  if (value && typeof value === "object") {
    const row = value as Record<string, unknown>;
    const candidates = [
      row.text,
      row.content,
      row.reasoning_content,
      row.reasoning,
      row.summary,
      row.message,
    ];
    return candidates
      .map((item) => coerceThinkingText(item))
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  return "";
}

function extractInlineThinking(content: string): { cleanedContent: string; thinking: string[] } {
  const collected: string[] = [];
  const pushBlock = (value: unknown) => {
    const text = coerceThinkingText(value);
    if (!text) return;
    if (!collected.includes(text)) collected.push(text);
  };

  let cleaned = `${content || ""}`;

  cleaned = cleaned.replace(/<think\b[^>]*>([\s\S]*?)<\/think>/gi, (_, block: string) => {
    pushBlock(block);
    return "";
  });

  cleaned = cleaned.replace(/(^|\n)#{1,6}\s*reasoning[^\n]*\n([\s\S]*?)(?=\n(?:#{1,6}\s+[^\n]+|---+\s*$)|$)/gim, (match: string, _prefix: string, block: string) => {
    pushBlock(block);
    return "";
  });

  cleaned = cleaned.replace(/(^|\n)\*\*reasoning[:\s]*\*\*\s*\n?([\s\S]*?)(?=\n(?:\*\*[^*]+:\*\*|#{1,6}\s+[^\n]+|---+\s*$)|$)/gim, (_match: string, _prefix: string, block: string) => {
    pushBlock(block);
    return "";
  });

  cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trim();
  return { cleanedContent: cleaned, thinking: collected };
}

function inferToolCallsFromContent(content: string): ChatToolCall[] {
  const toolCalls: ChatToolCall[] = [];
  const fenceRegex = /```([a-zA-Z0-9_+-]*)\n([\s\S]*?)```/g;
  const terminalLangs = new Set(["bash", "sh", "zsh", "shell", "powershell", "pwsh", "cmd"]);
  let match: RegExpExecArray | null;
  while ((match = fenceRegex.exec(content)) !== null) {
    const lang = `${match[1] || ""}`.trim().toLowerCase();
    const body = `${match[2] || ""}`.trim();
    if (!body) continue;
    if (!terminalLangs.has(lang)) continue;
    toolCalls.push({
      name: "terminal",
      type: "inferred",
      arguments: body.length > 4000 ? `${body.slice(0, 4000)}…` : body,
    });
  }
  return toolCalls;
}

function normalizePersistedMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return [];
  return value.reduce<ChatMessage[]>((acc, item) => {
    const row = (item && typeof item === "object") ? (item as Record<string, unknown>) : null;
    const role = row?.role;
    const content = `${row?.content || ""}`.trim();
    if (!isChatRole(role) || !content) return acc;
    acc.push({
      id: `${row?.id || `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`}`,
      role,
      content,
      at: `${row?.at || nowTime()}`,
      model: typeof row?.model === "string" ? row.model : undefined,
      activity: normalizeChatActivity(row?.activity),
    });
    return acc;
  }, []);
}

function readPersistedSession(): PersistedGatewaySession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(HERMES_GATEWAY_SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return null;
    return {
      version: 1,
      gatewayUrl: typeof parsed.gatewayUrl === "string" ? parsed.gatewayUrl : undefined,
      selectedModel: typeof parsed.selectedModel === "string" ? parsed.selectedModel : undefined,
      selectedCrew: typeof parsed.selectedCrew === "string" ? parsed.selectedCrew : undefined,
      selectedRuntime: typeof parsed.selectedRuntime === "string" ? parsed.selectedRuntime : undefined,
      routingScope: parsed.routingScope === "full_crews" ? "full_crews" : "active_crew",
      includeMahContext: typeof parsed.includeMahContext === "boolean" ? parsed.includeMahContext : true,
      systemPrompt: typeof parsed.systemPrompt === "string" ? parsed.systemPrompt : undefined,
      temperature: typeof parsed.temperature === "string" ? parsed.temperature : undefined,
      maxTokens: typeof parsed.maxTokens === "string" ? parsed.maxTokens : undefined,
      draft: typeof parsed.draft === "string" ? parsed.draft : undefined,
      messages: normalizePersistedMessages(parsed.messages),
      generationExpanded: typeof parsed.generationExpanded === "boolean" ? parsed.generationExpanded : false,
    };
  } catch {
    return null;
  }
}

function writePersistedSession(next: PersistedGatewaySession) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(HERMES_GATEWAY_SESSION_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Keep UI functional even when browser storage is unavailable/quota-limited.
  }
}

export function HermesGatewayPage() {
  return (
    <ConfigProvider>
      <HermesGatewayPageInner />
    </ConfigProvider>
  );
}

function HermesGatewayPageInner() {
  const { config } = useConfig();
  const navigate = useNavigate();
  const persistedSession = useMemo(() => readPersistedSession(), []);

  const crewOptions = useMemo(() => {
    const configured = (config?.crews ?? []).map((crew) => `${crew?.id || ""}`.trim()).filter(Boolean);
    if (configured.length > 0) return configured;
    return ["dev"];
  }, [config?.crews]);

  const runtimeOptions = useMemo(() => {
    const configured = Object.keys(config?.runtimes ?? {}).map((runtime) => `${runtime || ""}`.trim()).filter(Boolean);
    const merged = new Set(configured.length > 0 ? configured : ["hermes"]);
    merged.add("hermes");
    return Array.from(merged);
  }, [config?.runtimes]);

  const [settings, setSettings] = useState<GatewaySettings>(DEFAULT_SETTINGS);
  const [status, setStatus] = useState<GatewayStatus>("idle");
  const [statusHint, setStatusHint] = useState("Gateway ainda não verificado.");
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedModel, setSelectedModel] = useState(() => `${persistedSession?.selectedModel || ""}`.trim());
  const [selectedCrew, setSelectedCrew] = useState(() => `${persistedSession?.selectedCrew || "dev"}`.trim() || "dev");
  const [selectedRuntime, setSelectedRuntime] = useState(() => `${persistedSession?.selectedRuntime || "hermes"}`.trim() || "hermes");
  const [routingScope, setRoutingScope] = useState<"active_crew" | "full_crews">(persistedSession?.routingScope === "full_crews" ? "full_crews" : "active_crew");
  const [includeMahContext, setIncludeMahContext] = useState(persistedSession?.includeMahContext !== false);

  const [systemPrompt, setSystemPrompt] = useState(() => `${persistedSession?.systemPrompt || DEFAULT_SYSTEM_PROMPT}`.trim() || DEFAULT_SYSTEM_PROMPT);
  const [temperature, setTemperature] = useState(() => `${persistedSession?.temperature || "0.2"}`.trim() || "0.2");
  const [maxTokens, setMaxTokens] = useState(() => `${persistedSession?.maxTokens || "1200"}`.trim() || "1200");
  const [draft, setDraft] = useState(() => `${persistedSession?.draft || ""}`);
  const [messages, setMessages] = useState<ChatMessage[]>(() => persistedSession?.messages ?? []);
  const [generationExpanded, setGenerationExpanded] = useState(persistedSession?.generationExpanded === true);
  const [inspectorElement, setInspectorElement] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (selectedCrew && crewOptions.includes(selectedCrew)) return;
    setSelectedCrew(crewOptions[0] || "dev");
  }, [crewOptions, selectedCrew]);

  useEffect(() => {
    if (selectedRuntime && runtimeOptions.includes(selectedRuntime)) return;
    setSelectedRuntime(runtimeOptions[0] || "hermes");
  }, [runtimeOptions, selectedRuntime]);

  const loadGatewayConfig = useCallback(async () => {
    setLoadingConfig(true);
    setError(null);
    try {
      const resp = await fetch("/api/mah/hermes-gateway/config");
      const payload = await resp.json();
      if (!resp.ok || !payload?.ok) {
        throw new Error(payload?.error || "failed to load gateway config");
      }
      const next = payload?.settings || {};
      const merged: GatewaySettings = {
        MAH_HERMES_GATEWAY_URL: typeof next.MAH_HERMES_GATEWAY_URL === "string" ? next.MAH_HERMES_GATEWAY_URL : DEFAULT_SETTINGS.MAH_HERMES_GATEWAY_URL,
        MAH_HERMES_GATEWAY_API_KEY: typeof next.MAH_HERMES_GATEWAY_API_KEY === "string" ? next.MAH_HERMES_GATEWAY_API_KEY : "",
        MAH_HERMES_GATEWAY_MODEL: typeof next.MAH_HERMES_GATEWAY_MODEL === "string" ? next.MAH_HERMES_GATEWAY_MODEL : "",
      };
      setSettings(merged);
      if (merged.MAH_HERMES_GATEWAY_MODEL) {
        setSelectedModel((prev) => prev || merged.MAH_HERMES_GATEWAY_MODEL);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingConfig(false);
    }
  }, []);

  const saveGatewayConfig = useCallback(async () => {
    setSavingConfig(true);
    setError(null);
    try {
      const resp = await fetch("/api/mah/hermes-gateway/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settings: {
            ...settings,
            MAH_HERMES_GATEWAY_MODEL: selectedModel,
          },
        }),
      });
      const payload = await resp.json();
      if (!resp.ok || !payload?.ok) {
        throw new Error(payload?.error || "failed to save gateway config");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingConfig(false);
    }
  }, [selectedModel, settings]);

  const checkHealth = useCallback(async () => {
    setStatus("checking");
    setStatusHint("Verificando conectividade com Hermes Gateway...");
    setError(null);
    try {
      const resp = await fetch("/api/mah/hermes-gateway/health", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: settings.MAH_HERMES_GATEWAY_URL,
          apiKey: settings.MAH_HERMES_GATEWAY_API_KEY,
        }),
      });
      const payload = await resp.json();
      if (!resp.ok || !payload?.ok) {
        throw new Error(payload?.error || "gateway health check failed");
      }
      const health = (payload?.health || {}) as HealthPayload;
      if (health.ok) {
        setStatus("online");
        setStatusHint(`Gateway online (${health.endpoint || "endpoint"}, status ${health.status || 200}).`);
      } else {
        setStatus("offline");
        setStatusHint(health.message || "Gateway retornou resposta inválida.");
      }
    } catch (err) {
      setStatus("offline");
      const msg = err instanceof Error ? err.message : String(err);
      setStatusHint(msg);
      setError(msg);
    }
  }, [settings.MAH_HERMES_GATEWAY_API_KEY, settings.MAH_HERMES_GATEWAY_URL]);

  useEffect(() => {
    void loadGatewayConfig();
  }, [loadGatewayConfig]);

  useEffect(() => {
    writePersistedSession({
      version: 1,
      gatewayUrl: settings.MAH_HERMES_GATEWAY_URL,
      selectedModel,
      selectedCrew,
      selectedRuntime,
      routingScope,
      includeMahContext,
      systemPrompt,
      temperature,
      maxTokens,
      draft,
      messages: messages.slice(-160),
      generationExpanded,
    });
  }, [
    draft,
    generationExpanded,
    includeMahContext,
    maxTokens,
    messages,
    routingScope,
    selectedCrew,
    selectedModel,
    selectedRuntime,
    settings.MAH_HERMES_GATEWAY_URL,
    systemPrompt,
    temperature,
  ]);

  useEffect(() => {
    if (!generationExpanded || !inspectorElement) return;
    const frame = window.requestAnimationFrame(() => {
      inspectorElement.scrollTo({
        top: inspectorElement.scrollHeight,
        behavior: "smooth",
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [generationExpanded, inspectorElement]);

  const appendMessage = useCallback((message: ChatMessage) => {
    setMessages((prev) => [...prev, message]);
  }, []);

  const patchMessage = useCallback((messageId: string, patch: (current: ChatMessage) => ChatMessage) => {
    setMessages((prev) => prev.map((item) => (item.id === messageId ? patch(item) : item)));
  }, []);

  const sendMessage = useCallback(async () => {
    const task = draft.trim();
    if (!task || sending) return;

    const userMessage: ChatMessage = {
      id: `m-${Date.now()}-u`,
      role: "user",
      content: task,
      at: nowTime(),
    };
    const nextMessages = [...messages, userMessage];
    const assistantMessageId = `m-${Date.now()}-a`;
    const assistantStartedAt = nowTime();

    appendMessage(userMessage);
    appendMessage({
      id: assistantMessageId,
      role: "assistant",
      content: "",
      at: assistantStartedAt,
      model: `${selectedModel || "gateway"}`,
    });
    setDraft("");
    setSending(true);
    setError(null);

    try {
      const resp = await fetch("/api/mah/hermes-gateway/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: settings.MAH_HERMES_GATEWAY_URL,
          apiKey: settings.MAH_HERMES_GATEWAY_API_KEY,
          model: selectedModel,
          crew: selectedCrew,
          runtime: selectedRuntime,
          routingScope,
          includeMahContext,
          systemPrompt,
          temperature: toNumber(temperature, 0.2),
          maxTokens: Math.floor(toNumber(maxTokens, 1200)),
          stream: true,
          messages: nextMessages.map((item) => ({ role: item.role, content: item.content })),
        }),
      });

      if (!resp.ok) {
        let msg = "gateway chat request failed";
        try {
          const payload = await resp.json();
          msg = payload?.error || msg;
        } catch {
          try {
            const text = (await resp.text()).trim();
            if (text) msg = text;
          } catch {
            // Ignore response parse failures.
          }
        }
        throw new Error(msg);
      }

      const contentType = `${resp.headers.get("content-type") || ""}`.toLowerCase();
      if (contentType.includes("text/event-stream") && resp.body) {
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let sseBuffer = "";
        let streamedContent = "";
        let endpointFromMeta = "";
        let modelFromStream = `${selectedModel || "gateway"}`;
        let usage: unknown = undefined;
        let syntheticToolCounter = 100000;
        const thinkingBlocks = new Set<string>();
        const toolCallsByIndex = new Map<number, { id?: string; type?: string; name: string; arguments: string }>();

        const pushThinking = (value: unknown) => {
          const text = coerceThinkingText(value);
          if (!text) return;
          thinkingBlocks.add(text);
        };

        const mergeToolCalls = (value: unknown) => {
          if (!Array.isArray(value)) return;
          for (const row of value) {
            const item = (row && typeof row === "object") ? (row as Record<string, unknown>) : null;
            if (!item) continue;
            const index = Number.isFinite(Number(item.index)) ? Number(item.index) : toolCallsByIndex.size;
            const fn = (item.function && typeof item.function === "object") ? (item.function as Record<string, unknown>) : null;
            const current = toolCallsByIndex.get(index) || { name: "", arguments: "" };
            if (!current.id && typeof item.id === "string" && item.id.trim()) current.id = item.id.trim();
            if (!current.type && typeof item.type === "string" && item.type.trim()) current.type = item.type.trim();
            if (!current.name) {
              const nextName = `${fn?.name || item.name || item.tool || item.action || ""}`.trim();
              if (nextName) current.name = nextName;
            }
            const argsDelta = typeof fn?.arguments === "string"
              ? fn.arguments
              : typeof item.arguments === "string"
                ? item.arguments
                : typeof item.input === "string"
                  ? item.input
                  : "";
            if (argsDelta) current.arguments += argsDelta;
            if (current.name) toolCallsByIndex.set(index, current);
          }
        };

        const recordToolProgressEvent = (eventName: string, payload: Record<string, unknown> | null, rawText: string) => {
          const event = `${eventName || ""}`.trim().toLowerCase();
          if (!event.includes("tool")) return;
          const pick = (value: unknown) => coerceThinkingText(value).replace(/\s+/g, " ").trim();
          const toolName = pick(payload?.tool ?? payload?.name ?? payload?.tool_name ?? payload?.function ?? payload?.action) || "tool";
          const phase = pick(payload?.phase ?? payload?.event_type ?? payload?.status)
            || (event.endsWith(".started") || event.endsWith(".start")
              ? "start"
              : event.endsWith(".completed") || event.endsWith(".complete")
                ? "complete"
                : event.endsWith(".failed") || event.endsWith(".error")
                  ? "error"
                  : "");
          const emoji = pick(payload?.emoji);
          const label = pick(payload?.label ?? payload?.preview ?? payload?.message ?? payload?.text ?? payload?.output ?? rawText);
          const argsRaw = payload?.args ?? payload?.arguments ?? payload?.input ?? payload?.command ?? payload?.preview;
          const argsText = typeof argsRaw === "string"
            ? argsRaw.trim()
            : argsRaw !== undefined
              ? JSON.stringify(argsRaw, null, 2)
              : "";

          const lines: string[] = [];
          if (emoji) lines.push(`emoji: ${emoji}`);
          if (label) lines.push(`label: ${label}`);
          if (phase) lines.push(`phase: ${phase}`);
          if (argsText) lines.push(argsText);
          if (lines.length === 0) return;

          const targetIndex = Number.isFinite(Number(payload?.index))
            ? Number(payload?.index)
            : syntheticToolCounter++;
          const current = toolCallsByIndex.get(targetIndex) || { name: toolName, type: "tool-progress", arguments: "" };
          if (!current.name) current.name = toolName;
          if (!current.type) current.type = "tool-progress";
          if (typeof payload?.id === "string" && payload.id.trim()) current.id = payload.id.trim();
          const nextChunk = lines.join("\n");
          current.arguments = current.arguments ? `${current.arguments}\n${nextChunk}` : nextChunk;
          if (current.arguments.length > 5000) {
            current.arguments = `${current.arguments.slice(0, 5000)}…`;
          }
          toolCallsByIndex.set(targetIndex, current);
        };

        const flushAssistant = () => {
          const inline = extractInlineThinking(streamedContent);
          for (const block of inline.thinking) thinkingBlocks.add(block);
          const streamedToolCalls = Array.from(toolCallsByIndex.entries())
            .sort((a, b) => a[0] - b[0])
            .map(([, row]) => ({
              id: row.id,
              type: row.type,
              name: row.name,
              arguments: row.arguments || undefined,
            }));
          const inferredToolCalls = streamedToolCalls.length === 0
            ? inferToolCallsFromContent(streamedContent)
            : [];
          const toolCalls = [...streamedToolCalls, ...inferredToolCalls];
          const activity = normalizeChatActivity({
            thinking: Array.from(thinkingBlocks.values()),
            toolCalls,
            endpoint: endpointFromMeta || undefined,
            usage,
          });
          patchMessage(assistantMessageId, (current) => ({
            ...current,
            content: inline.cleanedContent || current.content || "(sem conteúdo retornado pelo gateway)",
            model: modelFromStream || current.model,
            activity,
          }));
        };

        const processEvent = (eventName: string, dataText: string) => {
          const text = dataText.trim();
          if (!text) return false;
          if (text === "[DONE]") return true;

          if (eventName === "meta") {
            try {
              const meta = JSON.parse(text) as Record<string, unknown>;
              if (typeof meta.endpoint === "string") endpointFromMeta = meta.endpoint;
              if (typeof meta.model === "string" && meta.model.trim()) modelFromStream = meta.model.trim();
              flushAssistant();
            } catch {
              // Ignore malformed metadata payloads.
            }
            return false;
          }

          try {
            const payload = JSON.parse(text) as Record<string, unknown>;
            const runEvent = `${payload.event || ""}`.trim().toLowerCase();
            if (runEvent) {
              recordToolProgressEvent(runEvent, payload, text);
              if (runEvent === "message.delta" && typeof payload.delta === "string" && payload.delta.length > 0) {
                streamedContent += payload.delta;
              }
              if (runEvent === "reasoning.available") {
                pushThinking(payload.text ?? payload.reasoning ?? payload.message);
              }
              if (runEvent === "run.completed") {
                if (payload.usage) usage = payload.usage;
                if (!streamedContent) {
                  const outputText = coerceThinkingText(payload.output);
                  if (outputText) streamedContent = outputText;
                }
                flushAssistant();
                return true;
              }
              if (runEvent === "run.failed" || runEvent === "run.error") {
                const failureText = coerceThinkingText(payload.error ?? payload.message ?? payload.output ?? payload.details);
                if (failureText) {
                  streamedContent = streamedContent ? `${streamedContent}\n${failureText}` : failureText;
                }
                flushAssistant();
                return true;
              }
            }
            recordToolProgressEvent(eventName, payload, text);
            if (typeof payload.model === "string" && payload.model.trim()) {
              modelFromStream = payload.model.trim();
            }
            if (payload.usage) usage = payload.usage;

            const choices = Array.isArray(payload.choices) ? payload.choices : [];
            const first = (choices[0] && typeof choices[0] === "object") ? (choices[0] as Record<string, unknown>) : null;
            const delta = (first?.delta && typeof first.delta === "object") ? (first.delta as Record<string, unknown>) : null;

            if (typeof delta?.content === "string" && delta.content.length > 0) {
              streamedContent += delta.content;
            }

            pushThinking(delta?.reasoning_content);
            pushThinking(delta?.reasoning);
            pushThinking(delta?.thinking);
            pushThinking(first?.reasoning);
            pushThinking(payload.reasoning);
            pushThinking(payload.thinking);

            mergeToolCalls(delta?.tool_calls);
            mergeToolCalls(payload.tool_calls);
            mergeToolCalls((payload.activity && typeof payload.activity === "object")
              ? (payload.activity as Record<string, unknown>).tool_calls
              : undefined);

            flushAssistant();
          } catch {
            recordToolProgressEvent(eventName, null, text);
            // Ignore malformed SSE payloads; keep rendering available text.
          }
          return false;
        };

        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            if (!value || value.length === 0) continue;

            sseBuffer += decoder.decode(value, { stream: true });
            sseBuffer = sseBuffer.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

            while (true) {
              const separatorIndex = sseBuffer.indexOf("\n\n");
              if (separatorIndex < 0) break;
              const rawEvent = sseBuffer.slice(0, separatorIndex);
              sseBuffer = sseBuffer.slice(separatorIndex + 2);

              if (!rawEvent.trim()) continue;
              const lines = rawEvent.split("\n");
              let eventName = "";
              const dataLines: string[] = [];
              for (const line of lines) {
                if (!line || line.startsWith(":")) continue;
                if (line.startsWith("event:")) {
                  eventName = line.slice(6).trim();
                  continue;
                }
                if (line.startsWith("data:")) {
                  dataLines.push(line.slice(5).trimStart());
                }
              }
              if (dataLines.length === 0) continue;
              const shouldStop = processEvent(eventName, dataLines.join("\n"));
              if (shouldStop) {
                flushAssistant();
                return;
              }
            }
          }
        } finally {
          void reader.cancel().catch(() => { });
        }

        flushAssistant();
        return;
      }

      const payload = await resp.json();
      if (!payload?.ok) {
        throw new Error(payload?.error || "gateway chat request failed");
      }
      const answerRaw = `${payload?.responseText || ""}`.trim();
      const inline = extractInlineThinking(answerRaw);
      const inferredToolCalls = inferToolCallsFromContent(answerRaw);
      const existingActivity = (payload?.activity && typeof payload.activity === "object")
        ? (payload.activity as Record<string, unknown>)
        : {};
      const existingToolCalls = Array.isArray(existingActivity.toolCalls) ? existingActivity.toolCalls : [];
      const activity = normalizeChatActivity({
        ...existingActivity,
        thinking: [
          ...((Array.isArray(existingActivity.thinking))
            ? ((existingActivity.thinking as unknown[]).map((item) => coerceThinkingText(item)).filter(Boolean))
            : []),
          ...inline.thinking,
        ],
        toolCalls: existingToolCalls.length > 0 ? existingToolCalls : inferredToolCalls,
        endpoint: payload?.endpoint,
        usage: payload?.usage,
      });
      patchMessage(assistantMessageId, (current) => ({
        ...current,
        content: inline.cleanedContent || answerRaw || "(sem conteúdo retornado pelo gateway)",
        model: `${payload?.model || selectedModel || "gateway"}`,
        activity,
      }));
    } catch (err) {
      patchMessage(assistantMessageId, (current) => ({
        ...current,
        content: current.content || "(falha ao obter resposta do gateway)",
      }));
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }, [appendMessage, draft, includeMahContext, maxTokens, messages, patchMessage, routingScope, selectedCrew, selectedModel, selectedRuntime, sending, settings.MAH_HERMES_GATEWAY_API_KEY, settings.MAH_HERMES_GATEWAY_URL, systemPrompt, temperature]);

  const clearChat = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  const sendToRunConsole = useCallback(() => {
    const latestUser = [...messages].reverse().find((item) => item.role === "user");
    const taskText = draft.trim() || latestUser?.content || "";
    if (!taskText) return;
    navigate("/run", {
      state: {
        taskText,
        crew: selectedCrew,
        runtime: selectedRuntime,
        autoRun: false,
        sourceTaskId: "hermes-gateway",
      },
    });
  }, [draft, messages, navigate, selectedCrew, selectedRuntime]);

  const gatewayBadge =
    status === "online"
      ? { tone: "completed" as const, label: "Online" }
      : status === "offline"
        ? { tone: "failed" as const, label: "Offline" }
        : { tone: "running" as const, label: status === "checking" ? "Checking" : "Idle" };

  const canSend = !sending && !!draft.trim() && !!selectedCrew && !!selectedRuntime;

  return (
    <>
      <main className="hermes-main">
        <section className="hermes-header">
          <h2>Hermes Gateway WebUI</h2>
        </section>

        <div className="hermes-body">
          <section className="hermes-chat">
            <div className="hermes-chat__messages">
              {messages.length === 0 ? (
                <div className="hermes-chat__empty">
                  <Icon name="forum" size={16} />
                  Sem mensagens ainda. Envie uma task para o Hermes Gateway.
                </div>
              ) : (
                messages.map((message) => (
                  <article key={message.id} className={`hermes-message hermes-message--${message.role}`}>
                    <header className="hermes-message__meta">
                      <strong>{message.role === "user" ? "You" : "Hermes"}</strong>
                      <span>{message.at}</span>
                      {message.model ? <em>{message.model}</em> : null}
                    </header>
                    <div className="hermes-message__content">
                      <HermesMarkdown content={message.content} />
                    </div>
                    {message.role === "assistant" && message.activity ? (
                      <section className="hermes-activity" aria-label="Activity">
                        <header className="hermes-activity__meta">
                          <strong>Activity</strong>
                          <span>{formatUsage(message.activity.usage) || "No token usage returned"}</span>
                        </header>
                        {(!message.activity.thinking || message.activity.thinking.length === 0)
                          && (!message.activity.toolCalls || message.activity.toolCalls.length === 0) ? (
                          <p className="hermes-activity__empty">Gateway did not emit thinking/tool call events for this response.</p>
                        ) : null}
                        {message.activity.thinking && message.activity.thinking.length > 0 ? (
                          <details className="hermes-activity__panel">
                            <summary>Thinking</summary>
                            <div className="hermes-activity__body">
                              {message.activity.thinking.map((block, index) => (
                                <pre key={`${message.id}-thinking-${index}`} className="hermes-activity__pre">{block}</pre>
                              ))}
                            </div>
                          </details>
                        ) : null}
                        {message.activity.toolCalls && message.activity.toolCalls.length > 0 ? (
                          <details className="hermes-activity__panel">
                            <summary>Tool Calls ({message.activity.toolCalls.length})</summary>
                            <div className="hermes-activity__body">
                              {message.activity.toolCalls.map((toolCall, index) => (
                                <article key={`${message.id}-tool-${index}`} className="hermes-activity__tool">
                                  <header>
                                    <strong>{toolCall.name}</strong>
                                    {toolCall.type ? <span>{toolCall.type}</span> : null}
                                    {toolCall.id ? <em>{toolCall.id}</em> : null}
                                  </header>
                                  {toolCall.arguments ? <pre className="hermes-activity__pre">{toolCall.arguments}</pre> : null}
                                </article>
                              ))}
                            </div>
                          </details>
                        ) : null}
                      </section>
                    ) : null}
                  </article>
                ))
              )}
            </div>
            <div className="hermes-chat__composer">
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Descreva a task/objetivo para o Hermes orchestrator..."
                rows={4}
                className="run-composer__textarea"
              />
              <div className="hermes-chat__actions">
                <button className="run-action-btn" type="button" onClick={clearChat}>
                  <Icon name="delete_sweep" size={14} />
                  Clear
                </button>
                <button className="run-action-btn" type="button" onClick={sendToRunConsole}>
                  <Icon name="play_circle" size={14} />
                  Open in Run
                </button>
                <button className="run-action-btn run-action-btn--primary" type="button" onClick={() => void sendMessage()} disabled={!canSend}>
                  <Icon name="send" size={14} />
                  {sending ? "Sending..." : "Send"}
                </button>
              </div>
            </div>
          </section>
        </div>
      </main>

      <aside className="inspector hermes-inspector" aria-label="Hermes gateway inspector" ref={setInspectorElement}>
        <section className="inspector-section">
          <h3 className="inspector-section__title">Gateway State</h3>
          <div className="hermes-state-row">
            <StatusBadge tone={gatewayBadge.tone} label={gatewayBadge.label} />
            <button className="run-action-btn" type="button" onClick={() => void checkHealth()} disabled={status === "checking"}>
              <Icon name="health_and_safety" size={14} />
              {status === "checking" ? "Checking..." : "Health"}
            </button>
          </div>
        </section>

        <section className="inspector-section">
          <h3 className="inspector-section__title">Orchestration</h3>
          <label className="hermes-field">
            <span>Crew</span>
            <select value={selectedCrew} onChange={(event) => setSelectedCrew(event.target.value)}>
              {crewOptions.map((crew) => (
                <option key={crew} value={crew}>{crew}</option>
              ))}
            </select>
          </label>
          <label className="hermes-field">
            <span>Runtime</span>
            <select value={selectedRuntime} onChange={(event) => setSelectedRuntime(event.target.value)}>
              {runtimeOptions.map((runtime) => (
                <option key={runtime} value={runtime}>{runtime}</option>
              ))}
            </select>
          </label>
          <label className="hermes-field">
            <span>Routing Scope</span>
            <select value={routingScope} onChange={(event) => setRoutingScope(event.target.value === "full_crews" ? "full_crews" : "active_crew")}>
              <option value="active_crew">Active Crew</option>
              <option value="full_crews">Full Crews</option>
            </select>
          </label>
          <label className="hermes-toggle">
            <input type="checkbox" checked={includeMahContext} onChange={(event) => setIncludeMahContext(event.target.checked)} />
            Inject MAH orchestration context in system prompt
          </label>
        </section>

        <details
          className={`inspector-section inspector-section--details${generationExpanded ? " is-open" : ""}`}
          open={generationExpanded}
          onToggle={(event) => setGenerationExpanded((event.currentTarget as HTMLDetailsElement).open)}
        >
          <summary className="inspector-section__summary">
            <h3 className="inspector-section__title">Advanced Generation</h3>
            <span className="inspector-section__summary-state">{generationExpanded ? "Open" : "Collapsed"}</span>
          </summary>
          <div className="inspector-section__body">
            <label className="hermes-field">
              <span>Temperature</span>
              <input value={temperature} onChange={(event) => setTemperature(event.target.value)} placeholder="0.2" />
            </label>
            <label className="hermes-field">
              <span>Max Tokens</span>
              <input value={maxTokens} onChange={(event) => setMaxTokens(event.target.value)} placeholder="1200" />
            </label>
            <label className="hermes-field">
              <span>System Prompt</span>
              <textarea value={systemPrompt} onChange={(event) => setSystemPrompt(event.target.value)} rows={5} />
            </label>
          </div>
        </details>

        {loadingConfig && <p className="hermes-status">Loading gateway config...</p>}
        <p className="hermes-status">Session state persists locally between route changes.</p>
        {error && <p className="hermes-error">{error}</p>}
      </aside>
    </>
  );
}
