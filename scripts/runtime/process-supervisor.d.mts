export interface ProcessResult {
  status: number;
  stdout: string;
  stderr: string;
  signal?: string | null;
  reason?: string;
  truncated?: boolean;
  error?: Error;
}
export function runBoundedProcess(command: string, args: string[], options?: {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxOutputBytes?: number;
  graceMs?: number;
}): Promise<ProcessResult>;
