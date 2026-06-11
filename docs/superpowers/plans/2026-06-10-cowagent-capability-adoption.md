# CowAgent Capability Adoption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build on dzcz-agent as the product and business-workbench base, selectively adopting CowAgent capabilities that strengthen restaurant operations workflows without replacing dzcz-agent's Gateway, UI, connectors, or business tools.

**Architecture:** Keep dzcz-agent's TypeScript/Electron/React/Express stack as the primary runtime. Port CowAgent ideas as dzcz-native modules: MCP tool loading, layered memory, Markdown knowledge wiki, self-evolution reviews, skill source compatibility, CLI service management, and connector lifecycle hardening. Treat CowAgent Python code as a reference implementation, not a runtime dependency, except where a later task explicitly exposes Python code through MCP or an HTTP sidecar.

**Tech Stack:** TypeScript, React, Electron, Express, WebSocket, SQLite, pnpm, Node.js 22+, existing `@mariozechner/pi-agent-core`, existing dzcz-agent tools/connectors, and optional MCP client libraries selected during Task 2.

---

## Scope Decisions

Adopt from CowAgent:
- MCP server configuration and hot-reload pattern from `/Users/dzcz/CowAgent-master/agent/tools/tool_manager.py`.
- Layered memory layout inspired by `/Users/dzcz/CowAgent-master/agent/memory/service.py`.
- Markdown knowledge wiki and graph model inspired by `/Users/dzcz/CowAgent-master/agent/knowledge/service.py`.
- Self-evolution trigger pattern from `/Users/dzcz/CowAgent-master/bridge/agent_bridge.py`.
- Skill lifecycle/source ideas from `/Users/dzcz/CowAgent-master/agent/skills/manager.py`.
- CLI/service management ideas from `/Users/dzcz/CowAgent-master/cli`.
- Channel lifecycle ideas from `/Users/dzcz/CowAgent-master/app.py` and `/Users/dzcz/CowAgent-master/channel/channel_factory.py`.

Do not adopt:
- CowAgent's Python runtime as the main application runtime.
- CowAgent's `web.py` console as the product UI.
- A broad channel expansion before Feishu, WeChat, WeCom, and Smart KF are stable for restaurant operations.
- A full model-provider rewrite before dzcz-agent's current provider presets and tab overrides are validated.
- Voice-first workflows until text, image, file, browser, and report workflows are reliable.

## Target Architecture After This Plan

```text
React/Electron/Web settings UI
        |
Express/WebSocket API
        |
Gateway + ConnectorManager + per-Tab AgentRuntime
        |
ToolLoader
        |-- built-in business tools
        |-- MCP tools from mcp.json
        |-- skill_manager sources
        |
Memory v2 + Knowledge Wiki + Evolution Reviews
        |
SQLite config + filesystem workspace
```

## Task 1: Reference Map and Guardrails

**Files:**
- Create: `docs/cowagent-adoption-reference.md`
- Modify: `docs/superpowers/plans/2026-06-10-cowagent-capability-adoption.md`

- [ ] **Step 1: Create the reference map document**

Create `docs/cowagent-adoption-reference.md` with this structure:

```markdown
# CowAgent Adoption Reference

## Product Position

dzcz-agent remains the product shell and business execution system for restaurant operations. CowAgent is a reference for reusable Agent Harness capabilities.

## Reference Mapping

| Capability | CowAgent Reference | dzcz-agent Target |
|---|---|---|
| MCP tools | `/Users/dzcz/CowAgent-master/agent/tools/tool_manager.py` | `src/main/tools/mcp/`, `src/main/tools/registry/tool-loader.ts` |
| Memory layers | `/Users/dzcz/CowAgent-master/agent/memory/service.py` | `src/main/memory/`, `src/main/tools/memory-tool.ts` |
| Knowledge wiki | `/Users/dzcz/CowAgent-master/agent/knowledge/service.py` | `src/main/knowledge/`, `src/server/routes/knowledge.ts`, `src/renderer/components/settings/KnowledgeConfig.tsx` |
| Self-evolution | `/Users/dzcz/CowAgent-master/bridge/agent_bridge.py` | `src/main/evolution/`, `src/main/scheduled-tasks/` |
| Skill lifecycle | `/Users/dzcz/CowAgent-master/agent/skills/manager.py` | `src/main/tools/skill-manager/` |
| CLI service ops | `/Users/dzcz/CowAgent-master/cli` | `scripts/dianbot-cli.js`, package bin entry |
| Channel lifecycle | `/Users/dzcz/CowAgent-master/app.py` | `src/main/connectors/connector-manager.ts` |

## Guardrails

- Do not replace `Gateway`.
- Do not replace `AgentRuntime`.
- Do not migrate the main application to Python.
- Do not remove current Feishu, WeChat, WeCom, or Smart KF connector behavior.
- Every external write action must preserve explicit confirmation behavior.
- Each adopted capability must be usable without enabling unrelated CowAgent features.
```

