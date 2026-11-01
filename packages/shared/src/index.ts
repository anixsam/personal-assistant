/** Shared types used by the web app, server and MCP packages. */
export type Role = "user" | "assistant" | "system" | "tool";

export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  createdAt: string;
  /** URL of the synthesized voice reply, if one was generated. */
  audioUrl?: string;
}

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  updatedAt: string;
}
