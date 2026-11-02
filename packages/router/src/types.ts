export type NimRole = "system" | "user" | "assistant" | "tool";

export interface NimToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface NimMessage {
  role: NimRole;
  content: string | null;
  tool_calls?: NimToolCall[];
  tool_call_id?: string;
}

export interface NimTool {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface NimChatOptions {
  temperature?: number;
  maxTokens?: number;
  tools?: NimTool[];
  signal?: AbortSignal;
}

export interface NimUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface NimChatResult {
  message: NimMessage;
  finishReason: string | null;
  usage?: NimUsage;
  model: string;
}

/** Targets NIM may hand work off to. Every handoff needs the user's approval. */
export type DelegateTarget = "claude" | "claude-code";

export type RouteResult =
  | { kind: "answer"; content: string; model: string; usage?: NimUsage }
  | {
      kind: "delegate";
      target: DelegateTarget;
      task: string;
      reason: string;
      /** Always true: the UI must ask the user before the handoff runs. */
      requiresApproval: true;
      model: string;
      usage?: NimUsage;
    };