- [ ] **Step 2: Verify the document has no placeholder language**

Run:

```bash
rg -n "T[B]D|T[O]DO|implement[[:space:]]+later|fill[[:space:]]+in" docs/cowagent-adoption-reference.md
```

Expected: no matches and exit code 1.

- [ ] **Step 3: Commit the reference map**

```bash
git add docs/cowagent-adoption-reference.md docs/superpowers/plans/2026-06-10-cowagent-capability-adoption.md
git commit -m "docs: map cowagent capabilities for dianbot adoption"
```

## Task 2: MCP Tool Bridge

**Files:**
- Create: `src/main/tools/mcp/types.ts`
- Create: `src/main/tools/mcp/config-loader.ts`
- Create: `src/main/tools/mcp/mcp-tool-plugin.ts`
- Create: `src/main/tools/mcp/index.ts`
- Modify: `src/main/tools/registry/tool-loader.ts`
- Create test: `src/main/tools/mcp/config-loader.test.ts`

- [ ] **Step 1: Define MCP config types**

Create `src/main/tools/mcp/types.ts`:

```ts
export type McpTransportType = 'stdio' | 'sse' | 'streamable-http';

export interface McpServerConfig {
  name: string;
  type: McpTransportType;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  enabled?: boolean;
}

export interface McpConfigFile {
  mcpServers?: Record<string, Omit<McpServerConfig, 'name' | 'type'> & { type?: McpTransportType }>;
  mcp_servers?: McpServerConfig[];
}
```

- [ ] **Step 2: Write config loader tests**

Create `src/main/tools/mcp/config-loader.test.ts` with tests for dict format, list format, disabled servers, missing files, and invalid JSON. The tests should assert that `mcpServers.github.command` becomes `{ name: 'github', type: 'stdio', command: ... }`, and `{ url: 'http://localhost:3000/sse' }` defaults to `sse`.

- [ ] **Step 3: Implement `loadMcpConfigs`**

Create `src/main/tools/mcp/config-loader.ts` with a pure function:

```ts
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { McpConfigFile, McpServerConfig } from './types';

export function normalizeMcpConfig(raw: McpConfigFile): McpServerConfig[] {
  const fromList = Array.isArray(raw.mcp_servers) ? raw.mcp_servers : [];
  const fromDict = raw.mcpServers
    ? Object.entries(raw.mcpServers).map(([name, cfg]) => ({
        name,
        type: cfg.type || (cfg.url ? 'sse' : 'stdio'),
        ...cfg,
      } as McpServerConfig))
    : [];
  return [...fromList, ...fromDict].filter(server => server.enabled !== false);
}

export function loadMcpConfigs(workspaceDir: string): McpServerConfig[] {
  const path = join(workspaceDir, 'mcp.json');
  if (!existsSync(path)) return [];
  const content = readFileSync(path, 'utf-8');
  return normalizeMcpConfig(JSON.parse(content));
}
```

- [ ] **Step 4: Add MCP plugin shell**

Create `src/main/tools/mcp/mcp-tool-plugin.ts` exporting `mcpToolPlugin`. The first implementation may return an empty array when no MCP config exists, and must log configured server names when configs exist.

- [ ] **Step 5: Register MCP tools in ToolLoader**

