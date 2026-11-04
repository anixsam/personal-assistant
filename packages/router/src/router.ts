import { NimClient } from "./nim.js";
import type { DelegateTarget, NimMessage, NimTool, NimUsage, RouteResult, Toolbox, ToolUse } from "./types.js";

export const FRIDAY_SYSTEM_PROMPT = `You are Friday, a warm, upbeat and friendly personal assistant. You are quick, kind and a little playful,
and you call the user "boss" now and then. Keep replies short and natural, like talking to a helpful friend.
Answer the user yourself whenever you can: conversation, questions, planning, short explanations and small code snippets.
Only call the "delegate" tool when the request clearly needs something you should not do alone:
- target "claude-code" for real coding work on a repository: implementing features, fixing bugs, running tests, editing files.
- target "claude" for long, difficult reasoning or writing where a stronger model would do much better.
When you delegate, write a self-contained task description. The user will be asked to approve the handoff first.
You may also have tools for reading the user's files or GitHub. Use them when they help answer, then reply in plain words.`;

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
  /** Tools NIM can call itself while answering (MCP servers). */
  toolbox?: Toolbox;
  /** Most tool rounds per request before Friday must answer (default 6). */
  maxToolRounds?: number;
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
    const extra = (await this.opts.toolbox?.tools()) ?? [];
    const messages = this.withSystem(history);
    const used: ToolUse[] = [];
    const usage: NimUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    let sawUsage = false;
    const maxRounds = this.opts.maxToolRounds ?? 6;

    for (let round = 0; ; round++) {
      // After the last allowed round, ask for a plain answer (only delegate stays available).
      const tools = round < maxRounds ? [DELEGATE_TOOL, ...extra] : [DELEGATE_TOOL];
      const result = await this.nim.chat(messages, { tools, temperature: this.opts.temperature, maxTokens: this.opts.maxTokens, signal });
      if (result.usage) {
        sawUsage = true;
        usage.prompt_tokens += result.usage.prompt_tokens;
        usage.completion_tokens += result.usage.completion_tokens;
        usage.total_tokens += result.usage.total_tokens;
      }
      const meta = { model: result.model, usage: sawUsage ? { ...usage } : undefined, ...(used.length && { tools: used }) };
      const calls = result.message.tool_calls ?? [];

      const delegate = calls.find((c) => c.function.name === "delegate");
      if (delegate) {
        const parsed = parseDelegateArgs(delegate.function.arguments);
        if (parsed) return { kind: "delegate", ...parsed, requiresApproval: true, ...meta };
      }
      const toolCalls = this.opts.toolbox ? calls.filter((c) => extra.some((t) => t.function.name === c.function.name)) : [];
      if (!toolCalls.length || round >= maxRounds) {
        const content = result.message.content?.trim() ?? "";
        return { kind: "answer", content: content || (used.length ? "Sorry boss, I couldn't finish that with my tools." : ""), ...meta };
      }

      messages.push({ role: "assistant", content: result.message.content ?? null, tool_calls: toolCalls });
      for (const call of toolCalls) {
        let content: string;
        let ok = true;
        try {
          content = await this.opts.toolbox!.call(call.function.name, call.function.arguments || "{}", signal);
        } catch (e) {
          ok = false;
          content = `Error: ${e instanceof Error ? e.message : String(e)}`;
        }
        used.push({ name: call.function.name, ok });
        messages.push({ role: "tool", tool_call_id: call.id, content: content.length > 20_000 ? `${content.slice(0, 20_000)}\n[cut]` : content });
      }
    }
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
