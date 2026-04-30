export const GLOBAL_CONSOLE_OPEN_EVENT = "mah:global-console-open";

export type GlobalConsoleOpenRequest = {
  runtime: string;
  sessionId: string;
  onSuccess?: () => void;
  onError?: (message: string) => void;
};

export function requestGlobalConsoleOpen(runtime: string, sessionId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const payload: GlobalConsoleOpenRequest = {
      runtime,
      sessionId,
      onSuccess: () => resolve(),
      onError: (message) => reject(new Error(message || "failed to open console")),
    };
    window.dispatchEvent(new CustomEvent<GlobalConsoleOpenRequest>(GLOBAL_CONSOLE_OPEN_EVENT, { detail: payload }));
  });
}
