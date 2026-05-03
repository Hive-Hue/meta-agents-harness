export type AgenticEstimationSettings = {
  baseMinutes: number;
  dependencyMinutes: number;
  priorityHighMinutes: number;
  priorityMediumMinutes: number;
  summaryWordMinutes: number;
  tokenBase: number;
  tokenPerMinute: number;
  tokenPerDependency: number;
  tokenPerWord: number;
  tokenPriorityHigh: number;
  tokenPriorityMedium: number;
  runtimeDurationFactor: Record<string, number>;
  runtimeCostPer1kTokensUsd: Record<string, number>;
};

const STORAGE_KEY = "mah:agentic-estimation-settings";

export const DEFAULT_AGENTIC_ESTIMATION_SETTINGS: AgenticEstimationSettings = {
  baseMinutes: 28,
  dependencyMinutes: 10,
  priorityHighMinutes: 26,
  priorityMediumMinutes: 12,
  summaryWordMinutes: 0.7,
  tokenBase: 900,
  tokenPerMinute: 95,
  tokenPerDependency: 420,
  tokenPerWord: 11,
  tokenPriorityHigh: 850,
  tokenPriorityMedium: 400,
  runtimeDurationFactor: {
    "pi/local": 0.78,
    pi: 0.84,
    hermes: 0.88,
    opencode: 0.94,
    openclaude: 1,
    claude: 1.06,
    default: 1,
  },
  runtimeCostPer1kTokensUsd: {
    hermes: 0.0015,
    pi: 0.002,
    opencode: 0.0028,
    openclaude: 0.0035,
    claude: 0.004,
    default: 0.003,
  },
};

export function getAgenticEstimationSettings(): AgenticEstimationSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_AGENTIC_ESTIMATION_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AgenticEstimationSettings>;
    return {
      ...DEFAULT_AGENTIC_ESTIMATION_SETTINGS,
      ...parsed,
      runtimeDurationFactor: {
        ...DEFAULT_AGENTIC_ESTIMATION_SETTINGS.runtimeDurationFactor,
        ...(parsed.runtimeDurationFactor || {}),
      },
      runtimeCostPer1kTokensUsd: {
        ...DEFAULT_AGENTIC_ESTIMATION_SETTINGS.runtimeCostPer1kTokensUsd,
        ...(parsed.runtimeCostPer1kTokensUsd || {}),
      },
    };
  } catch {
    return DEFAULT_AGENTIC_ESTIMATION_SETTINGS;
  }
}

export function setAgenticEstimationSettings(settings: AgenticEstimationSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  window.dispatchEvent(new CustomEvent("mah:agentic-estimation-changed"));
}
