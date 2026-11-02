# @jarvis/router

Every Jarvis request goes to NVIDIA NIM first. NIM either answers directly or calls the
`delegate` tool to propose handing the work to Claude (`claude`) or the Claude Code agent
(`claude-code`). A handoff always comes back with `requiresApproval: true`, and the caller
must get the user's approval before running it.

```ts
import { JarvisRouter, NimClient, loadNimConfig } from "@jarvis/router";

const router = new JarvisRouter(new NimClient(loadNimConfig()));
const result = await router.route([{ role: "user", content: "Good morning" }]);
if (result.kind === "answer") console.log(result.content);
else console.log(`NIM wants to hand off to ${result.target}: ${result.task}`);
```

Settings come from `NVIDIA_API_KEY`, `NIM_BASE_URL`, `NIM_MODEL` and `NIM_TIMEOUT_MS`.
`router.stream()` streams a direct NIM reply token by token.
