export interface NimConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  /** Request timeout in milliseconds. */
  timeoutMs: number;
}

export const NIM_DEFAULTS = {
  baseUrl: "https://integrate.api.nvidia.com/v1",
  model: "nvidia/nemotron-3-super-120b-a12b",
  timeoutMs: 60_000,
} as const;

/** Reads NIM settings from environment variables (NVIDIA_API_KEY, NIM_BASE_URL, NIM_MODEL, NIM_TIMEOUT_MS). */
export function loadNimConfig(env: Record<string, string | undefined> = process.env): NimConfig {
  const apiKey = env.NVIDIA_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("NVIDIA_API_KEY is not set. Get a key at https://build.nvidia.com and add it to .env");
  }
  const timeout = Number(env.NIM_TIMEOUT_MS);
  return {
    apiKey,
    baseUrl: (env.NIM_BASE_URL?.trim() || NIM_DEFAULTS.baseUrl).replace(/\/+$/, ""),
    model: env.NIM_MODEL?.trim() || NIM_DEFAULTS.model,
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : NIM_DEFAULTS.timeoutMs,
  };
}