Modify `src/main/tools/registry/tool-loader.ts`:
- Import `mcpToolPlugin`.
- In `loadTools`, call `mcpToolPlugin.create(pluginOpts)` after built-in web fetch/search tools and before connector-specific tools.

- [ ] **Step 6: Verify**

Run:

```bash
pnpm run type-check
```

Expected: exit code 0.

- [ ] **Step 7: Commit**

```bash
git add src/main/tools/mcp src/main/tools/registry/tool-loader.ts
git commit -m "feat: add mcp config bridge"
```

## Task 3: Memory v2 Layering (Superseded By Admin Control Plane)

> **Superseded on 2026-06-10.** Do not implement this task as originally written. The filesystem-only Memory v2 task is now replaced by the broader admin control-plane design in `docs/superpowers/specs/2026-06-10-dianbot-admin-memory-control-plane-design.md`.
>
> The original content below is kept only as historical context. Implementation planning should split this area into:
> - Memory Gateway and mem0 provider governance.
> - Admin Console for store, employee, Feishu conversation, and memory management.
> - Browser Login State Vault for platform login state and permission boundaries.
> - CowAgent-inspired local daily/dream/evolution files as audit and lifecycle support, not as the primary enterprise memory source of truth.

**Files:**
- Create: `src/main/memory/types.ts`
- Create: `src/main/memory/memory-paths.ts`
- Create: `src/main/memory/memory-service.ts`
- Modify: `src/main/tools/memory-tool.ts`
- Modify: `src/main/database/workspace-config.ts`
- Create test: `src/main/memory/memory-service.test.ts`

- [ ] **Step 1: Define the memory layout**

Use this filesystem layout under the configured memory directory:

```text
memory.md
daily/YYYY-MM-DD.md
dreams/YYYY-MM-DD.md
evolution/YYYY-MM-DD.md
tabs/<tabId>.md
```

- [ ] **Step 2: Implement memory path helpers**

Create `src/main/memory/memory-paths.ts` with functions that resolve each file path and reject path traversal by comparing `realpath` prefixes.

- [ ] **Step 3: Implement MemoryService**

Create `src/main/memory/memory-service.ts` with methods:
- `list(category: 'core' | 'daily' | 'dream' | 'evolution' | 'tab')`
- `read(category, filename)`
- `append(category, filename, content)`
- `ensureLayout()`

- [ ] **Step 4: Preserve compatibility with current memory-tool**

Modify `src/main/tools/memory-tool.ts` so existing memory reads and writes continue to use `memory.md` while new calls may target `daily`, `dream`, `evolution`, or `tabs`.

- [ ] **Step 5: Verify**

Run:

```bash
pnpm run type-check
```

Expected: exit code 0.

- [ ] **Step 6: Commit**

```bash
git add src/main/memory src/main/tools/memory-tool.ts src/main/database/workspace-config.ts
git commit -m "feat: add layered memory service"
```

## Task 4: Knowledge Wiki

**Files:**
- Create: `src/main/knowledge/types.ts`
- Create: `src/main/knowledge/knowledge-service.ts`
- Create: `src/server/routes/knowledge.ts`
- Modify: `src/server/index.ts`
- Create: `src/renderer/components/settings/KnowledgeConfig.tsx`
- Modify: `src/renderer/components/SystemSettings.tsx`
- Create test: `src/main/knowledge/knowledge-service.test.ts`

- [ ] **Step 1: Implement Markdown knowledge tree**

Create a service that manages:

```text
knowledge/index.md
knowledge/log.md
knowledge/<category>/<slug>.md
```

The service must expose `listTree`, `readFile`, `writeFile`, and `buildGraph`.

- [ ] **Step 2: Add API routes**

Add authenticated routes:
- `GET /api/knowledge/tree`
- `GET /api/knowledge/file?path=<relativePath>`
- `POST /api/knowledge/file`
- `GET /api/knowledge/graph`

- [ ] **Step 3: Add settings UI**

Add a Knowledge tab in System Settings that lists categories, opens Markdown pages, and shows a basic linked-page count before graph visualization is built.

- [ ] **Step 4: Verify**

Run:

```bash
pnpm run type-check
```

Expected: exit code 0.

- [ ] **Step 5: Commit**

