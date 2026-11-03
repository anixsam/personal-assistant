import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Workspace } from "./workspace.js";

type Result = { content: { type: "text"; text: string }[]; isError?: boolean };

async function run(fn: () => Promise<unknown>): Promise<Result> {
  try {
    const value = await fn();
    return { content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] };
  } catch (e) {
    return { content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }], isError: true };
  }
}

/** MCP server exposing a single workspace folder to Jarvis (and to Claude Code via .mcp.json). */
export function createFilesystemServer(ws: Workspace): McpServer {
  const server = new McpServer({ name: "jarvis-filesystem", version: "0.1.0" });
  const ro = { readOnlyHint: true, openWorldHint: false } as const;

  server.registerTool(
    "list_directory",
    {
      title: "List directory",
      description: "List files and folders in the workspace. Paths are relative to the workspace root.",
      inputSchema: {
        path: z.string().default(".").describe("Folder to list, relative to the workspace root"),
        recursive: z.boolean().default(false).describe("Include subfolders (skips .git, node_modules, build output)"),
      },
      annotations: ro,
    },
    ({ path, recursive }) => run(() => ws.list(path, { recursive })),
  );

  server.registerTool(
    "read_file",
    {
      title: "Read file",
      description: "Read a text file from the workspace. Use offset/limit (1-based line numbers) for large files.",
      inputSchema: {
        path: z.string().describe("File path relative to the workspace root"),
        offset: z.number().int().min(1).optional().describe("First line to return (1-based)"),
        limit: z.number().int().min(1).max(5000).optional().describe("Number of lines to return"),
      },
      annotations: ro,
    },
    ({ path, offset, limit }) =>
      run(async () => {
        const r = await ws.read(path, { offset, limit });
        const note = r.truncated ? `\n\n[showing part of ${r.totalLines} lines]` : "";
        return r.content + note;
      }),
  );

  server.registerTool(
    "search_files",
    {
      title: "Search files",
      description: "Find files by name, or find lines containing some text. Case-insensitive.",
      inputSchema: {
        query: z.string().min(1).describe("Text to look for"),
        mode: z.enum(["name", "content"]).default("name").describe("'name' matches file names, 'content' matches file text"),
        path: z.string().default(".").describe("Folder to search in"),
        max_results: z.number().int().min(1).max(500).default(100),
      },
      annotations: ro,
    },
    ({ query, mode, path, max_results }) => run(() => ws.search(query, { mode, path, maxResults: max_results })),
  );

  server.registerTool(
    "file_info",
    {
      title: "File info",
      description: "Get the type, size and last-modified time of a file or folder.",
      inputSchema: { path: z.string() },
      annotations: ro,
    },
    ({ path }) => run(() => ws.info(path)),
  );

  if (!ws.readOnly) {
    server.registerTool(
      "write_file",
      {
        title: "Write file",
        description: "Create or replace a text file in the workspace. Parent folders are created as needed.",
        inputSchema: {
          path: z.string(),
          content: z.string(),
          overwrite: z.boolean().default(true).describe("Set false to fail if the file already exists"),
        },
        annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: false },
      },
      ({ path, content, overwrite }) => run(() => ws.write(path, content, { overwrite })),
    );

    server.registerTool(
      "edit_file",
      {
        title: "Edit file",
        description: "Replace one exact occurrence of old_text with new_text. Fails if old_text is missing or appears more than once.",
        inputSchema: { path: z.string(), old_text: z.string().min(1), new_text: z.string() },
        annotations: { destructiveHint: true, openWorldHint: false },
      },
      ({ path, old_text, new_text }) => run(() => ws.edit(path, old_text, new_text)),
    );

    server.registerTool(
      "create_directory",
      {
        title: "Create directory",
        description: "Create a folder (and any missing parents) in the workspace.",
        inputSchema: { path: z.string() },
        annotations: { idempotentHint: true, openWorldHint: false },
      },
      ({ path }) => run(() => ws.mkdir(path)),
    );
  }

  return server;
}
