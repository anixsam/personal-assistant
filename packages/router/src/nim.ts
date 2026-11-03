import type { NimConfig } from "./config.js";
import type { NimChatOptions, NimChatResult, NimMessage } from "./types.js";

export type FetchLike = typeof fetch;

export class NimError extends Error {
  constructor(message: string, readonly status?: number, readonly body?: string) {
    super(message);
    this.name = "NimError";
  }
}

/** Minimal client for NVIDIA NIM's OpenAI-compatible chat completions API. */
export class NimClient {
  constructor(private readonly config: NimConfig, private readonly fetchImpl: FetchLike = fetch) {}

  get model(): string {
    return this.config.model;
  }

  async chat(messages: NimMessage[], opts: NimChatOptions = {}): Promise<NimChatResult> {
    const res = await this.post(this.body(messages, opts, false), opts.signal);
    const json = (await res.json()) as {
      model?: string;
      choices?: { message: NimMessage; finish_reason: string | null }[];
      usage?: NimChatResult["usage"];
    };
    const choice = json.choices?.[0];
    if (!choice) throw new NimError("NIM returned no choices");
    return { message: choice.message, finishReason: choice.finish_reason, usage: json.usage, model: json.model ?? this.config.model };
  }

  /** Streams content deltas as they arrive. */
  async *chatStream(messages: NimMessage[], opts: NimChatOptions = {}): AsyncGenerator<string> {
    const res = await this.post(this.body(messages, opts, true), opts.signal);
    if (!res.body) throw new NimError("NIM stream has no body");
    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") return;
        const delta = (JSON.parse(data) as { choices?: { delta?: { content?: string } }[] }).choices?.[0]?.delta?.content;
        if (delta) yield delta;
      }
    }
  }

  private body(messages: NimMessage[], opts: NimChatOptions, stream: boolean) {
    return {
      model: this.config.model,
      messages,
      stream,
      temperature: opts.temperature ?? 0.4,
      max_tokens: opts.maxTokens ?? 1024,
      ...(opts.tools?.length ? { tools: opts.tools, tool_choice: "auto" } : {}),
    };
  }

  private async post(body: unknown, signal?: AbortSignal): Promise<Response> {
    const timeout = AbortSignal.timeout(this.config.timeoutMs);
    const res = await this.fetchImpl(`${this.config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
        Accept: (body as { stream: boolean }).stream ? "text/event-stream" : "application/json",
      },
      body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const hint =
        res.status === 401 || res.status === 403
          ? " (check NVIDIA_API_KEY)"
          : res.status === 404 || res.status === 410
            ? ` (model "${this.config.model}" isn't available on NIM any more; set NIM_MODEL to a current model)`
            : "";
      throw new NimError(`NIM request failed with ${res.status}${hint}`, res.status, text.slice(0, 2000));
    }
    return res;
  }
}