```bash
git add src/main/knowledge src/server/routes/knowledge.ts src/server/index.ts src/renderer/components/settings/KnowledgeConfig.tsx src/renderer/components/SystemSettings.tsx
git commit -m "feat: add markdown knowledge wiki"
```

## Task 5: Self-Evolution Review Loop

**Files:**
- Create: `src/main/evolution/types.ts`
- Create: `src/main/evolution/evolution-service.ts`
- Create: `src/main/evolution/prompts.ts`
- Modify: `src/main/scheduled-tasks/scheduler.ts`
- Modify: `src/main/scheduled-tasks/executor.ts`
- Create test: `src/main/evolution/evolution-service.test.ts`

- [ ] **Step 1: Define review inputs and outputs**

Create a service that reads recent sessions, task executions, and memory changes. It must output:
- `memory/evolution/YYYY-MM-DD.md`
- `memory/dreams/YYYY-MM-DD.md`
- optional knowledge wiki page updates only when the model explicitly classifies content as reusable operational knowledge.

- [ ] **Step 2: Add safety rules**

The review service must not modify connector configs, model configs, workspace paths, credentials, or task schedules. It may only write Markdown memory/knowledge files.

- [ ] **Step 3: Schedule nightly review**

Register an internal scheduled task that runs once daily and can also be triggered manually from the settings UI in a later task.

- [ ] **Step 4: Verify**

Run:

```bash
pnpm run type-check
```

Expected: exit code 0.

- [ ] **Step 5: Commit**

```bash
git add src/main/evolution src/main/scheduled-tasks
git commit -m "feat: add self evolution review loop"
```

## Task 6: Skill Source Compatibility

**Files:**
- Modify: `src/main/tools/skill-manager/install.ts`
- Modify: `src/main/tools/skill-manager/search.ts`
- Modify: `src/main/tools/skill-manager/types.ts`
- Modify: `src/renderer/components/SkillManager.tsx`
- Create test: `src/main/tools/skill-manager/source-normalization.test.ts`

- [ ] **Step 1: Normalize skill sources**

Support these source shapes:
- built-in current source
- ClawHub source
- GitHub repository URL
- Cow Skill Hub URL
- local zip path

- [ ] **Step 2: Preserve existing install behavior**

Existing installed skills in `/Users/dzcz/.agents/skills` must remain readable and manageable without migration.

- [ ] **Step 3: Add source labels to UI**

Show source type beside each skill in `SkillManager`.

- [ ] **Step 4: Verify**

Run:

```bash
pnpm run type-check
```

Expected: exit code 0.

- [ ] **Step 5: Commit**

```bash
git add src/main/tools/skill-manager src/renderer/components/SkillManager.tsx
git commit -m "feat: support multiple skill sources"
```

## Task 7: DianBot CLI

**Files:**
- Create: `scripts/dianbot-cli.js`
- Modify: `package.json`
- Create: `docs/dianbot-cli.md`

- [ ] **Step 1: Add CLI commands**

Implement commands:
- `dianbot status`
- `dianbot logs`
- `dianbot doctor`
- `dianbot open-data`
- `dianbot print-config`

- [ ] **Step 2: Add package bin**

Add this to `package.json`:

```json
{
  "bin": {
    "dianbot": "scripts/dianbot-cli.js"
  }
}
```

- [ ] **Step 3: Verify**

Run:

```bash
node scripts/dianbot-cli.js status
node scripts/dianbot-cli.js doctor
pnpm run type-check
```

Expected: CLI exits cleanly, then type-check exits 0.

- [ ] **Step 4: Commit**

```bash
git add scripts/dianbot-cli.js package.json docs/dianbot-cli.md
git commit -m "feat: add dianbot service cli"
```

## Task 8: Connector Lifecycle Hardening

**Files:**
- Modify: `src/main/connectors/connector-manager.ts`
- Modify: `src/types/connector.ts`
- Modify: `src/server/routes/connectors.ts`
- Modify: `src/renderer/components/settings/ConnectorConfig.tsx`
- Create test: `src/main/connectors/connector-manager.test.ts`

- [ ] **Step 1: Add lifecycle state**

Add connector states:
- `stopped`
- `starting`
- `running`
- `stopping`
- `failed`

