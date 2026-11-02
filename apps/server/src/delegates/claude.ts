import Anthropic from "@anthropic-ai/sdk";
import type { Handoff } from "../handoffs.js";
import type { Delegate, DelegateResult } from "./types.js";

const SYSTEM = `You are helping Jarvis, a personal assistant. Jarvis has handed you a task it could not handle well itself.
Complete the task fully and reply with the final answer only; it will be shown to the user in Jarvis's chat.`;

export interface ClaudeDelegateOptions {
  model?: string;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  maxTokens?: number;
}

/** Sends an approved handoff to Claude through the Anthropic API. */
export class ClaudeDelegate implements Delegate {
  private readonly model: string;

  constructor(private readonly client: Anthropic = new Anthropic(), private readonly opts: ClaudeDelegateOptions = {}) {
    this.model = opts.model ?? "claude-opus-5-5";
  }

  async run(handoff: Handoff, signal?: AbortSignal): Promise<DelegateResult> {
    const stream = this.client.beta.messages.stream(
      {
        model: this.model,
        max_tokens: this.opts.maxTokens ?? 32_000,
        system: SYSTEM,
        thinking: { type: "adaptive" },
        output_config: { effort: this.opts.effort ?? "high" },
        // If Claude declines on safety grounds, the API retries on a fallback model automatically.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        messages: [{ role: "user", content: `${handoff.task}\n\n(Why Jarvis handed this off: ${handoff.reason})` }],
      },
      { signal },
    );
    const message = await stream.finalMessage();
    if (message.stop_reason === "refusal") {
      throw new Error("Claude declined this task.");
    }
    const output = message.content
      .flatMap((b) => (b.type === "text" ? [b.text] : []))
      .join("\n")
      .trim();
    return { output, by: message.model };
  }
}
