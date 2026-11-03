import { NimClient } from "./nim.js";
import type { DelegateTarget, NimMessage, NimTool, RouteResult } from "./types.js";

export const FRIDAY_SYSTEM_PROMPT = `You are Friday, a warm, upbeat and friendly personal assistant. You are quick, kind and a little playful,
and you call the user "boss" now and then. Keep replies short and natural, like talking to a helpful friend.
Answer the user yourself whenever you can: conversation, questions, planning, short explanations and small code snippets.
Only call the "delegate" tool when the request clearly needs something you should not do alone:
- target "claude-code" for real coding work on a repository: implementing features, fixing bugs, running tests, editing files.
- target "claude" for long, difficult reasoning or writing where a stronger model would do much better.
When you delegate, write a self-contained task description. The user will be asked to approve the handoff first.`;

/** @deprecated The assistant is now called Friday; kept so older imports keep working. */
export const JARVIS_SYSTEM_PROMPT = FRIDAY_SYSTEM_PROMPT;

export const DELEGATE_TOOL: NimTool = {
  type: "function",
  function: {
    name: "delegate",
    description: "Hand the request off to another agent. The user must approve before it runs.",
    parameters: {
      type: "object",
      properties: {
        target: { type: "string", enum: ["claude", "claude-code"] },
        task: { type: "string", description: "Self-contained description of what the other agent should do." },
        reason: { type: "string", description: "One sentence on why Friday is not handling this itself." },
      },
      required: ["target", "task", "reason"],
    },
  },
};

const TARGETS: readonly DelegateTarget[] = ["claude", "claude-code"];

export interface RouterOptions {
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
}

/**
 * Sends every request to NVIDIA NIM first. NIM either answers directly or proposes a
 * handoff to Claude / Claude Code, which the caller must get approved before running.
 */
export class JarvisRouter {
  constructor(private readonly nim: NimClient, private readonly opts: RouterOptions = {}) {}

  async route(history: NimMessage[], signal?: AbortSignal): Promise<RouteResult> {
    const result = await this.nim.chat(this.withSystem(history), {
      tools: [DELEGATE_TOOL],
      temperature: this.opts.temperature,
      maxTokens: this.opts.maxTokens,
      signal,
    });
    const call = result.message.tool_calls?.find((c) => c.function.name === "delegate");
    if (call) {
      const parsed = parseDelegateArgs(call.function.arguments);
      if (parsed) {
        return { kind: "delegate", ...parsed, requiresApproval: true, model: result.model, usage: result.usage };
      }
    }
    return { kind: "answer", content: result.message.content?.trim() ?? "", model: result.model, usage: result.usage };
  }

  /** Streams a direct NIM answer (no delegation), for when the caller already knows NIM should reply. */
  stream(history: NimMessage[], signal?: AbortSignal): AsyncGenerator<string> {
    return this.nim.chatStream(this.withSystem(history), {
      temperature: this.opts.temperature,
      maxTokens: this.opts.maxTokens,
      signal,
    });
  }

  private withSystem(history: NimMessage[]): NimMessage[] {
    const rest = history.filter((m) => m.role !== "system");
    return [{ role: "system", content: this.opts.systemPrompt ?? FRIDAY_SYSTEM_PROMPT }, ...rest];
  }
}

export function parseDelegateArgs(raw: string): { target: DelegateTarget; task: string; reason: string } | null {
  try {
    const args = JSON.parse(raw) as Record<string, unknown>;
    const target = args.target as DelegateTarget;
    const task = typeof args.task === "string" ? args.task.trim() : "";
    const reason = typeof args.reason === "string" ? args.reason.trim() : "";
    if (!TARGETS.includes(target) || !task) return null;
    return { target, task, reason };
  } catch {
    return null;
  }
}