- [ ] **Step 2: Add last error and restart metadata**

Track `lastError`, `startedAt`, `stoppedAt`, and `restartCount` for each connector.

- [ ] **Step 3: Surface status in API and UI**

Return lifecycle metadata from connector health routes and show it in the connector settings panel.

- [ ] **Step 4: Verify**

Run:

```bash
pnpm run type-check
```

Expected: exit code 0.

- [ ] **Step 5: Commit**

```bash
git add src/main/connectors/connector-manager.ts src/types/connector.ts src/server/routes/connectors.ts src/renderer/components/settings/ConnectorConfig.tsx
git commit -m "feat: harden connector lifecycle states"
```

## Task 9: Web Settings Integration

**Files:**
- Modify: `src/renderer/components/SystemSettings.tsx`
- Modify: `src/renderer/api/index.ts`
- Modify: `src/renderer/api/web-client.ts`
- Modify: `src/server/routes/config.ts`
- Modify: `src/server/routes/tools.ts`

- [ ] **Step 1: Add settings sections**

Add settings entry points for:
- MCP servers
- Memory v2
- Knowledge wiki
- Self-evolution
- CLI help

- [ ] **Step 2: Keep advanced settings collapsed**

Restaurant operators should not see low-level MCP or evolution controls during normal operation. Put advanced controls behind a clearly labeled advanced section.

- [ ] **Step 3: Verify**

Run:

```bash
pnpm run type-check
```

Expected: exit code 0.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/SystemSettings.tsx src/renderer/api src/server/routes
git commit -m "feat: expose adopted cowagent settings"
```

## Task 10: End-to-End Acceptance

**Files:**
- Create: `docs/cowagent-adoption-acceptance.md`
- Modify: `README.md`

- [ ] **Step 1: Document acceptance workflows**

Create `docs/cowagent-adoption-acceptance.md` with these workflows:
- Install and list an MCP server.
- Read and write core memory.
- Create a daily memory entry.
- Create and read a knowledge page.
- Build a knowledge graph from two linked Markdown pages.
- Run a self-evolution review on a sample session.
- Confirm Feishu, WeChat, WeCom, and Smart KF settings still load.

- [ ] **Step 2: Run verification commands**

Run:

```bash
pnpm run type-check
pnpm run type-check:server
```

Expected: both commands exit 0.

- [ ] **Step 3: Commit**

```bash
git add docs/cowagent-adoption-acceptance.md README.md
git commit -m "docs: add cowagent adoption acceptance workflows"
```

## Risk Controls

- Keep all new systems disabled or passive by default until their settings UI exists.
- Keep memory v1 compatibility throughout memory v2 work.
- Add CowAgent-inspired capabilities as dzcz-native modules instead of importing Python runtime code.
- Preserve current connector behavior before adding new channel abstractions.
- Do not let self-evolution write credentials, connector configs, model configs, or schedules.
- Validate every phase with `pnpm run type-check` before moving to the next phase.

## Suggested Execution Order

1. Task 1: Reference map and guardrails.
2. Task 2: MCP bridge.
3. Task 3: Memory v2.
4. Task 4: Knowledge wiki.
5. Task 5: Self-evolution.
6. Task 6: Skill source compatibility.
7. Task 7: CLI.
8. Task 8: Connector lifecycle hardening.
9. Task 9: Settings integration.
10. Task 10: Acceptance workflows.

## Self-Review

- Spec coverage: The plan covers the CowAgent parts that fit dzcz-agent: MCP, layered memory, knowledge wiki, self-evolution, skill sources, CLI, and connector/channel lifecycle ideas.
- Out-of-scope clarity: Python runtime replacement, CowAgent Web Console replacement, broad channel expansion, and voice-first workflows are explicitly excluded.
- Placeholder scan: The plan contains no deferred implementation placeholders.
- Type consistency: File paths use current dzcz-agent conventions and CowAgent references are absolute local paths.
- Execution suitability: Each task has exact target files, verification commands, expected results, and commit boundaries.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-10-cowagent-capability-adoption.md`. Two execution options:

1. **Subagent-Driven (recommended)** - Dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints.
